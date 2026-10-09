import type { CardDraft, PacketItem } from '../shared/cards.ts';
import { LOG_KEEP, runKey, wsRecipeKey } from '../shared/recipes.ts';
import type { StackChoice } from '../shared/stack.ts';
import type { Changes } from '../shared/changes.ts';
import type { TicketTransition } from '../shared/tickets.ts';
import type { ShipPlan, ShipRequest } from '../shared/ship.ts';
import { PROTOCOL, type ClientMsg, type CommandPack, type FileHit, type FolderListing, type ImageAttachment, type RepoInfo, type ServerMsg, type WorkspaceFile } from '../shared/protocol.ts';
import type { PromptContext } from '../shared/prompts.ts';
import type { BuilderEnv, BuilderProc, BuilderRun, BuilderScenario, EnvCheck, FieldChange, LookupResult, SetInfo, UpdateSent, VerifyEnv } from '../shared/verify.ts';
import { onCardChange, onStatusChange } from './attention.ts';
import { haveOf, mergeTranscript } from './transcript-merge.ts';
import { activeSession, flash, get, groupKeyOf, set, setFilter, syncSeen } from './store.ts';

let socket: WebSocket | null = null;
let retryMs = 1000;
/** When the newest approval card appeared; Y/A/N are ignored briefly after, so typing can't answer it. */
export let lastPermissionAt = 0;
const pendingCreates = new Map<string, { resolve: (id: string) => void; reject: (e: Error) => void }>();
const pendingExports = new Map<string, (pack: CommandPack) => void>();
const pendingWorkspaceFiles = new Map<string, (file: WorkspaceFile) => void>();
/** Requests a dialog waits on: the reply with the same reqId resolves it, an error with it rejects it. */
const pendingRequests = new Map<string, { resolve: (msg: ServerMsg) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
/** The server said hello on this connection (servers from before the handshake never do). */
let greeted = false;

/**
 * Streaming text waits for the next frame (§96): one store update per frame however many deltas
 * arrived, rather than one per token for every component that reads the store. A clear goes at once
 * (its message is landing in the transcript).
 */
const pendingPartials = new Map<string, string>();
let partialTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * While a key was pressed this recently, streaming text waits longer between draws (§99): the frames
 * go to what you type, and the text catches up when you pause. On a slow laptop drawing the text
 * every frame made a key wait for it.
 */
const TYPING_MS = 200;
const TYPING_DRAW_MS = 120;
let lastKeyAt = -Infinity;
if (typeof window !== 'undefined') window.addEventListener('keydown', () => { lastKeyAt = performance.now(); }, true);
function flushPartials(): void {
  partialTimer = undefined;
  if (!pendingPartials.size) return;
  set({ partials: { ...get().partials, ...Object.fromEntries(pendingPartials) } });
  pendingPartials.clear();
}
function queuePartial(id: string, text: string, from?: number): void {
  // A delta (§97) goes on the end of what the page has: what waits for this frame, else the store's.
  if (from !== undefined) {
    const base = pendingPartials.get(id) ?? get().partials[id] ?? '';
    if (from > base.length) return; // a gap: never on one connection, which is ordered
    text = base.slice(0, from) + text;
  }
  if (!text) {
    pendingPartials.delete(id);
    if (get().partials[id]) set({ partials: { ...get().partials, [id]: '' } });
    return;
  }
  pendingPartials.set(id, text);
  if (partialTimer !== undefined) return;
  // Typing: a few draws a second. Otherwise the next frame; a hidden tab gets no frames, so a timer stands in.
  if (performance.now() - lastKeyAt < TYPING_MS) { partialTimer = setTimeout(flushPartials, TYPING_DRAW_MS); return; }
  partialTimer = setTimeout(flushPartials, 50);
  requestAnimationFrame(() => { if (partialTimer !== undefined) { clearTimeout(partialTimer); flushPartials(); } });
}

/** Open a session's transcript, saying how much of it the page holds, so only the rest comes (§97). */
export function openTranscript(id: string): void {
  send({ type: 'session.open', id, have: haveOf(get().transcripts[id]) });
}

const OUTDATED = 'The cc-control server is older than this page, so it ignores this. Restart it: stop it and run pnpm start.';

export function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onopen = () => {
    retryMs = 1000;
    // The server re-sends every pending approval on connect; anything we still hold is stale.
    greeted = false;
    pendingPartials.clear();
    set({ connected: true, lastError: null, permissions: {}, partials: {}, activity: {}, outdated: null });
    const { openId } = get();
    if (openId) {
      openTranscript(openId);
      send({ type: 'board.get', sessionId: openId });
    }
    // The Output views open on the page follow their runs again on the new connection.
    if (following.size) send({ type: 'run.follow', keys: [...following.keys()] });
  };
  socket.onclose = () => {
    set({ connected: false });
    // Replies to in-flight requests died with the socket; fail them so no dialog hangs.
    for (const p of pendingCreates.values()) p.reject(new Error('Lost the connection to the cc-control server. Try again.'));
    pendingCreates.clear();
    pendingExports.clear();
    pendingWorkspaceFiles.clear();
    for (const p of pendingRequests.values()) { clearTimeout(p.timer); p.reject(new Error('Lost the connection to the cc-control server. Try again.')); }
    pendingRequests.clear();
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 10_000); // back off while the server is down

  };
  socket.onmessage = (e) => receive(JSON.parse(e.data) as ServerMsg);
}

