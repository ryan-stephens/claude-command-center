// The Ticket Line's server half: a card saves its context, makes its branch and starts `claude` in
// a Windows Terminal tab. The tab's SessionStart hook (hooks/cc-control-hook.mjs, loaded with
// `claude --settings`, so nothing is added to the user's own settings) calls back here with the
// card id and token, gets the packet as additionalContext, and reports the session id, which
// links the card to the session.

import { execFile, spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  branchFor, CARD_MODELS, cardRepos, defaultMessage, PACKET_KINDS, homeOf, includedRepos, LAUNCH_MODES, laterText, modelFor, packetText, tokens, fmtK, waiting, worktreeFor, wtArg,
  type BranchChoice, type BootStep, type Card, type CardDraft, type LaterItem, type LaunchMode, type Packet, type PacketItem,
} from '../shared/cards.ts';
import type { Workspace } from '../shared/protocol.ts';
import type { Ticket } from '../shared/tickets.ts';
import { repoName, samePath } from '../shared/workspaces.ts';
import { applyEvent, TRACKED_EVENTS, type HookInput } from './card-events.ts';
import { normalizeFolder } from './fs-browse.ts';
import { DB_PATH, type Store } from './store.ts';

const HOOK_SCRIPT = fileURLToPath(new URL('../hooks/cc-control-hook.mjs', import.meta.url));
/** How long a new tab has to report in before the card says something may be wrong. */
const HOOK_WAIT_MS = 45_000;

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** A packet from the page: known kinds, real folders for repos, bounded text. */
function cleanItems(raw: unknown): PacketItem[] {
  const out: PacketItem[] = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, 60) : []) {
    const i = (r ?? {}) as Partial<PacketItem>;
    if (i.kind === 'repo') {
      const path = normalizeFolder(i.id);
      if (!path || !isDir(path)) throw new Error(`Not a folder: ${str(i.id, 200)}`);
      out.push({ kind: 'repo', id: path, label: repoName(path), on: i.on !== false });
    } else if (i.kind && PACKET_KINDS.includes(i.kind)) {
      const label = str(i.label, 500).trim();
      const text = str(i.text, 20_000);
      if (label) out.push({ kind: i.kind, id: str(i.id, 200) || label, label, ...(text ? { text } : {}), on: i.on !== false });
    }
  }
  return out;
}

export function cleanDraft(raw: unknown, workspaces: Workspace[]): CardDraft {
  const d = (raw ?? {}) as Partial<CardDraft>;
  const title = str(d.title, 160).trim();
  if (!title) throw new Error('Give the card a title.');
  const workspaceId = typeof d.workspaceId === 'string' && workspaces.some((w) => w.id === d.workspaceId) ? d.workspaceId : null;
  const p = (d.packet ?? {}) as Partial<Packet>;
  const packet: Packet = { workspace: cleanItems(p.workspace), ticket: cleanItems(p.ticket), card: cleanItems(p.card), note: str(p.note, 8000) };
  const l = (d.launch ?? {}) as Partial<CardDraft['launch']>;
  const home = homeOf(packet, { home: normalizeFolder(l.home) ?? '' });
  if (!home) throw new Error('A card needs at least one repo.');
  const mode: LaunchMode = LAUNCH_MODES.some((m) => m.id === l.mode) ? l.mode! : 'plan';
  const branch: BranchChoice = l.branch === 'current' || l.branch === 'worktree' ? l.branch : 'new';
  const model = CARD_MODELS.find((m) => m.id === l.model)?.id;
  const ticketKey = str(d.ticketKey, 60).trim();
  return {
    title, workspaceId, packet, ...(ticketKey ? { ticketKey } : {}),
    launch: { home, mode, branch, ...(model ? { model } : {}), message: str(l.message, 1000).replace(/[\r\n]+/g, ' ').trim() },
  };
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 20_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n')[0]));
      else resolve(stdout.trim());
    });
  });
}

/** claude.exe on PATH, so Windows Terminal starts the same one a terminal would. */
function findClaude(): string {
  if (process.env.CC_CONTROL_CLAUDE) return process.env.CC_CONTROL_CLAUDE;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const exe = join(dir, 'claude.exe');
    if (dir && existsSync(exe)) return exe;
  }
  return 'claude';
}

/**
 * The hook, as a settings file for `claude --settings`. Only card sessions load it. Written when a
 * card starts and when the server starts, so a card resumed by hand gets the current hooks.
 */
