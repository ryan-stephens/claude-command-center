import { getSessionMessages, query, renameSession, type ModelInfo, type Query, type SDKMessage, type SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { MODES, type ImageAttachment, type PermissionMode, type SessionActivity, type SessionStatus, type SessionSummary, type Todo, type TranscriptItem, type Workspace } from '../shared/protocol.ts';
import { applyEvent, backgroundRunning, idleActivity, setApproval, startTurn } from './activity.ts';
import { sdkClaude } from './claude-exe.ts';
import { withoutSecrets } from './config.ts';
import { applyTodos, NO_TODOS, type TodoState } from './todos.ts';
import { ACTIVE_ELSEWHERE_MS, HistoryIndex } from './history-index.ts';
import { InputQueue } from './input-queue.ts';
import { PermissionBroker } from './permission-broker.ts';
import { normalize } from './transcript.ts';
import { addPath, isInside, removePath, repoName, samePath, workspaceRepos } from '../shared/workspaces.ts';

// session_state_changed is only emitted with this flag (Phase 0 finding, PLAN.md §9).
const SDK_ENV = { ...withoutSecrets(process.env), CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' } as Record<string, string>;
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
  /** §119: the message it was started with, for Ctrl+K before the history knows it. */
  firstPrompt?: string;
  /** §115: tokens in the context window and the window they're measured against (the SDK's /context summary). */
  ctxTokens?: number;
  ctxMax?: number;
  /** §115: the session's running cost estimate in USD (the latest result's total_cost_usd). */
  costUsd?: number;
  /** §115: the branch its folder is on now (git), read at start and after each turn. */
  branch?: string;
  lastModified: number;
  slash?: SlashCommand[];
  activity: SessionActivity;
  activityTimer?: NodeJS.Timeout;
  /** Replaced by a restart (to pick up a new repo); its ending is not the session's. */
  replaced?: boolean;
  /** The extra repos its CLI was launched with (the SDK only takes them at launch). */
  dirs: string[];
  /** Its repos changed while it was busy: restart it into them once it is idle. */
  dirsStale?: boolean;
  /** Fresh after /clear: the next message names it. */
  untitled?: boolean;
  /** Claude's to-do list, as it keeps it. */
  todos: TodoState;
  /** Its CLI has said init once (it says it again every turn). */
  ready?: boolean;
  /** As its CLI reports them (init, and status on a mode change). */
  mode?: PermissionMode;
  model?: string;
}

/** Where each session's extra repos persist (SQLite), so resumes get them back. */
export interface DirStore {
  sessionDirs(id: string): string[];
  setSessionDirs(id: string, dirs: string[]): void;
}

/**
 * A Ticket Line card's session, which the app runs (§93): what its CLI starts with besides the
 * usual options (its model, the packet in its system prompt, the hooks that keep the card
 * current), the mode it starts in, and that it is the app's own, so a resume never forks it.
 */
export interface CardSession {
  options: Record<string, unknown>;
  mode?: PermissionMode;
  /** §117: folders the card's session can read besides its repos (Try it's logs). */
  dirs?: string[];
}

/** Sessions started by opening their card (warm) that no message has reached yet: at most this many run at once. */
const WARM_MAX = 2;
/** A warmed session younger than this isn't stopped to make room: its MCP servers may still be starting, and stopping a CLI then can leave them running. */
const WARM_SETTLE_MS = 30_000;

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
  /** A session's whole transcript was replaced (a fresh start after /clear). */
  transcript(id: string, items: TranscriptItem[]): void;
  /** A live session's to-do list changed. */
  todos(id: string, todos: Todo[]): void;
  /** A session's transcript file changed on disk (a terminal, or us). */
  fileChanged(id: string): void;
  /** A session's CLI said it is ready (its init): for the timing lines (§98). */
  ready(id: string): void;
}

