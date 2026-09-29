import { getSessionMessages, query, renameSession, type Query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { statSync } from 'node:fs';
import type { SessionStatus, SessionSummary, TranscriptItem } from '../shared/protocol.ts';
import { ACTIVE_ELSEWHERE_MS, HistoryIndex } from './history-index.ts';
import { InputQueue } from './input-queue.ts';
import { PermissionBroker } from './permission-broker.ts';
import { normalize } from './transcript.ts';

// session_state_changed is only emitted with this flag (Phase 0 finding, PLAN.md §9).
const SDK_ENV = { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' } as Record<string, string>;
const MODEL = process.env.CC_CONTROL_MODEL || undefined;

interface LiveSession {
  id: string;
  cwd: string;
  title: string;
  input: InputQueue;
  q: Query;
  status: SessionStatus;
  items: TranscriptItem[];
  partial: string;
  ctxPct?: number;
  lastModified: number;
}

export interface SessionEvents {
  sessionsChanged(): void;
  upsert(s: SessionSummary): void;
  items(id: string, items: TranscriptItem[]): void;
  partial(id: string, text: string): void;
  forked(oldId: string, newId: string): void;
}

export class SessionManager {
  readonly history: HistoryIndex;
  readonly broker: PermissionBroker;
  private live = new Map<string, LiveSession>();
  /** Sessions we stopped recently: their fresh mtime is ours, not a terminal's. */
  private recentlyOwned = new Map<string, number>();
  private events: SessionEvents;

  constructor(events: SessionEvents, broker: PermissionBroker) {
    this.events = events;
    this.broker = broker;
    this.history = new HistoryIndex(() => events.sessionsChanged());
  }

  summaries(): SessionSummary[] {
    const out = new Map<string, SessionSummary>();
    const now = Date.now();
    for (const h of this.history.sessions) {
      const owned = (this.recentlyOwned.get(h.sessionId) ?? 0) > now - ACTIVE_ELSEWHERE_MS;
      out.set(h.sessionId, {
        id: h.sessionId,
        title: h.customTitle || h.summary || h.firstPrompt || '(untitled)',
        cwd: h.cwd ?? '',
        branch: h.gitBranch,
        lastModified: h.lastModified,
        live: false,
        activeElsewhere: !owned && h.lastModified > now - ACTIVE_ELSEWHERE_MS,
      });
    }
    for (const l of this.live.values()) out.set(l.id, this.liveSummary(l));
    return [...out.values()].sort((a, b) => b.lastModified - a.lastModified);
  }

  async create(cwd: string, prompt?: string): Promise<string> {
    if (!isDir(cwd)) throw new Error(`Not a directory: ${cwd}`);
    const id = crypto.randomUUID();
    this.start({ id, cwd, title: firstLine(prompt) || 'New session', options: { sessionId: id } });
    if (prompt?.trim()) this.send(id, prompt);
    else this.emitUpsert(id);
    return id;
  }

  async transcript(id: string): Promise<TranscriptItem[]> {
    const l = this.live.get(id);
    if (l) return l.items;
    const h = this.history.get(id);
    const msgs = await getSessionMessages(id, { dir: h?.cwd });
    return msgs.flatMap((m) => normalize(m as never));
  }

  /**
   * Send a turn. A history session is resumed on first send; if a terminal seems to
   * own it, it is forked instead so two writers never share one transcript.
   * Returns the id the turn went to.
   */
  async send(id: string, text: string): Promise<string> {
    let l = this.live.get(id);
    if (!l) {
      const summary = this.summaries().find((s) => s.id === id);
      if (!summary) throw new Error(`Unknown session ${id}`);
      const fork = Boolean(summary.activeElsewhere);
      const newId = fork ? crypto.randomUUID() : id;
      const items = await this.transcript(id);
      l = this.start({
        id: newId,
        cwd: summary.cwd,
        title: summary.title,
        items,
        options: fork ? { resume: id, forkSession: true, sessionId: newId } : { resume: id },
      });
      if (fork) {
        // Tell clients to follow the new id (carrying the old transcript) before any of its items arrive.
        this.events.forked(id, newId);
        const notice: TranscriptItem = { kind: 'notice', uuid: crypto.randomUUID(), text: `Forked from ${id.slice(0, 8)}, which looked active in another window.` };
        l.items.push(notice);
        this.events.items(newId, [notice]);
      }
    }
    const userItem: TranscriptItem = { kind: 'user', uuid: crypto.randomUUID(), text };
    l.items.push(userItem);
    this.events.items(l.id, [userItem]);
    l.input.push(text);
    this.setStatus(l, 'running');
    return l.id;
  }

  async interrupt(id: string): Promise<void> {
    await this.live.get(id)?.q.interrupt();
  }

  stop(id: string): void {
    const l = this.live.get(id);
    if (!l) return;
    this.broker.cancelSession(id);
    l.input.close();
    l.q.close();
    this.retire(l);
  }

  async rename(id: string, title: string): Promise<void> {
    const l = this.live.get(id);
    if (l) {
      l.title = title;
      this.emitUpsert(id);
    }
    const h = this.history.get(id);
    try {
      await renameSession(id, title, { dir: h?.cwd ?? l?.cwd });
    } catch (e) {
      // A brand-new live session has no transcript yet; the live title still applies.
      if (!l) throw e;
    }
    this.history.scheduleRefresh();
  }

  onPermissionChange(sessionId: string): void {
    const l = this.live.get(sessionId);
    if (!l) return;
    if (this.broker.hasPending(sessionId)) this.setStatus(l, 'requires_action');
    else if (l.status === 'requires_action') this.setStatus(l, 'running');
  }

  stopAll(): void {
    for (const id of [...this.live.keys()]) this.stop(id);
  }

  private start(opts: { id: string; cwd: string; title: string; items?: TranscriptItem[]; options: Record<string, unknown> }): LiveSession {
    const input = new InputQueue();
    const id = opts.id;
    const q = query({
      prompt: input,
      options: {
        cwd: opts.cwd,
        model: MODEL,
        env: SDK_ENV,
        includePartialMessages: true,
        permissionMode: 'default',
        canUseTool: (tool, toolInput, { signal, suggestions }) => this.broker.ask(id, tool, toolInput, suggestions, signal),
        ...opts.options,
      },
    });
    const l: LiveSession = {
      id, cwd: opts.cwd, title: opts.title, input, q,
      status: 'idle', items: opts.items ?? [], partial: '', lastModified: Date.now(),
    };
    this.live.set(id, l);
    this.pump(l);
    return l;
  }

  private async pump(l: LiveSession): Promise<void> {
    try {
      for await (const msg of l.q) this.handle(l, msg);
    } catch (e) {
      const notice: TranscriptItem = { kind: 'notice', uuid: crypto.randomUUID(), text: `Session ended with an error: ${(e as Error).message}` };
      l.items.push(notice);
      this.events.items(l.id, [notice]);
    }
    if (this.live.get(l.id) === l) this.retire(l);
  }

  private handle(l: LiveSession, msg: SDKMessage): void {
    l.lastModified = Date.now();
    if (msg.type === 'system' && msg.subtype === 'session_state_changed') {
      // Keep requires_action while a card is still open (state events can race the broker).
      if (!(msg.state === 'running' && this.broker.hasPending(l.id))) this.setStatus(l, msg.state);
      return;
    }
    if (msg.type === 'stream_event') {
      const ev = msg.event as { type: string; delta?: { type: string; text?: string } };
      if (ev.type === 'message_start') l.partial = '';
      else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') l.partial += ev.delta.text ?? '';
      else return;
      this.events.partial(l.id, l.partial);
      return;
    }
    // Our own user turns are echoed optimistically in send(); skip the SDK's copy of plain text prompts.
    if (msg.type === 'user' && typeof msg.message.content === 'string') return;
    const items = normalize(msg as never);
    if (msg.type === 'assistant' && l.partial) {
      l.partial = '';
      this.events.partial(l.id, '');
    }
    if (items.length) {
      l.items.push(...items);
      this.events.items(l.id, items);
    }
    if (msg.type === 'result') {
      if (l.status === 'running') this.setStatus(l, 'idle'); // fallback if state events are missing
      l.q.getContextUsage({ detail: 'summary' }).then(
        (u) => { l.ctxPct = u.percentage; this.emitUpsert(l.id); },
        () => {},
      );
    }
  }

  private setStatus(l: LiveSession, status: SessionStatus): void {
    if (l.status === status) return;
    l.status = status;
    this.emitUpsert(l.id);
  }

  private retire(l: LiveSession): void {
    this.live.delete(l.id);
    this.recentlyOwned.set(l.id, Date.now());
    this.history.refresh().finally(() => this.events.sessionsChanged());
  }

  private emitUpsert(id: string): void {
    const l = this.live.get(id);
    if (l) this.events.upsert(this.liveSummary(l));
  }

  private liveSummary(l: LiveSession): SessionSummary {
    const h = this.history.get(l.id);
    return {
      id: l.id,
      title: h?.customTitle || l.title,
      cwd: l.cwd,
      branch: h?.gitBranch,
      lastModified: Math.max(l.lastModified, h?.lastModified ?? 0),
      live: true,
      status: l.status,
      ctxPct: l.ctxPct,
    };
  }
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function firstLine(s?: string): string {
  const line = s?.trim().split('\n')[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}