export function send(msg: ClientMsg): boolean {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
    return true;
  }
  set({ lastError: 'Not connected to the cc-control server.' });
  return false;
}

export function createSession(cwd: string, prompt?: string, extraDirs?: string[]): Promise<string> {
  const reqId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pendingCreates.set(reqId, { resolve, reject });
    if (!send({ type: 'session.create', reqId, cwd, prompt, extraDirs })) {
      pendingCreates.delete(reqId);
      reject(new Error('Not connected to the cc-control server. Try again in a moment.'));
    }
  });
}

/**
 * Send a message and wait for its answer. A server that never answers (one from before the message
 * existed drops it silently) fails the request after a while instead of leaving the dialog hanging.
 */
function request(build: (reqId: string) => ClientMsg, timeoutMs = 10_000): Promise<ServerMsg> {
  if (get().outdated === 'server') return Promise.reject(new Error(OUTDATED));
  const reqId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(reqId);
      reject(new Error('The cc-control server did not answer. If it has been running since before an update, restart it with pnpm start.'));
    }, timeoutMs);
    pendingRequests.set(reqId, { resolve, reject, timer });
    if (!send(build(reqId))) {
      clearTimeout(timer);
      pendingRequests.delete(reqId);
      reject(new Error('Not connected to the cc-control server. Try again in a moment.'));
    }
  });
}

/** Subfolders of a folder for the folder picker; no path lists the starting points. */
export async function listFolder(path?: string): Promise<FolderListing> {
  const reply = await request((reqId) => ({ type: 'fs.list', reqId, path }));
  return (reply as Extract<ServerMsg, { type: 'fs.list' }>).listing;
}

/** The machine's own folder dialog (Windows Explorer's): the folder chosen, or null when cancelled. Waits as long as the dialog is open. */
export async function pickFolderOnDisk(): Promise<string | null> {
  const reply = await request((reqId) => ({ type: 'fs.pickFolder', reqId }), 10 * 60_000);
  return (reply as Extract<ServerMsg, { type: 'fs.picked' }>).path ?? null;
}

/** A folder of repos for one card (§65): scanned on the server, saved nowhere. The canonical path and the repos inside it (none: not a folder of repos). */
export async function peekRepoSource(path: string): Promise<{ path: string; repos: RepoInfo[] }> {
  const reply = await request((reqId) => ({ type: 'library.peek', reqId, path }), 30_000);
  const { source, repos } = reply as Extract<ServerMsg, { type: 'library.peeked' }>;
  return { path: source, repos };
}

/** Have Claude write the opening message from rough text and the card's context (§62). A cheap model, one turn; up to a minute. */
export async function writeMessageWithClaude(text: string, context: PromptContext): Promise<string> {
  const reply = await request((reqId) => ({ type: 'prompt.write', reqId, text, context }), 90_000);
  return (reply as Extract<ServerMsg, { type: 'prompt.written' }>).text;
}

/** Files in a session's repos for "@" suggestions (names only). */
export async function searchFiles(sessionId: string, query: string): Promise<FileHit[]> {
  const reply = await request((reqId) => ({ type: 'fs.files', reqId, sessionId, query }));
  return (reply as Extract<ServerMsg, { type: 'fs.files' }>).hits;
}

