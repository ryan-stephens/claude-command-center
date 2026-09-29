import { getSessionMessages, query, renameSession, type Query, type SDKMessage, type SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { statSync } from 'node:fs';
import type { SessionActivity, SessionStatus, SessionSummary, TranscriptItem } from '../shared/protocol.ts';
import { applyEvent, backgroundRunning, idleActivity, setApproval, startTurn } from './activity.ts';
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
  slash?: SlashCommand[];
  activity: SessionActivity;
  activityTimer?: NodeJS.Timeout;
}

/** Activity changes on every stream event; clients get at most one update per this many ms. */
const ACTIVITY_THROTTLE_MS = 150;

export interface SessionEvents {
  sessionsChanged(): void;
  upsert(s: SessionSummary): void;
  items(id: string, items: TranscriptItem[]): void;
  partial(id: string, text: string): void;
  forked(oldId: string, newId: string): void;
  /** A session's slash commands arrived or changed (feeds the auto command groups). */
  commandsChanged(): void;
  /** What a live session is doing right now (throttled). */
  activity(id: string, activity: SessionActivity): void;
}

export class SessionManager {
  readonly history: HistoryIndex;
  readonly broker: PermissionBroker;
  private live = new Map<string, LiveSession>();
  /** Sessions we stopped recently: their fresh mtime is ours, not a terminal's. */
  private recentlyOwned = new Map<string, number>();
  /** Last slash-command list seen per cwd, so history sessions get auto groups too. */
  private slashByCwd = new Map<string, SlashCommand[]>();
  /** Resumes in flight: a second send while the transcript loads must join it, not start another CLI. */
  private starting = new Map<string, Promise<LiveSession>>();
  /** History id → the fork it became, so late sends to the old id follow the fork. */
  private forkedTo = new Map<string, string>();
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
    const target = this.forkedTo.get(id) ?? id;
    let l = this.live.get(target);
    if (!l) {
      let pending = this.starting.get(target);
      if (!pending) {
        pending = this.resume(target).finally(() => this.starting.delete(target));
        this.starting.set(target, pending);
      }
      l = await pending;
    }
    const userItem: TranscriptItem = { kind: 'user', uuid: crypto.randomUUID(), text };
    l.items.push(userItem);
    this.events.items(l.id, [userItem]);
    l.input.push(text);
    this.setStatus(l, 'running');
    this.setActivity(l, startTurn(l.activity, Date.now()));
    return l.id;
  }

  private async resume(id: string): Promise<LiveSession> {
    const summary = this.summaries().find((s) => s.id === id);
    if (!summary) throw new Error(`Unknown session ${id}`);
    const fork = Boolean(summary.activeElsewhere);
    const newId = fork ? crypto.randomUUID() : id;
    const items = await this.transcript(id);
    const l = this.start({
      id: newId,
      cwd: summary.cwd,
      title: summary.title,
      items,
      options: fork ? { resume: id, forkSession: true, sessionId: newId } : { resume: id },
    });
    if (fork) {
      this.forkedTo.set(id, newId);
      // Tell clients to follow the new id (carrying the old transcript) before any of its items arrive.
      this.events.forked(id, newId);
      const notice: TranscriptItem = { kind: 'notice', uuid: crypto.randomUUID(), text: `Forked from ${id.slice(0, 8)}, which looked active in another window.` };
      l.items.push(notice);
      this.events.items(newId, [notice]);
    }
    return l;
  }

  async stopTask(id: string, taskId: string): Promise<void> {
    await this.live.get(id)?.q.stopTask(taskId);
  }

  /** Returns false when there was nothing in the foreground to move. */
  async backgroundTasks(id: string): Promise<boolean> {
    const l = this.live.get(id);
    return l ? l.q.backgroundTasks() : false;
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

  cwdOf(id: string): string | undefined {
    return this.live.get(id)?.cwd ?? this.history.get(id)?.cwd;
  }

  /** Repo packs may only be written into directories that sessions actually run in. */
  isKnownCwd(cwd: string): boolean {
    return [...this.live.values()].some((l) => l.cwd === cwd) || this.history.repos().includes(cwd);
  }

  slashCommands(id: string): SlashCommand[] | undefined {
    const cwd = this.cwdOf(id);
    return this.live.get(id)?.slash ?? (cwd ? this.slashByCwd.get(cwd) : undefined);
  }

  onPermissionChange(sessionId: string): void {
    const l = this.live.get(sessionId);
    if (!l) return;
    const waiting = this.broker.hasPending(sessionId);
    if (waiting) this.setStatus(l, 'requires_action');
    else if (l.status === 'requires_action') this.setStatus(l, 'running');
    this.setActivity(l, setApproval(l.activity, waiting, Date.now()));
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
      status: 'idle', items: opts.items ?? [], partial: '', lastModified: Date.now(), activity: idleActivity(Date.now()),
    };
    this.live.set(id, l);
    this.pump(l);
    q.supportedCommands().then((cmds) => this.setSlash(l, cmds), () => {});
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
    this.trackActivity(l, msg);
    if (msg.type === 'system' && msg.subtype === 'commands_changed') {
      this.setSlash(l, msg.commands);
      return;
    }
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

  private setSlash(l: LiveSession, cmds: SlashCommand[]): void {
    l.slash = cmds;
    this.slashByCwd.set(l.cwd, cmds);
    this.events.commandsChanged();
  }

  private setStatus(l: LiveSession, status: SessionStatus): void {
    if (l.status === status) return;
    l.status = status;
    this.emitUpsert(l.id);
  }

  private retire(l: LiveSession): void {
    this.live.delete(l.id);
    clearTimeout(l.activityTimer);
    this.events.activity(l.id, idleActivity(Date.now()));
    // A CLI that died mid-approval leaves cards nobody can answer; clear them.
    this.broker.cancelSession(l.id);
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
      background: backgroundRunning(l.activity) || undefined,
    };
  }

  /** Current activity of every live session, for clients that just connected. */
  activities(): [string, SessionActivity][] {
    return [...this.live.values()].map((l) => [l.id, l.activity]);
  }

  private trackActivity(l: LiveSession, msg: SDKMessage): void {
    const before = l.activity;
    const after = applyEvent(before, msg as never, Date.now());
    if (after === before) return;
    // Background work starting and finishing is worth a line in the transcript too.
    const notices: TranscriptItem[] = [];
    for (const t of after.tasks) {
      const prev = before.tasks.find((x) => x.id === t.id);
      if (t.background && (!prev || !prev.background)) {
        notices.push({ kind: 'notice', uuid: crypto.randomUUID(), text: `⧉ Started in the background: ${t.description}` });
      }
    }
    // The final word on how a task ended is its task_notification (a background-list update can
    // arrive first and would read "completed" for a task that was actually stopped).
    if (msg.type === 'system' && msg.subtype === 'task_notification') {
      const t = after.tasks.find((x) => x.id === msg.task_id);
      if (t?.background) notices.push({ kind: 'notice', uuid: crypto.randomUUID(), text: `⧉ Background ${msg.status}: ${msg.summary || t.description}` });
    }
    if (notices.length) {
      l.items.push(...notices);
      this.events.items(l.id, notices);
    }
    this.setActivity(l, after);
  }

  private setActivity(l: LiveSession, activity: SessionActivity): void {
    const bgBefore = backgroundRunning(l.activity);
    l.activity = activity;
    if (backgroundRunning(activity) !== bgBefore) this.emitUpsert(l.id); // list badge
    if (l.activityTimer) return;
    l.activityTimer = setTimeout(() => {
      l.activityTimer = undefined;
      this.events.activity(l.id, l.activity);
    }, ACTIVITY_THROTTLE_MS);
  }
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function firstLine(s?: string): string {
  const line = s?.trim().split('\n')[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}