export function writeHookSettings(): string {
  const file = join(dirname(DB_PATH), 'claude-hooks.json');
  // A bare `node`, not a quoted path to node.exe: that runs in Git Bash and in the PowerShell
  // Claude Code falls back to without it (where a quoted path first is a parse error).
  const hook = (event: string, async = false) => [{
    hooks: [{ type: 'command', command: `node "${HOOK_SCRIPT.replace(/\\/g, '/')}" ${event}`, timeout: 15, ...(async ? { async: true } : {}) }],
  }];
  // SessionStart answers with the packet and UserPromptSubmit with anything added since, so Claude
  // waits for those two. The rest only report, so they run async and never slow Claude down.
  const hooks: Record<string, unknown> = { SessionStart: hook('SessionStart') };
  for (const e of TRACKED_EVENTS) hooks[e] = hook(e, e !== 'UserPromptSubmit');
  writeFileSync(file, JSON.stringify({ hooks }, null, 2));
  return file;
}

/**
 * Variables a running Claude Code session sets for what it starts. A server started from inside a
 * session (a restart run by Claude, say) inherits them, and a tab that inherits them in turn runs
 * as that session's child and never writes its own transcript. Settings people choose themselves
 * (CLAUDE_CODE_USE_BEDROCK and the like) are left alone.
 */
const SESSION_MARKERS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(CHILD_SESSION|SESSION_ID|SESSION_ATTENDED|ENTRYPOINT|EXECPATH|SSE_PORT|MESSAGING_\w+|BRIDGE_\w+))$/;

/** The environment of the new tab: the card and how to reach this server, minus the markers of any session this server runs under. */
export function tabEnv(base: NodeJS.ProcessEnv, cardId: string, token: string, port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) if (!SESSION_MARKERS.test(k)) env[k] = v;
  return { ...env, CC_CONTROL_CARD: cardId, CC_CONTROL_TOKEN: token, CC_CONTROL_URL: `http://127.0.0.1:${port}` };
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

interface CardOpts {
  port: number;
  /** CC_CONTROL_MODEL: every card without its own choice starts with this. */
  model?: string;
  /** The model in the user's Claude Code settings, read when a card starts. */
  userModel?: () => string | undefined;
  changed: () => void;
}

/** The "model" in ~/.claude/settings.json: what a plain `claude` would start with. */
export function userModel(file = join(homedir(), '.claude', 'settings.json')): string | undefined {
  try {
    const m = (JSON.parse(readFileSync(file, 'utf8')) as { model?: unknown }).model;
    return typeof m === 'string' && m.trim() ? m.trim() : undefined;
  } catch {
    return undefined;
  }
}

export class CardService {
  private waits = new Map<string, NodeJS.Timeout>();
  private store: Store;
  private opts: CardOpts;

  constructor(store: Store, opts: CardOpts) {
    this.store = store;
    this.opts = opts;
  }

  list(): Card[] {
    return this.store.loadCards();
  }

  /** The key the next card will get, for the new-card screen's preview. */
  peekKey(): string {
    return `CARD-${this.store.getMeta('cards.next') ?? '1'}`;
  }

  get(id: string): Card | undefined {
    return this.store.loadCards().find((c) => c.id === id);
  }

  private save(card: Card): void {
    this.store.saveCard(card);
    this.opts.changed();
  }

  private step(card: Card, text: string, state: BootStep['state'] = 'ok'): void {
    card.boot.push({ at: Date.now(), text, state });
  }