/** Start a card: the server saves it, makes its branch and opens the terminal tab. Resolves with its id. */
export async function startCard(draft: CardDraft): Promise<string> {
  const reply = await request((reqId) => ({ type: 'card.start', reqId, draft }), 60_000);
  return (reply as Extract<ServerMsg, { type: 'card.started' }>).id;
}

/** Add context to a running card: it waits there until the next message typed in its tab. */
export async function addCardContext(id: string, items: PacketItem[], note: string): Promise<void> {
  await request((reqId) => ({ type: 'card.addContext', reqId, id, items, note }));
}

/** Search the tracker for any ticket, by key or words. */
export async function searchTickets(q: string): Promise<Extract<ServerMsg, { type: 'tickets.found' }>> {
  return await request((reqId) => ({ type: 'tickets.search', reqId, q }), 30_000) as Extract<ServerMsg, { type: 'tickets.found' }>;
}

/** Writes to the tracker, each from an explicit key on the page. */
export async function commentTicket(key: string, text: string): Promise<void> {
  await request((reqId) => ({ type: 'tickets.comment', reqId, key, text }), 30_000);
}
export async function ticketTransitions(key: string): Promise<TicketTransition[]> {
  const reply = await request((reqId) => ({ type: 'tickets.transitions', reqId, key }), 30_000);
  return (reply as Extract<ServerMsg, { type: 'tickets.transitions' }>).transitions;
}
export async function moveTicket(key: string, id: string): Promise<void> {
  await request((reqId) => ({ type: 'tickets.transition', reqId, key, id }), 30_000);
}

/** The pull request for a ticket in these repos, or why there is none. */
export async function findPr(key: string, repos: string[]): Promise<Extract<ServerMsg, { type: 'pr.found' }>> {
  return await request((reqId) => ({ type: 'card.findPr', reqId, key, repos }), 60_000) as Extract<ServerMsg, { type: 'pr.found' }>;
}

/** Try it: run the card's recipe, or its workspace's stack with what was picked. Rejects with the server's reason (no recipe, folder gone). */
/** Shift+X: the card's worktrees as they are now. */
export async function cardWorktrees(id: string): Promise<Extract<ServerMsg, { type: 'card.worktrees' }>> {
  return await request((reqId) => ({ type: 'card.worktrees', reqId, id }), 60_000) as Extract<ServerMsg, { type: 'card.worktrees' }>;
}

/** Remove them (the clean ones, or all with `force`), and the card too when asked. */
export async function removeCardWorktrees(id: string, force: boolean, thenDelete: boolean): Promise<Extract<ServerMsg, { type: 'card.worktreesRemoved' }>> {
  return await request((reqId) => ({ type: 'card.removeWorktrees', reqId, id, force, thenDelete }), 120_000) as Extract<ServerMsg, { type: 'card.worktreesRemoved' }>;
}

/** Try it: the card's recipe; with a stack, `choice` starts a session of every picked service, `service` starts (again) one service of the session that is up (§82). */
export async function tryCard(id: string, choice?: StackChoice, service?: string): Promise<void> {
  await request((reqId) => ({ type: 'card.try', reqId, id, ...(choice ? { choice } : {}), ...(service ? { service } : {}) }), 60_000);
}

/** o on a card whose UI is behind a front door (§123): the door shows that card's UI. */
export async function showDoor(id: string): Promise<void> {
  await request((reqId) => ({ type: 'door.show', reqId, id }), 10_000);
}

/** Verify (§105): each id in each environment, from the set tool (ValidateField, with the cached set's version). */
export async function verifyCheck(envs: VerifyEnv[], ids: string[]): Promise<EnvCheck[]> {
  return (await request((reqId) => ({ type: 'verify.check', reqId, envs, ids }), 90_000) as Extract<ServerMsg, { type: 'verify.checked' }>).envs;
}

/** Read an environment's current set again (it is cached for ten minutes otherwise). */
export async function verifyRefresh(env: VerifyEnv): Promise<SetInfo> {
  return (await request((reqId) => ({ type: 'verify.refresh', reqId, env }), 90_000) as Extract<ServerMsg, { type: 'verify.set' }>).set;
}