export class SessionManager {
  readonly history: HistoryIndex;
  readonly broker: PermissionBroker;
  private live = new Map<string, LiveSession>();
  /** Sessions we stopped recently: their fresh mtime is ours, not a terminal's. */
  private recentlyOwned = new Map<string, number>();
  /** Last slash-command list seen per cwd, so history sessions get auto groups too. */
  private slashByCwd = new Map<string, SlashCommand[]>();
  /** The newest slash-command list seen from any session: most commands and skills are the same everywhere. */
  private lastSlash?: SlashCommand[];
  /** Models /model can switch to; the same for every session. */
  private models?: ModelInfo[];
  /** A CLI started only to ask for the command list (at most one at a time). */
  private probing = false;
  /** Started by warm() and not yet sent to, oldest first (each holds a CLI and its MCP servers). */
  private warmed: { id: string; at: number }[] = [];
  /** Resumes in flight: a second send while the transcript loads must join it, not start another CLI. */
  private starting = new Map<string, Promise<LiveSession>>();
  /** History id → the fork it became, so late sends to the old id follow the fork. */
  private forkedTo = new Map<string, string>();
  private events: SessionEvents;
  private dirs: DirStore;
  /** Modes chosen for sessions, applied when they (re)start; live ones also change at once. */
  private modes = new Map<string, PermissionMode>();
  /** Every workspace; a session can use all repos of the workspaces holding its cwd. */
  private workspaces: Workspace[] = [];
  /** The card a session belongs to, if any, as its CLI must start (every start: new, resumed, restarted). */
  private cardSession: (id: string) => CardSession | undefined = () => undefined;

  constructor(events: SessionEvents, broker: PermissionBroker, dirs: DirStore) {
    this.events = events;
    this.broker = broker;
    this.dirs = dirs;
    this.history = new HistoryIndex(() => events.sessionsChanged(), (id) => events.fileChanged(id), (id) => this.live.has(id));
  }

  /** This app runs the session (or just did): its updates stream, and its file writes are ours. */
  owns(id: string): boolean {
    return this.live.has(id) || (this.recentlyOwned.get(id) ?? 0) > Date.now() - ACTIVE_ELSEWHERE_MS;
  }

  summaries(): SessionSummary[] {
    const out = new Map<string, SessionSummary>();
    const now = Date.now();
    for (const h of this.history.sessions) {
      const owned = (this.recentlyOwned.get(h.sessionId) ?? 0) > now - ACTIVE_ELSEWHERE_MS;
      out.set(h.sessionId, {
        id: h.sessionId,
        title: h.customTitle || h.summary || h.firstPrompt || '(untitled)',
        ...(h.firstPrompt ? { firstPrompt: h.firstPrompt.slice(0, 200) } : {}),
        cwd: h.cwd ?? '',
        branch: h.gitBranch,
        lastModified: h.lastModified,
        live: false,
        activeElsewhere: !owned && h.lastModified > now - ACTIVE_ELSEWHERE_MS,
        extraDirs: this.extraDirsOf(h.sessionId),
        workspaceDirs: this.workspaceDirsOf(h.cwd ?? ''),
        mode: this.modes.get(h.sessionId),
      });
    }
    for (const l of this.live.values()) out.set(l.id, this.liveSummary(l));
    return [...out.values()].sort((a, b) => b.lastModified - a.lastModified);
  }

  /** Cards' sessions (§93): what each starts with, looked up by session id whenever one starts. */
  setCardSessions(lookup: (id: string) => CardSession | undefined): void {
    this.cardSession = lookup;
  }

  /** Live and between turns: nothing running, nothing waiting on an answer. */
  isIdle(id: string): boolean {
    const l = this.live.get(this.forkedTo.get(id) ?? id);
    return Boolean(l && l.status === 'idle' && !this.broker.hasPending(l.id));
  }

  isLive(id: string): boolean {
    return this.live.has(this.forkedTo.get(id) ?? id);
  }