  /** Branch, then the terminal tab. Fails before saving anything if either can't be done, so the new-card screen can be fixed and retried. */
  async start(draft: CardDraft, ticket?: Ticket): Promise<Card> {
    const home = homeOf(draft.packet, draft.launch)!;
    if (ticket && this.list().some((c) => c.key === ticket.key)) throw new Error(`${ticket.key} already has a card on the line.`);
    // A ticket's card is called after the ticket; the rest are numbered.
    const key = ticket?.key ?? this.store.nextCardKey();
    const card: Card = {
      ...draft, ...(ticket ? { title: ticket.title, ticket } : {}),
      id: crypto.randomUUID(), key, stage: draft.launch.mode === 'plan' ? 'plan' : 'build', createdAt: Date.now(), boot: [],
    };
    if (!card.launch.message) card.launch.message = defaultMessage(key, card.launch.mode);
    const size = tokens(packetText(card, key, branchFor(key, card.title)));
    this.step(card, `Saved the context packet (${fmtK(size)})`);

    const branch = branchFor(key, card.title);
    card.cwd = home;
    if (card.launch.branch === 'current') {
      card.branchName = await git(home, ['branch', '--show-current']).catch(() => undefined) || undefined;
      this.step(card, card.branchName ? `Stayed on ${card.branchName} in ${repoName(home)}` : `Stayed where ${repoName(home)} is`);
    } else if (card.launch.branch === 'new') {
      await git(home, ['switch', '-c', branch]).catch((e: Error) => { throw new Error(`Couldn't make branch ${branch} in ${repoName(home)}: ${e.message}`); });
      card.branchName = branch;
      this.step(card, `Made branch ${branch} in ${repoName(home)}`);
    } else {
      const dir = worktreeFor(home, key);
      if (existsSync(dir)) throw new Error(`${dir} already exists, so the worktree can't go there.`);
      await git(home, ['worktree', 'add', dir, '-b', branch]).catch((e: Error) => { throw new Error(`Couldn't make a worktree for ${repoName(home)}: ${e.message}`); });
      card.cwd = dir;
      card.branchName = branch;
      this.step(card, `Made a worktree ${repoName(dir)} on ${branch}`);
    }

    card.model = modelFor(card.launch, this.opts.model, this.opts.userModel?.());
    const token = crypto.randomUUID();
    const others = includedRepos(card.packet).filter((r) => !samePath(r, home));
    const args = ['-w', '0', 'nt', '--title', key, '-d', card.cwd, findClaude(), '--settings', writeHookSettings(),
      '--permission-mode', card.launch.mode, ...((card.launch.model ?? this.opts.model) ? ['--model', card.launch.model ?? this.opts.model!] : []),
      ...others.flatMap((r) => ['--add-dir', r]), '--', wtArg(card.launch.message)];
    await new Promise<void>((resolve, reject) => {
      const child = spawn('wt.exe', args, { env: tabEnv(process.env, card.id, token, this.opts.port), stdio: 'ignore', windowsHide: true, detached: true });
      child.on('error', (e) => reject(new Error(`Couldn't open Windows Terminal (wt.exe): ${e.message}`)));
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Windows Terminal exited with code ${code}.`))));
      child.unref();
    });
    this.step(card, `Opened a Windows Terminal tab in ${card.cwd}${others.length ? ` with ${others.length} more repo${others.length === 1 ? '' : 's'}` : ''}`);
    this.step(card, 'Waiting for the session to start', 'go');
    this.store.saveCard(card, token);
    this.opts.changed();
    this.waits.set(card.id, setTimeout(() => this.noWord(card.id), HOOK_WAIT_MS));
    return card;
  }

  private noWord(id: string): void {
    this.waits.delete(id);
    const card = this.get(id);
    if (!card || card.sessionId) return;
    const i = card.boot.findIndex((b) => b.state === 'go');
    if (i >= 0) card.boot[i] = { at: Date.now(), text: 'No word from the session yet. If the tab asks whether to trust the folder, answer it there.', state: 'bad' };
    this.save(card);
  }

  /** The card a hook names, if its token matches, and the session the hook came from. */
  private checked(id: string, token: string, input: HookInput): { card: Card; sessionId: string } {
    const card = this.get(id);
    const expected = card && this.store.cardToken(id);
    if (!card || !expected || !sameToken(token, expected)) throw new Error('Unknown card or wrong token.');
    const sessionId = str(input.session_id, 80);
    if (!/^[\w-]{8,80}$/.test(sessionId)) throw new Error('No session id.');
    return { card, sessionId };
  }

  /**
   * The SessionStart hook: check the card's token, link the session, and return what the hook
   * prints (the packet as additionalContext). A resumed session already has the packet, so it
   * only gets linked; a cleared or compacted one lost it, so it gets it again.
   *
   * Once linked, only /clear in the card's tab moves the card to a new session. Anything else
   * starting with the card's variables (a `claude -p` that Claude runs inside the tab inherits
   * them, or /resume to another session) is not this card's session and gets nothing.
   */
  sessionStart(id: string, token: string, input: HookInput): object | null {
    const { card, sessionId } = this.checked(id, token, input);
    const source = str(input.source, 20) || 'startup';
    if (card.sessionId && card.sessionId !== sessionId && source !== 'clear') return null;
    clearTimeout(this.waits.get(id));
    this.waits.delete(id);
    const giving = source !== 'resume';
    // Anything added since goes with the packet: waiting items, and on /clear or compaction the
    // ones already sent, which the session has just lost.
    const later = card.later ?? [];
    let text = packetText(card, card.key, card.branchName);
    if (giving && later.length) {
      text += `

${laterText(card.key, later)}`;
      const now = Date.now();
      card.later = later.map((i) => (i.sent ? i : { ...i, sent: now }));
    }
    card.boot = card.boot.filter((b) => b.state !== 'go' && !(b.state === 'bad' && !card.sessionId));
    const again = card.sessionId ? (source === 'clear' ? ' after /clear' : source === 'compact' ? ' after compacting' : source === 'resume' ? ' (resumed)' : ' again') : '';
    if (giving) this.step(card, `SessionStart hook fetched the packet${again} (${fmtK(tokens(text))})`);
    if (card.sessionId !== sessionId) this.step(card, `Linked session ${sessionId.slice(0, 8)} to this card`);
    if (!card.sessionId) this.step(card, card.launch.mode === 'plan' ? 'Claude started on a plan' : 'Claude started work');
    card.sessionId = sessionId;
    card.live = { ...card.live, phase: 'working', text: 'Session started', at: Date.now(), mode: card.launch.mode };
    this.save(card);
    return giving ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } } : null;
  }

  /**
   * Any other hook event: follow the session on the card. Events from other sessions are ignored.
   * A message typed in the tab (UserPromptSubmit) also takes whatever waits on the card, and the
   * hook prints it as additionalContext, so it reaches Claude with that message.
   */
  hookEvent(id: string, token: string, event: string, input: HookInput): object | null {
    const { card, sessionId } = this.checked(id, token, input);
    if (card.sessionId !== sessionId) return null;
    let next = applyEvent(card, event, input, Date.now());
    const sending = event === 'UserPromptSubmit' ? waiting(next) : [];
    if (sending.length) {
      const now = Date.now();
      next = { ...next, later: next.later!.map((i) => (i.sent ? i : { ...i, sent: now })) };
    }
    if (next !== card) this.save(next);
    return sending.length ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: laterText(card.key, sending) } } : null;
  }

  /**
   * Add context to a card that has started: repos, related tickets and your note wait on it until
   * the session takes them (see hookEvent). What it already has is skipped; nothing new is an error.
   */
  addContext(id: string, rawItems: unknown, note: unknown): LaterItem[] {
    const card = this.get(id);
    if (!card) throw new Error('That card is no longer on the line.');
    if (card.stage === 'done') throw new Error(`${card.key} is done.`);
    const repos = cardRepos(card);
    const had = new Set([...card.packet.card, ...(card.later ?? [])].map((i) => i.id));
    if (card.ticket) had.add(`ticket:${card.ticket.key}`);
    const now = Date.now();
    const add: LaterItem[] = [];
    for (const i of cleanItems(rawItems)) {
      if (!i.on || i.kind === 'note' || had.has(i.id) || (i.kind === 'repo' && repos.some((r) => samePath(r, i.id)))) continue;
      had.add(i.id);
      add.push({ ...i, at: now });
    }
    const text = str(note, 8000).trim();
    if (text) add.push({ kind: 'note', id: `note:${now}`, label: `Your note: ${text.length > 60 ? `${text.slice(0, 59)}…` : text}`, text, on: true, at: now });
    if (!add.length) throw new Error(`Nothing new to add: ${card.key} already has all of that.`);
    this.save({ ...card, later: [...(card.later ?? []), ...add] });
    return add;
  }

  /** Take back something that is still waiting on the card. */
  withdraw(id: string, itemId: string): void {
    const card = this.get(id);
    const item = card?.later?.find((i) => i.id === itemId);
    if (!card || !item) return;
    if (item.sent) throw new Error('That has already gone to Claude.');
    this.save({ ...card, later: card.later!.filter((i) => i !== item) });
  }

  delete(id: string): void {
    clearTimeout(this.waits.get(id));
    this.waits.delete(id);
    this.store.deleteCard(id);
    this.opts.changed();
  }

  stop(): void {
    for (const t of this.waits.values()) clearTimeout(t);
  }
}