/** A record's fields from the record lookup. The values stay in this page's memory. */
export async function verifyLookup(env: VerifyEnv, recordId: string, ids: string[], advanced: boolean, session = true): Promise<LookupResult> {
  return (await request((reqId) => ({ type: 'verify.lookup', reqId, env, recordId, ids, advanced, ...(session ? {} : { session: false }) }), 120_000) as Extract<ServerMsg, { type: 'verify.found' }>).result;
}

/** §134: send staged changes through the record lookup's update form. Success means sent, not applied. */
export async function verifyUpdate(token: string, changes: FieldChange[]): Promise<UpdateSent> {
  const m = await request((reqId) => ({ type: 'verify.update', reqId, token, changes }), 120_000) as Extract<ServerMsg, { type: 'verify.updated' }>;
  return { sent: m.sent, ...(m.watchUrl ? { watchUrl: m.watchUrl } : {}) };
}

/** Save the Fields box as a named list for the lookup (§132); the lists come back to every page as verify.lists. */
export async function verifyListSave(name: string, ids: string[]): Promise<void> {
  await request((reqId) => ({ type: 'verify.lists.save', reqId, name, ids }), 10_000);
}

/** Delete a saved field list. */
export async function verifyListDelete(name: string): Promise<void> {
  await request((reqId) => ({ type: 'verify.lists.delete', reqId, name }), 10_000);
}

/** The scenario runner's scenarios (§133). */
export async function builderList(): Promise<BuilderScenario[]> {
  return (await request((reqId) => ({ type: 'builder.list', reqId }), 20_000) as Extract<ServerMsg, { type: 'builder.scenarios' }>).scenarios;
}

/** Start a run in Dev or UAT: it creates test loans there. */
export async function builderStart(env: BuilderEnv, scenarioId: string, version: number): Promise<string> {
  return (await request((reqId) => ({ type: 'builder.start', reqId, env, scenarioId, version }), 20_000) as Extract<ServerMsg, { type: 'builder.started' }>).runId;
}

/** How a run is going. Its loan ids and messages stay in this page's memory. */
export async function builderStatus(runId: string): Promise<BuilderRun> {
  return (await request((reqId) => ({ type: 'builder.status', reqId, runId }), 20_000) as Extract<ServerMsg, { type: 'builder.run' }>).run;
}

/** §135: start the test-data tool with this machine's launch commands (the server has them; the page sends none). */
export async function builderLaunch(): Promise<BuilderProc> {
  return (await request((reqId) => ({ type: 'builder.launch', reqId }), 20_000) as Extract<ServerMsg, { type: 'builder.proc' }>).proc;
}

/** Stop what builderLaunch started. */
export async function builderHalt(): Promise<BuilderProc> {
  return (await request((reqId) => ({ type: 'builder.halt', reqId }), 10_000) as Extract<ServerMsg, { type: 'builder.proc' }>).proc;
}

/** Stop the card's run (every service and the session), or one service alone. */
export function stopRun(id: string, service?: string): void {
  send({ type: 'card.stopRun', id, ...(service ? { service } : {}) });
}

/** How many Output views follow each run key right now (§84); the server is told the set whenever it changes. */
const following = new Map<string, number>();

/** Follow a run's output (its log arrives, then each line as it prints). Returns the way to stop. */
export function followRun(key: string): () => void {
  const n = following.get(key) ?? 0;
  following.set(key, n + 1);
  if (n === 0) send({ type: 'run.follow', keys: [...following.keys()] });
  return () => {
    const m = (following.get(key) ?? 1) - 1;
    if (m > 0) { following.set(key, m); return; }
    following.delete(key);
    send({ type: 'run.follow', keys: [...following.keys()] });
  };
}

/** A message to the card's session (§93: the app runs it; a session not running is resumed first). Rejects when it can't go in. */
export async function sayToCard(id: string, text: string, images: ImageAttachment[] = []): Promise<void> {
  // Long enough for a session to be resumed first (a terminal card's legacy tab, §85, takes longest).
  await request((reqId) => ({ type: 'card.send', reqId, id, text, ...(images.length ? { images } : {}) }), 120_000);
}