  /** `id`: a fixed session id (a card links to it before its first message, §93). */
  async create(cwd: string, prompt?: string, extraDirs: string[] = [], id: string = crypto.randomUUID()): Promise<string> {
    if (!isDir(cwd)) throw new Error(`Not a directory: ${cwd}`);
    let dirs: string[] = [];
    for (const d of extraDirs) {
      if (!isDir(d)) throw new Error(`Not a directory: ${d}`);
      if (!samePath(d, cwd)) dirs = addPath(dirs, d);
    }
    this.dirs.setSessionDirs(id, dirs);
    const l = this.start({ id, cwd, title: firstLine(prompt) || 'New session', options: { sessionId: id } });
    if (prompt?.trim()) l.firstPrompt = prompt.trim();
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
   * Start a session that isn't running, with no message (§98): a card opened after a restart resumes
   * while you type, so Enter doesn't wait for its CLI to start. A send joins the start in progress.
   */
  warm(id: string): void {
    const target = this.forkedTo.get(id) ?? id;
    if (this.live.has(target) || this.starting.has(target)) return;
    const pending = this.resume(target).finally(() => this.starting.delete(target));
    this.starting.set(target, pending);
    pending.catch((e: Error) => { this.unwarm(target); console.warn(`warm ${target.slice(0, 8)}: ${e.message}`); });
    // Opening card after card mustn't leave a CLI running for each: the oldest unused one stops.
    this.warmed.push({ id: target, at: Date.now() });
    for (const old of this.warmed.slice(0, -WARM_MAX)) {
      if (!this.isIdle(old.id) || Date.now() - old.at < WARM_SETTLE_MS) continue; // still starting, or it has work after all
      this.unwarm(old.id);
      this.stop(old.id);
    }
  }

  private unwarm(id: string): void {
    this.warmed = this.warmed.filter((w) => w.id !== id);
  }

  /**
   * Send a turn. A history session is resumed on first send; if a terminal seems to
   * own it, it is forked instead so two writers never share one transcript.
   * Returns the id the turn went to.
   */
  async send(id: string, text: string, images: ImageAttachment[] = []): Promise<string> {
    const target = this.forkedTo.get(id) ?? id;
    this.unwarm(target); // in use now: never stopped for being idle
    let l = this.live.get(target);
    if (!l) {
      let pending = this.starting.get(target);
      if (!pending) {
        pending = this.resume(target).finally(() => this.starting.delete(target));
        this.starting.set(target, pending);
      }
      l = await pending;
    }
    // Images show as "[image]", the way they read back from the transcript on disk.
    const userItem: TranscriptItem = { kind: 'user', uuid: crypto.randomUUID(), text: text + images.map(() => '\n[image]').join('') };
    if (l.untitled && !text.startsWith('/')) { l.title = firstLine(text) || l.title; l.untitled = false; }
    l.items.push(userItem);
    this.events.items(l.id, [userItem]);
    l.input.push(text, images);
    this.setStatus(l, 'running');
    this.setActivity(l, startTurn(l.activity, Date.now()));
    return l.id;
  }

  private async resume(id: string): Promise<LiveSession> {
    const summary = this.summaries().find((s) => s.id === id);
    if (!summary) throw new Error(`Unknown session ${id}`);
    // A card's session is the app's own (§93): its fresh file is this server's work from before a restart, not a terminal's.
    const fork = Boolean(summary.activeElsewhere) && !this.cardSession(id);
    const newId = fork ? crypto.randomUUID() : id;
    if (fork) this.dirs.setSessionDirs(newId, this.dirs.sessionDirs(id));
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

  extraDirsOf(id: string): string[] | undefined {
    const dirs = this.dirs.sessionDirs(id);
    return dirs.length ? dirs : undefined;
  }

  /** Repos a session gets from its workspaces: every repo of every workspace holding its cwd, except its own. */
  workspaceDirsOf(cwd: string): string[] | undefined {
    const out = cwd ? workspaceRepos(cwd, this.workspaces) : [];
    return out.length ? out : undefined;
  }

  /** The other repos a session can use (its workspaces' and its own additions), for "@" file search. */
  usableDirs(id: string): string[] {
    const cwd = this.cwdOf(id);
    return cwd ? this.launchDirs(id, cwd) : [];
  }

  /** What a session's CLI launches with: its workspaces' repos plus its own, the ones that exist today. */
  private launchDirs(id: string, cwd: string): string[] {
    let out = this.workspaceDirsOf(cwd) ?? [];
    for (const d of this.dirs.sessionDirs(id)) if (!isInside(cwd, d)) out = addPath(out, d);
    return out.filter(isDir); // a repo on an unplugged drive must not stop the session starting
  }

  /** Workspaces changed: live sessions whose repos changed restart into them (now, or once idle). */
  setWorkspaces(workspaces: Workspace[]): void {
    this.workspaces = workspaces;
    for (const l of [...this.live.values()]) this.applyDirs(l);
  }

  /** Restart a live session into its current repos if they changed; a busy one waits until it is idle. */
  private applyDirs(l: LiveSession): void {
    if (this.live.get(l.id) !== l) return;
    const next = this.launchDirs(l.id, l.cwd);
    const added = next.filter((d) => !l.dirs.some((x) => samePath(x, d)));
    const removed = l.dirs.filter((d) => !next.some((x) => samePath(x, d)));
    if (!added.length && !removed.length) { l.dirsStale = false; return; }
    if (l.status !== 'idle' || backgroundRunning(l.activity)) { l.dirsStale = true; return; }
    const names = (list: string[]) => list.map(repoName).join(', ');
    const note = [added.length ? `Now also working in ${names(added)}.` : '', removed.length ? `No longer working in ${names(removed)}.` : ''].filter(Boolean).join(' ');
    this.restart(l, note);
  }

  /**
   * Let a session work in another repo too. The SDK only takes extra directories at launch, so a
   * live session restarts in place (same id, same transcript); a history session gets it on resume.
   */
  async addDir(id: string, path: string): Promise<void> {
    if (!isDir(path)) throw new Error(`Not a directory: ${path}`);
    const cwd = this.cwdOf(id);
    if (cwd && samePath(cwd, path)) return; // already its own repo
    await this.changeDirs(id, addPath(this.dirs.sessionDirs(id), path));
  }

  async removeDir(id: string, path: string): Promise<void> {
    await this.changeDirs(id, removePath(this.dirs.sessionDirs(id), path));
  }

  /** A repo added to a card (§93): a busy session takes it once it is idle, rather than refusing. */
  async addDirWhenIdle(id: string, path: string): Promise<void> {
    if (!isDir(path)) throw new Error(`Not a directory: ${path}`);
    const cwd = this.cwdOf(id);
    if (cwd && samePath(cwd, path)) return;
    await this.changeDirs(id, addPath(this.dirs.sessionDirs(id), path), true);
  }

  private async changeDirs(id: string, dirs: string[], whenIdle = false): Promise<void> {
    const before = this.dirs.sessionDirs(id);
    if (before.length === dirs.length && before.every((d, i) => samePath(d, dirs[i]))) return;
    const l = this.live.get(id);
    if (l && (l.status !== 'idle' || backgroundRunning(l.activity))) {
      if (!whenIdle) throw new Error('Claude is still working. Add or remove repos once it has finished.');
      this.dirs.setSessionDirs(id, dirs);
      l.dirsStale = true;
      return;
    }
    this.dirs.setSessionDirs(id, dirs);
    if (l) { this.applyDirs(l); this.emitUpsert(id); }
    else this.events.sessionsChanged();
  }

  /** Swap the CLI process under a live session, resuming the same transcript with new options. */
  private restart(l: LiveSession, note: string): void {
    l.replaced = true;
    this.live.delete(l.id); // pump() sees it is no longer current and won't retire the session
    clearTimeout(l.activityTimer);
    l.input.close();
    l.q.close();
    const began = l.items.some((i) => i.kind === 'user');
    const next = this.start({ id: l.id, cwd: l.cwd, title: l.title, items: [...l.items], options: began ? { resume: l.id } : { sessionId: l.id } });
    next.ctxPct = l.ctxPct;
    next.ctxTokens = l.ctxTokens;
    next.ctxMax = l.ctxMax;
    next.costUsd = l.costUsd;
    next.todos = l.todos;
    const notice: TranscriptItem = { kind: 'notice', uuid: crypto.randomUUID(), text: note };
    next.items.push(notice);
    this.events.items(l.id, [notice]);
    this.emitUpsert(l.id);
  }

  /** Change how much Claude may do without asking. Only the Shift+Tab modes; never bypassing permissions. */
  async setMode(id: string, mode: PermissionMode): Promise<void> {
    if (!MODES.includes(mode)) throw new Error('That mode is not available here.');
    const target = this.forkedTo.get(id) ?? id;
    const before = this.modes.get(target);
    this.modes.set(target, mode);
    const l = this.live.get(target);
    if (!l) { this.events.sessionsChanged(); return; }
    try {
      await l.q.setPermissionMode(mode);
    } catch (e) {
      // Auto isn't offered for every model (Haiku, say). Like Claude Code, the cycle skips it and
      // goes round to Asks first; staying on the previous mode would make Shift+Tab try Auto forever.
      if (mode === 'auto') {
        this.modes.set(target, 'default');
        await l.q.setPermissionMode('default').catch(() => {});
        l.mode = 'default';
        this.emitUpsert(target);
        throw new Error('Auto mode isn’t available for this model, so it’s back to Asks first. /model can switch to one that has it.');
      }
      if (before) this.modes.set(target, before);
      else this.modes.delete(target);
      throw e;
    }
    l.mode = mode;
    this.emitUpsert(target);
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

  /**
   * Slash commands for a session: its own, else its folder's, else the last seen anywhere. When
   * none are known yet, a CLI is asked once in its folder (no prompt, so no model call), and
   * clients are told to refetch when the list arrives.
   */
  slashFor(id: string): SlashCommand[] | undefined {
    const known = this.slashCommands(id) ?? this.lastSlash;
    const cwd = this.cwdOf(id);
    if (!known && cwd && isDir(cwd)) this.probeSlash(cwd);
    return known;
  }

  /** Models /model can switch to, once any CLI has said. */
  modelChoices(): ModelInfo[] | undefined {
    return this.models;
  }

  private probeSlash(cwd: string): void {
    if (this.probing) return;
    this.probing = true;
    async function* idle(): AsyncGenerator<never> { await new Promise(() => {}); }
    const q = query({ prompt: idle(), options: { cwd, model: MODEL, env: SDK_ENV, pathToClaudeCodeExecutable: sdkClaude() } });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 20_000));
    Promise.race([Promise.all([q.supportedCommands(), q.supportedModels()]), timeout])
      .then(([cmds, models]) => {
        this.slashByCwd.set(cwd, cmds);
        this.lastSlash = cmds;
        this.models = models;
        this.events.commandsChanged();
      }, () => { /* no suggestions until a session runs */ })
      .finally(() => { q.close(); this.probing = false; });
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

  /**
   * Test servers only (walk-perf, §95): a live session with no CLI under it. `feed` hands it SDK
   * messages, which take the same path a real CLI's do, so the app's own cost can be measured
   * without the API's.
   */
  phantom(id: string, cwd: string, items: TranscriptItem[]): void {
    if (this.live.has(id)) return;
    const q = { close() {}, async interrupt() {}, async setPermissionMode() {}, async getContextUsage() { return { percentage: 12 }; } } as unknown as Query;
    this.live.set(id, {
      id, cwd, title: 'Phantom', input: new InputQueue(), q,
      status: 'idle', items: [...items], partial: '', lastModified: Date.now(), activity: idleActivity(Date.now()), dirs: [], todos: NO_TODOS,
    });
    this.emitUpsert(id);
  }

  feed(id: string, msg: SDKMessage): void {
    const l = this.live.get(id);
    if (l) this.handle(l, msg);
  }

  private start(opts: { id: string; cwd: string; title: string; items?: TranscriptItem[]; options: Record<string, unknown> }): LiveSession {
    const input = new InputQueue();
    const id = opts.id;
    const dirs = this.launchDirs(id, opts.cwd);
    // Approvals follow the session if the CLI moves it to a new id (/clear does).
    let self: LiveSession | undefined;
    const card = this.cardSession(id);
    const q = query({
      prompt: input,
      options: {
        cwd: opts.cwd,
        model: MODEL,
        env: SDK_ENV,
        pathToClaudeCodeExecutable: sdkClaude(),
        includePartialMessages: true,
        permissionMode: this.modes.get(id) ?? card?.mode ?? 'default',
        additionalDirectories: card?.dirs?.length ? [...dirs, ...card.dirs.filter((d) => !dirs.some((x) => samePath(x, d)))] : dirs,
        canUseTool: (tool, toolInput, { signal, suggestions }) => this.broker.ask(self?.id ?? id, tool, toolInput, suggestions, signal),
        ...card?.options,
        ...opts.options,
      },
    });
    const l: LiveSession = {
      id, cwd: opts.cwd, title: opts.title, input, q,
      status: 'idle', items: opts.items ?? [], partial: '', lastModified: Date.now(), activity: idleActivity(Date.now()), dirs, todos: NO_TODOS,
    };
    self = l;
    this.live.set(id, l);
    this.readBranch(l);
    this.pump(l);
    q.supportedCommands().then((cmds) => this.setSlash(l, cmds), () => {});
    if (!this.models) q.supportedModels().then((m) => { this.models = m; this.events.commandsChanged(); }, () => {});
    return l;
  }

  /** §115: the branch the session's folder is on (a turn may have switched it); said to the page when it changes. */
  private readBranch(l: LiveSession): void {
    execFile('git', ['-C', l.cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      const b = err ? undefined : String(out).trim() || undefined;
      if (b === l.branch) return;
      l.branch = b;
      if (this.live.get(l.id) === l) this.emitUpsert(l.id);
    });
  }

  private async pump(l: LiveSession): Promise<void> {
    try {
      for await (const msg of l.q) {
        if (l.replaced) break; // restarted: the new query owns the session now
        this.handle(l, msg);
      }
    } catch (e) {
      if (l.replaced) return;
      const notice: TranscriptItem = { kind: 'notice', uuid: crypto.randomUUID(), text: `Session ended with an error: ${(e as Error).message}` };
      l.items.push(notice);
      this.events.items(l.id, [notice]);
    }
    if (this.live.get(l.id) === l) this.retire(l);
  }

  private handle(l: LiveSession, msg: SDKMessage): void {
    l.lastModified = Date.now();
    const todos = applyTodos(l.todos, msg as never);
    if (todos !== l.todos) {
      const changed = todos.todos !== l.todos.todos;
      l.todos = todos;
      if (changed) this.events.todos(l.id, todos.todos);
    }
    if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id && msg.session_id !== l.id) this.follow(l, msg.session_id);
    if (msg.type === 'system' && msg.subtype === 'init') {
      if (!l.ready) { l.ready = true; this.events.ready(l.id); }
      l.mode = msg.permissionMode;
      l.model = msg.model;
      this.emitUpsert(l.id);
    }
    if (msg.type === 'system' && msg.subtype === 'status' && msg.permissionMode && msg.permissionMode !== l.mode) {
      l.mode = msg.permissionMode; // e.g. the CLI left plan mode itself
      this.modes.set(l.id, msg.permissionMode);
      this.emitUpsert(l.id);
    }
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
      // §115: the running total, cumulative across turns (a crash or startup error may carry 0: keep the last).
      if (typeof msg.total_cost_usd === 'number' && msg.total_cost_usd > 0) l.costUsd = msg.total_cost_usd;
      l.q.getContextUsage({ detail: 'summary' }).then(
        (u) => { l.ctxPct = u.percentage; l.ctxTokens = u.totalTokens; l.ctxMax = u.rawMaxTokens; this.emitUpsert(l.id); },
        () => {},
      );
      this.readBranch(l);
    }
  }

  /**
   * The CLI moved the session to a new id: `/clear` starts a fresh conversation that way. Follow it,
   * so later turns, restarts and resumes use the new one; the cleared conversation stays in the list.
   */
  private follow(l: LiveSession, newId: string): void {
    const old = l.id;
    this.live.delete(old);
    l.id = newId;
    this.live.set(newId, l);
    this.dirs.setSessionDirs(newId, this.dirs.sessionDirs(old));
    const mode = this.modes.get(old);
    if (mode) this.modes.set(newId, mode);
    this.forkedTo.set(old, newId);
    this.recentlyOwned.set(old, Date.now()); // its fresh mtime is ours, not a terminal's
    this.broker.cancelSession(old);
    l.items = [{ kind: 'notice', uuid: crypto.randomUUID(), text: 'Fresh start: Claude no longer sees the earlier conversation. That one stays in the list under Earlier.' }];
    l.title = 'Fresh start';
    l.untitled = true;
    l.todos = NO_TODOS;
    this.events.todos(newId, []);
    this.events.forked(old, newId);
    this.events.transcript(newId, l.items);
    this.emitUpsert(newId);
    this.history.refresh().finally(() => this.events.sessionsChanged());
  }

  private setSlash(l: LiveSession, cmds: SlashCommand[]): void {
    l.slash = cmds;
    this.slashByCwd.set(l.cwd, cmds);
    this.lastSlash = cmds;
    this.events.commandsChanged();
  }