/** Answer what the card's session is asking: through the broker (§93), or a terminal card's channel or launcher. */
export async function answerCard(id: string, requestId: string | undefined, behavior: 'allow' | 'deny'): Promise<void> {
  await request((reqId) => ({ type: 'card.answer', reqId, id, ...(requestId ? { requestId } : {}), behavior }), 30_000);
}

/** The answers to Claude's question form (§91): back with the tool call (§93), or pressed into a terminal card's tab by its launcher. */
export async function answerQuestionCard(id: string, answers: { picks: number[]; other?: string }[]): Promise<void> {
  await request((reqId) => ({ type: 'card.answerQuestion', reqId, id, answers }), 30_000);
}

/** g: the card in a terminal tab (§93: a session the app runs moves to a new one; a terminal card's comes to the front). True when a new tab was opened on the session. */
export async function focusCardTab(id: string): Promise<boolean> {
  const reply = await request((reqId) => ({ type: 'card.focusTab', reqId, id }), 20_000);
  return reply.type === 'ok' && reply.note === 'reopened';
}

/** The picker's rows for a card's stack: which APIs it has, which changed, which to tick. */
export async function stackPlan(id: string): Promise<Extract<ServerMsg, { type: 'stack.plan' }>> {
  return await request((reqId) => ({ type: 'card.stackPlan', reqId, id }), 60_000) as Extract<ServerMsg, { type: 'stack.plan' }>;
}

/** Save a workspace's stack (the server checks it and says what's wrong); null removes it. */
export async function saveStack(workspaceId: string, stack: unknown): Promise<void> {
  await request((reqId) => ({ type: 'stack.save', reqId, workspaceId, stack }));
}

/** What the workspace's repos say its stack is, and how each part was found. */
export async function detectStack(workspaceId: string): Promise<Extract<ServerMsg, { type: 'stack.detected' }>> {
  return await request((reqId) => ({ type: 'stack.detect', reqId, workspaceId }), 60_000) as Extract<ServerMsg, { type: 'stack.detected' }>;
}

/** Save the run recipe you wrote for a repo (no steps: back to the detected one), or for a workspace (no steps: none). */
export async function saveRecipe(target: { repo: string } | { workspaceId: string }, steps: string[], url?: string): Promise<void> {
  await request((reqId) => ({ type: 'recipe.save', reqId, ...target, steps, ...(url ? { url } : {}) }));
}

/** Ship: what it will do for the card. */
/** What the card changed, each file with its patch (git runs on the server). */
export async function cardChanges(id: string): Promise<Changes> {
  const reply = await request((reqId) => ({ type: 'card.changes', reqId, id }), 90_000);
  return (reply as Extract<ServerMsg, { type: 'card.changes' }>).changes;
}

export async function shipPlan(id: string): Promise<ShipPlan> {
  const reply = await request((reqId) => ({ type: 'card.shipPlan', reqId, id }), 30_000);
  return (reply as Extract<ServerMsg, { type: 'ship.plan' }>).plan;
}

/** Ship: commit, push and open the PR. Its steps show on the card as they happen. */
export async function shipCard(id: string, req: ShipRequest): Promise<void> {
  await request((reqId) => ({ type: 'card.ship', reqId, id, request: req }), 180_000);
}

export async function refreshPr(id: string): Promise<void> {
  await request((reqId) => ({ type: 'card.prRefresh', reqId, id }), 30_000);
}

export async function mergeCard(id: string): Promise<void> {
  await request((reqId) => ({ type: 'card.merge', reqId, id }), 120_000);
}

/** Replace the repo library's folders; rejects with the server's reason (a missing folder, say). */
export async function setSources(sources: string[]): Promise<void> {
  await request((reqId) => ({ type: 'library.setSources', reqId, sources }));
}

export function requestExport(): Promise<CommandPack> {
  const reqId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pendingExports.set(reqId, resolve);
    if (!send({ type: 'pack.export', reqId })) {
      pendingExports.delete(reqId);
      reject(new Error('Not connected'));
    }
  });
}

export function requestWorkspaceFile(id: string): Promise<WorkspaceFile> {
  const reqId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pendingWorkspaceFiles.set(reqId, resolve);
    if (!send({ type: 'workspace.export', reqId, id })) {
      pendingWorkspaceFiles.delete(reqId);
      reject(new Error('Not connected'));
    }
  });
}

function receive(msg: ServerMsg): void {
  if (msg.type === 'hello') {
    greeted = true;
    set({ outdated: msg.protocol < PROTOCOL ? 'server' : msg.protocol > PROTOCOL ? 'page' : null });
    return;
  }
  // A server from before the handshake starts with its session list and drops newer messages.
  if (!greeted && !get().outdated) set({ outdated: 'server' });
  const reqId = 'reqId' in msg ? msg.reqId : undefined;
  const waiting = reqId ? pendingRequests.get(reqId) : undefined;
  if (waiting) {
    clearTimeout(waiting.timer);
    pendingRequests.delete(reqId!);
    if (msg.type === 'error') waiting.reject(new Error(msg.message));
    else waiting.resolve(msg);
    return; // the dialog that asked shows the answer (and any error) itself
  }
  switch (msg.type) {
    case 'sessions': {
      const before = new Map(get().sessions.map((s) => [s.id, s.status]));
      set({ sessions: msg.sessions, repos: msg.repos });
      // Snapshots carry live statuses too, so they can be where a transition shows up first.
      for (const s of msg.sessions) if (before.has(s.id)) onStatusChange(before.get(s.id), s);
      return;
    }
    case 'session.upsert': {
      const prev = get().sessions.find((s) => s.id === msg.session.id);
      const sessions = get().sessions.filter((s) => s.id !== msg.session.id);
      sessions.push(msg.session);
      sessions.sort((a, b) => b.lastModified - a.lastModified);
      set({ sessions });
      onStatusChange(prev?.status, msg.session);
      return;
    }
    case 'session.created':
      pendingCreates.get(msg.reqId)?.resolve(msg.id);
      pendingCreates.delete(msg.reqId);
      return;
    case 'session.forked': {
      const s = get();
      set({
        transcripts: { ...s.transcripts, [msg.newId]: s.transcripts[msg.newId] ?? s.transcripts[msg.oldId] ?? [] },
        openId: s.openId === msg.oldId ? msg.newId : s.openId,
      });
      if (get().openId === msg.newId) send({ type: 'board.get', sessionId: msg.newId });
      return;
    }
    case 'session.transcript': {
      // The page's own items are kept (§97): a warm card shows at once and isn't drawn again.
      const before = get().transcripts[msg.id];
      const next = mergeTranscript(before, msg.items, msg.from);
      if (!next) send({ type: 'session.open', id: msg.id }); // its copy was replaced meanwhile: all of it, then
      else if (next !== before) set({ transcripts: { ...get().transcripts, [msg.id]: next } });
      return;
    }
    case 'session.items': {
      const t = get().transcripts;
      set({ transcripts: { ...t, [msg.id]: [...(t[msg.id] ?? []), ...msg.items] } });
      return;
    }
    case 'session.activity':
      set({ activity: { ...get().activity, [msg.id]: msg.activity } });
      return;
    case 'session.todos':
      set({ todos: { ...get().todos, [msg.id]: msg.todos } });
      return;
    case 'session.partial':
      queuePartial(msg.id, msg.text, msg.from);
      return;
    case 'permission.request': {
      set({ permissions: { ...get().permissions, [msg.request.reqId]: msg.request } });
      lastPermissionAt = performance.now();
      // The card takes focus in the open session so Y / A / N work straight away, but never out
      // of the message box: letters you're typing must not answer it (Tab gets you there).
      const s = get();
      if (activeSession(s) === msg.request.sessionId && s.zone !== 'composer') set({ zone: 'board' });
      return;
    }
    case 'permission.resolved': {
      const { [msg.reqId]: _, ...rest } = get().permissions;
      set({ permissions: rest });
      return;
    }
    case 'board':
      if (msg.sessionId === get().openId) {
        // A board without the selected group (deleted, or another repo) resets the selection explicitly.
        const keep = msg.groups.some((g) => groupKeyOf(g) === get().groupKey);
        set({
          board: { sessionId: msg.sessionId, groups: msg.groups },
          ...(msg.slash ? { slash: { sessionId: msg.sessionId, commands: msg.slash, models: msg.models ?? [] } } : {}),
          ...(keep ? {} : { groupKey: msg.groups[0] ? groupKeyOf(msg.groups[0]) : null }),
        });
      }
      return;
    case 'commands.changed': {
      const { openId } = get();
      if (openId) send({ type: 'board.get', sessionId: openId });
      return;
    }
    case 'settings':
      set({ settings: msg.settings });
      return;
    case 'prompts':
      set({ prompts: msg.prompts });
      return;
    case 'workspaces': {
      const { filter } = get().line;
      set({ workspaces: msg.workspaces, workspacesLoaded: true });
      // A remembered workspace that is gone: show them all.
      if (filter !== 'all' && !msg.workspaces.some((w) => w.id === filter)) setFilter('all');
      return;
    }
    case 'library':
      set({ library: { sources: msg.sources, repos: msg.repos, suggested: msg.suggested } });
      return;
    case 'card.upsert': {
      // One card changed (§97): the others keep their objects, so what shows them doesn't redraw.
      const cards = get().cards;
      const at = cards.findIndex((c) => c.id === msg.card.id);
      const before = at >= 0 ? cards[at] : undefined;
      set({ cards: at >= 0 ? cards.map((c, i) => (i === at ? msg.card : c)) : [...cards, msg.card], nextKey: msg.nextKey });
      onCardChange(before, msg.card);
      return;
    }
    case 'cards': {
      const before = new Map(get().cards.map((c) => [c.id, c]));
      set({ cards: msg.cards, nextKey: msg.nextKey, cardModel: msg.model ?? null, userModel: msg.userModel ?? null, cardsInTerminal: msg.inTerminal === true });
      for (const c of msg.cards) onCardChange(before.get(c.id), c);
      syncSeen(msg.cards);
      return;
    }
    case 'tickets':
      set({ tickets: msg.tickets, ticketProjects: msg.projects, ticketSources: msg.sources, ...(msg.doneStatuses ? { doneStatuses: msg.doneStatuses } : {}) });
      return;
    case 'recipes':
      set({ recipes: { ...msg.recipes, ...Object.fromEntries(Object.entries(msg.workspaceRecipes ?? {}).map(([id, r]) => [wsRecipeKey(id), r])) } });
      return;
    case 'runs':
      set({ runs: Object.fromEntries(msg.runs.map((r) => [runKey(r.cardId, r.service), r])) });
      return;
    case 'run.log':
      set({ logs: { ...get().logs, [msg.key]: msg.lines } });
      return;
    case 'run.lines': {
      // Only lines newer than the last one held: the log and a flush can cross on the wire.
      const have = get().logs[msg.key] ?? [];
      const last = have.length ? have[have.length - 1].n : 0;
      const add = msg.lines.filter((l) => l.n > last);
      if (!add.length) return;
      set({ logs: { ...get().logs, [msg.key]: [...have, ...add].slice(-LOG_KEEP) } });
      return;
    }
    case 'card.started':
    case 'ship.plan':
    case 'card.changes':
    case 'card.worktrees':
    case 'card.worktreesRemoved':
    case 'tickets.transitions':
    case 'stack.plan':
    case 'stack.detected':
    case 'verify.checked':
    case 'verify.set':
    case 'verify.found':
    case 'builder.scenarios':
    case 'builder.started':
    case 'builder.run':
    case 'verify.updated':
      return; // answered to the screen that asked, which waits on it
    case 'verify.config':
      set({ verify: msg.verify });
      return;
    case 'verify.lists':
      set({ verifyLists: msg.lists });
      return;
    case 'builder.proc':
      set({ builderProc: msg.proc });
      return;
    case 'workspace.file':
      pendingWorkspaceFiles.get(msg.reqId)?.(msg.file);
      pendingWorkspaceFiles.delete(msg.reqId);
      return;
    case 'info':
      flash(msg.message);
      return;
    case 'ok':
    case 'fs.list':
    case 'fs.files':
    case 'fs.picked':
    case 'prompt.written':
    case 'library.peeked':
      return; // answers to requests nobody is waiting for any more
    case 'pack':
      pendingExports.get(msg.reqId)?.(msg.pack);
      pendingExports.delete(msg.reqId);
      return;
    case 'error':
      if (msg.reqId && pendingCreates.has(msg.reqId)) {
        pendingCreates.get(msg.reqId)!.reject(new Error(msg.message));
        pendingCreates.delete(msg.reqId);
      }
      set({ lastError: msg.message });
      return;
  }
}