  private setStatus(l: LiveSession, status: SessionStatus): void {
    if (l.status === status) return;
    l.status = status;
    // A turn the CLI starts by itself (after a background task, say) is a turn too.
    if (status === 'running' && l.activity.turnStartedAt === undefined) this.setActivity(l, startTurn(l.activity, Date.now()));
    this.emitUpsert(l.id);
    this.applyWhenIdle(l);
  }

  /** A workspace change waited for this session to finish; apply it now (outside the message loop). */
  private applyWhenIdle(l: LiveSession): void {
    if (l.dirsStale && l.status === 'idle' && !backgroundRunning(l.activity)) setTimeout(() => this.applyDirs(l), 0);
  }

  private retire(l: LiveSession): void {
    this.live.delete(l.id);
    this.unwarm(l.id);
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
      ...((h?.firstPrompt ?? l.firstPrompt) ? { firstPrompt: (h?.firstPrompt ?? l.firstPrompt)!.slice(0, 200) } : {}),
      cwd: l.cwd,
      branch: l.branch ?? h?.gitBranch,
      lastModified: Math.max(l.lastModified, h?.lastModified ?? 0),
      live: true,
      status: l.status,
      ctxPct: l.ctxPct,
      ...(l.ctxTokens !== undefined ? { ctxTokens: l.ctxTokens } : {}),
      ...(l.ctxMax ? { ctxMax: l.ctxMax } : {}),
      ...(l.costUsd !== undefined ? { costUsd: l.costUsd } : {}),
      background: backgroundRunning(l.activity) || undefined,
      extraDirs: this.extraDirsOf(l.id),
      workspaceDirs: this.workspaceDirsOf(l.cwd),
      mode: l.mode,
      model: l.model,
    };
  }

  /** Every live session's to-do list, for clients that just connected. */
  allTodos(): [string, Todo[]][] {
    return [...this.live.values()].filter((l) => l.todos.todos.length).map((l) => [l.id, l.todos.todos]);
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
    if (backgroundRunning(activity) !== bgBefore) {
      this.emitUpsert(l.id); // list badge
      if (bgBefore) this.applyWhenIdle(l);
    }
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
