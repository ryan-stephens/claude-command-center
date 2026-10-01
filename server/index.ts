import './boot.ts'; // first: the settings file and certificates, before anything reads CC_CONTROL_*
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type MiddlewareHandler } from 'hono';
import type { IncomingMessage } from 'node:http';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { KEY_HINTS, PROTOCOL, type ClientMsg, type ImageAttachment, type RepoInfo, type ServerMsg, type Settings, type TranscriptItem, type Workspace } from '../shared/protocol.ts';
import { addPath, removePath, repoName, samePath, suggestSources, WORKSPACE_COLORS } from '../shared/workspaces.ts';
import { TRACKED_EVENTS, type HookInput } from './card-events.ts';
import { cardRepos, folderFor, type Card } from '../shared/cards.ts';
import type { RunRecipe } from '../shared/recipes.ts';
import type { ShipRequest } from '../shared/ship.ts';
import { CardService, cleanDraft, focusTab, userModel, writeHookSettings } from './cards.ts';
import { timingSafeEqual } from 'node:crypto';
import { ChannelService } from './channel.ts';
import { cardRecipeOf, recipeOf, RunService, saveRecipe, saveWorkspaceRecipe, workspaceRecipeOf, type RunPlaces } from './recipes.ts';
import { plainStack, prepareStackRun, restoreLeftovers, runsDir, saveStack, stackOf, stackRecipe, stackRows } from './stack.ts';
import { suggested, unknownStackRepos, validateStack } from '../shared/stack.ts';
import { ShipService } from './ship.ts';
import { findPrIn } from './hosts.ts';
import { CommandService } from './commands.ts';
import { TicketService } from './tickets.ts';
import { PermissionBroker } from './permission-broker.ts';
import { Mirror } from './mirror.ts';
import { COOKIE, cookieToken, findRemoteIp, remoteHostAllowed, remoteToken, remoteUpgradeAllowed, tokenMatches } from './remote.ts';
import { searchFiles } from './file-search.ts';
import { listFolder, listRoots, normalizeFolder, notAFullPath } from './fs-browse.ts';
import { cleanSources, scanSources } from './repo-library.ts';
import { workspaceFromFile, workspaceToFile } from './workspace-file.ts';
import { SessionManager } from './session-manager.ts';
import { DB_PATH, Store } from './store.ts';

// Local-only by design: this is effectively a remote shell. Never bind anything but loopback.
const HOST = '127.0.0.1';
const PORT = Number(process.env.CC_CONTROL_PORT) || 7777;
const DEV_PORT = 5173; // Vite dev server, proxies /ws here
// CC_CONTROL_WEB_DIST: serve another build, so a test server never touches the one a running app serves.
const WEB_DIST = process.env.CC_CONTROL_WEB_DIST || fileURLToPath(new URL('../dist/web', import.meta.url));

const clients = new Set<WebSocket>();
function broadcast(msg: ServerMsg): void {
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
}
function send(ws: WebSocket, msg: ServerMsg): void {
  ws.send(JSON.stringify(msg));
}

const broker = new PermissionBroker(
  (request) => {
    broadcast({ type: 'permission.request', request });
    manager.onPermissionChange(request.sessionId);
  },
  (reqId, sessionId) => {
    broadcast({ type: 'permission.resolved', reqId });
    manager.onPermissionChange(sessionId);
  },
);

const store = new Store();
const commands = new CommandService(store);
const cards = new CardService(store, { port: PORT, model: process.env.CC_CONTROL_MODEL || undefined, userModel, trustWorktrees: () => store.loadSettings().trustWorktrees === true, changed: () => broadcast(cardsMsg()) });

const tickets = new TicketService(store, () => broadcast(ticketsMsg()));

// Cards' terminals, reachable through their channel (hooks/cc-control-channel.mjs).
const channels = new ChannelService({
  tokenOk: (id, token) => { const t = store.cardToken(id); return Boolean(t) && t!.length === token.length && timingSafeEqual(Buffer.from(t!), Buffer.from(token)); },
  state: (id, on) => cards.channelState(id, on),
  ask: (id, req) => cards.channelAsk(id, req.tool_name, req.request_id, req.description),
});

function ticketsMsg(): ServerMsg {
  const ids = store.loadWorkspaces().map((w) => w.id);
  return { type: 'tickets', tickets: tickets.list(ids), projects: tickets.projects(ids), sources: tickets.sources() };
}

const runs = new RunService(() => broadcast({ type: 'runs', runs: runs.list() }), process.env);
const ship = new ShipService(cards, runs);

/** Recipes for every repo the page may show one for: the library's, the workspaces' and the cards'. */
function recipesMsg(): ServerMsg {
  const paths = [
    ...(libraryRepos ?? []).map((r) => r.path),
    ...store.loadWorkspaces().flatMap((w) => w.repos),
    ...cards.list().flatMap((c) => cardRepos(c)),
  ];
  const recipes: Record<string, RunRecipe> = {};
  for (const p of paths) {
    if (Object.keys(recipes).some((k) => samePath(k, p))) continue;
    const r = recipeOf(store, p);
    if (r) recipes[p] = r;
  }
  const workspaceRecipes: Record<string, RunRecipe> = {};
  for (const w of store.loadWorkspaces()) {
    // A stack, when the workspace has one, is what its cards run.
    const st = stackOf(store, w.id);
    const r = st ? stackRecipe(st) : workspaceRecipeOf(store, w.id);
    if (r) workspaceRecipes[w.id] = r;
  }
  return { type: 'recipes', recipes, workspaceRecipes };
}

/** Where a card's run goes: its folder, and every repo it or its workspace has by folder name (its own repo is its folder, its worktree if it has one). */
/** What a card is about, for spotting the APIs it names: its title and its ticket's. */
function cardText(card: Card): string {
  return [card.title, card.ticket?.title, card.ticket?.description].filter(Boolean).join('\n');
}

function runPlaces(card: Card): RunPlaces {
  const home = cardRepos(card)[0];
  const cwd = card.cwd ?? home;
  const repos: Record<string, string> = {};
  const ws = store.loadWorkspaces().find((w) => w.id === card.workspaceId);
  // Each repo by its usual folder name, run from the card's worktree of it when it has one.
  for (const p of [...(ws?.repos ?? []), ...cardRepos(card)]) repos[repoName(p).toLowerCase()] = folderFor(card, p);
  if (home) repos[repoName(home).toLowerCase()] = cwd;
  return { cwd, repos };
}

function cardsMsg(): ServerMsg {
  const mine = userModel();
  return { type: 'cards', cards: cards.list(), nextKey: cards.peekKey(), ...(process.env.CC_CONTROL_MODEL ? { model: process.env.CC_CONTROL_MODEL } : {}), ...(mine ? { userModel: mine } : {}) };
}

const manager: SessionManager = new SessionManager({
  sessionsChanged: () => broadcast(snapshot()),
  upsert: (session) => broadcast({ type: 'session.upsert', session }),
  items: (id, items) => broadcast({ type: 'session.items', id, items }),
  partial: (id, text) => broadcast({ type: 'session.partial', id, text }),
  forked: (oldId, newId) => broadcast({ type: 'session.forked', oldId, newId }),
  commandsChanged: () => broadcast({ type: 'commands.changed' }),
  activity: (id, activity) => broadcast({ type: 'session.activity', id, activity }),
  transcript: (id, items) => broadcast({ type: 'session.transcript', id, items }),
  todos: (id, todos) => broadcast({ type: 'session.todos', id, todos }),
  fileChanged: (id) => mirror.changed(id),
}, broker, store);

// Sessions open in a terminal: whoever is looking at one sees it update live.
const mirror = new Mirror<WebSocket>({
  read: (id) => manager.transcript(id),
  send: (ws, id, items) => send(ws, { type: 'session.transcript', id, items: items as TranscriptItem[] }),
  owned: (id) => manager.owns(id),
});

/** Only known keys with sane shapes reach the database. */
function cleanSettings(raw: unknown): Settings {
  const out: Settings = {};
  const b = (raw as Settings)?.bindings;
  if (b && typeof b === 'object') {
    out.bindings = {};
    for (const [action, combos] of Object.entries(b)) {
      if (/^[a-zA-Z]{1,40}$/.test(action) && Array.isArray(combos)) {
        out.bindings[action] = combos.filter((c) => typeof c === 'string' && c.length <= 40).slice(0, 4);
      }
    }
  }
  const h = (raw as Settings)?.keyHints;
  if (h && KEY_HINTS.includes(h)) out.keyHints = h;
  if ((raw as Settings)?.trustWorktrees === true) out.trustWorktrees = true;
  return out;
}

/** Untrusted workspace from a client: a name, a known colour, absolute repo paths (deduplicated). */
function cleanWorkspace(raw: unknown): Workspace {
  const w = (raw ?? {}) as Partial<Workspace>;
  const name = typeof w.name === 'string' ? w.name.trim().slice(0, 60) : '';
  if (!name) throw new Error('A workspace needs a name.');
  const id = typeof w.id === 'string' && /^[\w-]{1,64}$/.test(w.id) ? w.id : crypto.randomUUID();
  const color = (WORKSPACE_COLORS as readonly string[]).includes(w.color ?? '') ? w.color! : 'blue';
  let repos: string[] = [];
  for (const r of Array.isArray(w.repos) ? w.repos : []) {
    const p = normalizeFolder(r);
    if (p) repos = addPath(repos, p);
  }
  repos = repos.slice(0, 50);
  const home = typeof w.home === 'string' && repos.some((r) => samePath(r, w.home!)) ? w.home : undefined;
  const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, 8000) : '');
  const notes = text(w.notes);
  const testing = text(w.testing);
  return { id, name, color, repos, home, ...(notes ? { notes } : {}), ...(testing ? { testing } : {}) };
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Pasted images from the client: at most 5, known types, base64 up to about 5 MB each. */
function cleanImages(raw: unknown): ImageAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out = raw.filter((i): i is ImageAttachment => Boolean(i) && IMAGE_TYPES.has(i.mediaType) && typeof i.data === 'string'
    && i.data.length <= 7_000_000 && /^[A-Za-z0-9+/=]+$/.test(i.data));
  if (out.length !== raw.length) throw new Error('Images must be PNG, JPEG, GIF or WebP, up to 5 MB each.');
  if (out.length > 5) throw new Error('Up to 5 images per message.');
  return out;
}

/** A folder path from the client, made canonical (quotes, `~`, slashes, `D:`), or an error saying what is wrong. */
function folderArg(raw: unknown): string {
  const p = normalizeFolder(raw);
  if (!p) throw new Error(notAFullPath(typeof raw === 'string' ? raw : ''));
  return p;
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/** New repo paths must be real folders; ones already saved may be offline (an unplugged drive) and stay. */
function checkNewRepos(w: Workspace, before: string[]): void {
  for (const r of w.repos) {
    if (!before.some((b) => samePath(b, r)) && !isDir(r)) throw new Error(`Not a folder: ${r}`);
  }
}

function updateWorkspace(id: string, change: (w: Workspace) => Workspace): void {
  const w = store.loadWorkspaces().find((x) => x.id === id);
  if (!w) throw new Error('That workspace no longer exists.');
  const next = cleanWorkspace(change(w));
  checkNewRepos(next, w.repos);
  store.saveWorkspace(next);
  workspacesChanged();
}

function workspacesChanged(): void {
  const workspaces = store.loadWorkspaces();
  manager.setWorkspaces(workspaces); // sessions can use every repo of their workspaces
  broadcast({ type: 'workspaces', workspaces });
  broadcast(snapshot());
  broadcast({ type: 'commands.changed' }); // workspace workflows follow the workspace's repos
  broadcast(ticketsMsg()); // a deleted workspace maps no tickets any more
  broadcast(recipesMsg());
}

/** The last scan; scanning stats every repo, so it runs on request, not on every connection. */
let libraryRepos: RepoInfo[] | null = null;

function library(rescan = false): ServerMsg {
  const sources = store.librarySources();
  if (rescan || !libraryRepos) libraryRepos = scanSources(sources);
  const suggested = suggestSources(manager.history.repos()).filter((p) => !sources.some((s) => samePath(s, p)));
  return { type: 'library', sources, repos: libraryRepos, suggested };
}

/** Repo commands may only be written into folders cc-control already works with. */
function isKnownCwd(cwd: string): boolean {
  return manager.isKnownCwd(cwd) || store.loadWorkspaces().some((w) => w.repos.some((r) => samePath(r, cwd)));
}

function snapshot(): ServerMsg {
  return { type: 'sessions', sessions: manager.summaries(), repos: manager.history.repos() };
}

async function handle(ws: WebSocket, msg: ClientMsg): Promise<void> {
  for (const ref of 'ref' in msg ? [msg.ref, 'from' in msg ? msg.from : undefined] : []) {
    if (ref?.scope === 'repo' && !isKnownCwd(ref.cwd ?? '')) {
      throw new Error('Repo commands can only be saved in a directory that has sessions.');
    }
  }
  switch (msg.type) {
    case 'session.create': {
      const extra = Array.isArray(msg.extraDirs) ? msg.extraDirs.filter((d) => typeof d === 'string').map(folderArg) : [];
      const id = await manager.create(folderArg(msg.cwd), msg.prompt, extra);
      send(ws, { type: 'session.created', reqId: msg.reqId, id });
      return;
    }
    case 'session.open':
      mirror.watch(ws, msg.id);
      send(ws, { type: 'session.transcript', id: msg.id, items: await manager.transcript(msg.id) });
      return;
    case 'session.send':
      await manager.send(msg.id, String(msg.text ?? ''), cleanImages(msg.images));
      return;
    case 'fs.files': {
      const cwd = manager.cwdOf(msg.sessionId);
      if (!cwd) throw new Error('That session has no folder to search.');
      const hits = await searchFiles(cwd, manager.usableDirs(msg.sessionId), String(msg.query ?? '').slice(0, 200));
      send(ws, { type: 'fs.files', reqId: msg.reqId, hits });
      return;
    }
    case 'session.interrupt':
      await manager.interrupt(msg.id);
      return;
    case 'session.stop':
      manager.stop(msg.id);
      return;
    case 'task.stop':
      await manager.stopTask(msg.id, msg.taskId);
      return;
    case 'session.background':
      if (!(await manager.backgroundTasks(msg.id))) send(ws, { type: 'error', message: 'Nothing is running in the foreground to background.' });
      return;
    case 'session.rename':
      await manager.rename(msg.id, msg.title);
      return;
    case 'permission.respond': {
      const sessionId = broker.sessionOf(msg.reqId);
      broker.respond(msg.reqId, msg.decision, msg.answers);
      // Approving a plan also says how to carry on: asking before changes, or accepting edits.
      if (sessionId && msg.mode && msg.decision !== 'deny') await manager.setMode(sessionId, msg.mode);
      return;
    }
    case 'session.mode':
      await manager.setMode(msg.id, msg.mode);
      return;
    case 'board.get': {
      const slash = manager.slashFor(msg.sessionId);
      send(ws, {
        type: 'board',
        sessionId: msg.sessionId,
        groups: commands.board(manager.cwdOf(msg.sessionId), slash),
        // Internal commands (a leading "_") are not for people.
        slash: slash?.filter((c) => !c.name.startsWith('_')).map((c) => ({
          name: c.name, description: c.description, ...(c.argumentHint ? { argumentHint: c.argumentHint } : {}), ...(c.aliases?.length ? { aliases: c.aliases } : {}),
        })),
        models: manager.modelChoices()?.map((m) => ({ value: m.value, displayName: m.displayName, ...(m.description ? { description: m.description } : {}) })),
      });
      return;
    }
    case 'command.save':
      commands.save(msg.ref, msg.command);
      if (msg.from) commands.delete(msg.from);
      broadcast({ type: 'commands.changed' });
      return;
    case 'command.delete':
      commands.delete(msg.ref);
      broadcast({ type: 'commands.changed' });
      return;
    case 'command.swap':
      commands.swap(msg.ref, msg.otherSlot);
      broadcast({ type: 'commands.changed' });
      return;
    case 'pack.import':
      commands.importPack(msg.pack);
      broadcast({ type: 'commands.changed' });
      return;
    case 'pack.export':
      send(ws, { type: 'pack', reqId: msg.reqId, pack: commands.exportPack() });
      return;
    case 'settings.set':
      store.saveSettings(cleanSettings(msg.settings));
      broadcast({ type: 'settings', settings: store.loadSettings() });
      return;
    case 'workspace.save': {
      const w = cleanWorkspace(msg.workspace);
      const old = store.loadWorkspaces().find((x) => x.id === w.id);
      checkNewRepos(w, old?.repos ?? []);
      const isNew = !old;
      store.saveWorkspace(w);
      if (isNew) commands.seedWorkspace(w, msg.template);
      workspacesChanged();
      return;
    }
    case 'workspace.delete':
      store.deleteWorkspace(msg.id);
      workspacesChanged();
      return;
    case 'workspace.addRepo': {
      const path = folderArg(msg.path);
      updateWorkspace(msg.id, (w) => ({ ...w, repos: addPath(w.repos, path) }));
      return;
    }
    case 'workspace.removeRepo':
      updateWorkspace(msg.id, (w) => ({ ...w, repos: removePath(w.repos, msg.path) }));
      return;
    case 'session.addDir':
      await manager.addDir(msg.id, folderArg(msg.path));
      return;
    case 'session.removeDir':
      await manager.removeDir(msg.id, msg.path);
      return;
    case 'library.setSources': {
      const { sources, problem } = cleanSources(msg.sources, store.librarySources());
      if (problem) throw new Error(problem);
      store.setLibrarySources(sources);
      broadcast(library(true));
      broadcast(recipesMsg());
      if (msg.reqId) send(ws, { type: 'ok', reqId: msg.reqId });
      return;
    }
    case 'fs.list': {
      if (msg.path) {
        send(ws, { type: 'fs.list', reqId: msg.reqId, listing: await listFolder(String(msg.path)) });
        return;
      }
      const lib = library() as Extract<ServerMsg, { type: 'library' }>;
      const places = [
        ...lib.sources.map((p) => ({ path: p, note: 'in your repo library' })),
        ...lib.suggested.map((p) => ({ path: p, note: 'suggested: past sessions ran here' })),
      ];
      send(ws, { type: 'fs.list', reqId: msg.reqId, listing: await listRoots(places) });
      return;
    }
    case 'library.scan':
      send(ws, library(true));
      send(ws, recipesMsg());
      return;
    case 'workspace.export': {
      const w = store.loadWorkspaces().find((x) => x.id === msg.id);
      if (!w) throw new Error('That workspace no longer exists.');
      const st = stackOf(store, w.id);
      send(ws, { type: 'workspace.file', reqId: msg.reqId, file: workspaceToFile(w, store.loadWorkspacePack(w.id), workspaceRecipeOf(store, w.id), st ? plainStack(st) : undefined) });
      return;
    }
    case 'card.start': {
      const workspaces = store.loadWorkspaces();
      const draft = cleanDraft(msg.draft, workspaces);
      const ticket = draft.ticketKey ? tickets.get(draft.ticketKey, workspaces.map((w) => w.id)) : undefined;
      if (draft.ticketKey && !ticket) throw new Error(`${draft.ticketKey} isn’t in the tickets any more. Refresh them and try again.`);
      const card = await cards.start(draft, ticket);
      send(ws, { type: 'card.started', reqId: msg.reqId, id: card.id });
      broadcast(recipesMsg());
      return;
    }
    case 'card.delete':
      void runs.forget(String(msg.id));
      cards.delete(String(msg.id));
      return;
    case 'card.addContext':
      await cards.addContext(String(msg.id), msg.items, msg.note);
      send(ws, { type: 'ok', reqId: msg.reqId });
      broadcast(recipesMsg());
      return;
    case 'card.worktrees':
      send(ws, { type: 'card.worktrees', reqId: msg.reqId, id: String(msg.id), worktrees: await cards.worktrees(String(msg.id)) });
      return;
    case 'card.removeWorktrees': {
      const id = String(msg.id);
      // A run from those folders would be left pointing at nothing: it stops first, with its stop: steps.
      await runs.stop(id, true);
      const r = await cards.removeWorktrees(id, msg.force === true, msg.thenDelete === true);
      if (msg.thenDelete === true && !r.kept.length) cards.delete(id);
      send(ws, { type: 'card.worktreesRemoved', reqId: msg.reqId, id, removed: r.removed, kept: r.kept });
      return;
    }
    case 'card.try': {
      const card = cards.get(String(msg.id));
      if (!card) throw new Error('That card is no longer on the line.');
      const stack = card.workspaceId ? stackOf(store, card.workspaceId) : undefined;
      if (stack) {
        const c = (msg.choice ?? {}) as { values?: unknown; apis?: unknown };
        const values = Object.fromEntries(Object.entries((c.values ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
        const apis = Array.isArray(c.apis) ? c.apis.map(String).slice(0, 30) : [];
        // The last run goes first (its cleanup would otherwise undo the proxy file this one writes).
        await runs.stop(card.id, true);
        const { recipe, opts } = await prepareStackRun(stack, { values, apis }, runPlaces(card), card.id, runsDir(DB_PATH));
        send(ws, { type: 'ok', reqId: msg.reqId });
        await runs.start(card.id, recipe, runPlaces(card), opts);
        return;
      }
      const home = cardRepos(card)[0];
      const recipe = cardRecipeOf(store, card.workspaceId, home);
      if (!recipe) throw new Error(`${card.key} has no run recipe yet. e writes one for ${home ? repoName(home) : 'its repo'}.`);
      const places = runPlaces(card);
      if (!existsSync(places.cwd)) throw new Error(`${places.cwd} isn’t there any more.`);
      send(ws, { type: 'ok', reqId: msg.reqId });
      await runs.start(card.id, recipe, places);
      return;
    }
    case 'card.stopRun':
      await runs.stop(String(msg.id));
      return;
    case 'card.send': {
      const text = String(msg.text ?? '').slice(0, 20_000);
      if (!text.trim()) throw new Error('Nothing to send.');
      channels.send(String(msg.id), text);
      send(ws, { type: 'ok', reqId: msg.reqId });
      return;
    }
    case 'card.focusTab': {
      const card = cards.get(String(msg.id));
      if (!card) throw new Error('That card is gone.');
      focusTab(card.key).then(() => send(ws, { type: 'ok', reqId: msg.reqId }), (e: Error) => send(ws, { type: 'error', reqId: msg.reqId, message: e.message }));
      return;
    }
    case 'card.answer': {
      const behavior = msg.behavior === 'deny' ? 'deny' : 'allow';
      channels.answer(String(msg.id), String(msg.requestId).slice(0, 80), behavior);
      cards.channelAnswered(String(msg.id), String(msg.requestId));
      send(ws, { type: 'ok', reqId: msg.reqId });
      return;
    }
    case 'card.stackPlan': {
      const card = cards.get(String(msg.id));
      if (!card) throw new Error('That card is no longer on the line.');
      const stack = card.workspaceId ? stackOf(store, card.workspaceId) : undefined;
      if (!stack) throw new Error(`${card.key}’s workspace has no stack.`);
      const rows = await stackRows(stack, runPlaces(card), cardText(card));
      send(ws, { type: 'stack.plan', reqId: msg.reqId, rows, suggested: suggested(rows) });
      return;
    }
    case 'stack.save': {
      const id = String(msg.workspaceId);
      const owner = store.loadWorkspaces().find((w) => w.id === id);
      if (!owner) throw new Error('That workspace no longer exists.');
      if (msg.stack) {
        // A stack can only start repos that are here: the workspace's, or the library's (a card can add those).
        const libRepos = (library(true) as Extract<ServerMsg, { type: 'library' }>).repos.map((r) => r.name);
        const wsRepos = owner.repos.map(repoName);
        const unknown = unknownStackRepos(validateStack(msg.stack), [...wsRepos, ...libRepos]);
        if (unknown.length) {
          throw new Error(`${unknown.join(', ')} ${unknown.length === 1 ? 'isn’t a repo' : 'aren’t repos'} in ${owner.name} or the repo library${wsRepos.length ? ` (${owner.name} has ${wsRepos.join(', ')})` : ''}. Use your repos’ folder names${/orders-api|web-ui/.test(unknown.join(' ')) ? ': those are the example’s made-up names' : ''}.`);
        }
      }
      saveStack(store, id, msg.stack ?? null);
      send(ws, { type: 'ok', reqId: msg.reqId });
      broadcast(recipesMsg());
      return;
    }
    case 'card.changes': {
      const card = cards.get(String(msg.id));
      if (!card) throw new Error('That card is no longer on the line.');
      send(ws, { type: 'card.changes', reqId: msg.reqId, changes: await ship.changes(card) });
      return;
    }
    case 'card.shipPlan': {
      const card = cards.get(String(msg.id));
      if (!card) throw new Error('That card is no longer on the line.');
      send(ws, { type: 'ship.plan', reqId: msg.reqId, plan: await ship.plan(card) });
      return;
    }
    case 'card.ship': {
      const r = (msg.request ?? {}) as Partial<ShipRequest>;
      await ship.ship(String(msg.id), {
        commit: String(r.commit ?? '').slice(0, 4000), title: String(r.title ?? '').slice(0, 300), body: String(r.body ?? '').slice(0, 60_000),
        paths: Array.isArray(r.paths) ? r.paths.map(String).slice(0, 2000) : [],
      });
      send(ws, { type: 'ok', reqId: msg.reqId });
      return;
    }
    case 'card.prRefresh':
      await ship.refresh(String(msg.id));
      send(ws, { type: 'ok', reqId: msg.reqId });
      return;
    case 'card.merge':
      await ship.merge(String(msg.id));
      send(ws, { type: 'ok', reqId: msg.reqId });
      return;
    case 'recipe.save': {
      const steps = Array.isArray(msg.steps) ? msg.steps.map(String) : [];
      const url = typeof msg.url === 'string' ? msg.url : undefined;
      if (msg.workspaceId) {
        if (!store.loadWorkspaces().some((w) => w.id === msg.workspaceId)) throw new Error('That workspace no longer exists.');
        saveWorkspaceRecipe(store, String(msg.workspaceId), steps, url);
        send(ws, { type: 'ok', reqId: msg.reqId });
        broadcast(recipesMsg());
        return;
      }
      const repo = normalizeFolder(msg.repo);
      if (!repo || !existsSync(repo)) throw new Error('That repo isn’t there any more.');
      saveRecipe(store, repo, steps, url);
      send(ws, { type: 'ok', reqId: msg.reqId });
      broadcast(recipesMsg());
      return;
    }
    case 'card.withdraw':
      cards.withdraw(String(msg.id), String(msg.itemId));
      return;
    case 'tickets.demo':
      tickets.setDemo(msg.on === true);
      return;
    case 'tickets.map': {
      const project = String(msg.project ?? '').slice(0, 100);
      const ws = typeof msg.workspaceId === 'string' && store.loadWorkspaces().some((w) => w.id === msg.workspaceId) ? msg.workspaceId : null;
      if (project) tickets.setMapping(project, ws);
      return;
    }
    case 'tickets.hide':
      tickets.setHidden(String(msg.key).slice(0, 60), msg.hidden === true);
      return;
    case 'tickets.refresh':
      await tickets.refresh();
      return;
    case 'tickets.comment': {
      const key = String(msg.key ?? '').slice(0, 60);
      const text = String(msg.text ?? '').slice(0, 30_000).trim();
      if (!text) throw new Error('Nothing to post.');
      await tickets.comment(key, text);
      send(ws, { type: 'ok', reqId: msg.reqId });
      return;
    }
    case 'tickets.transitions': {
      const key = String(msg.key ?? '').slice(0, 60);
      send(ws, { type: 'tickets.transitions', reqId: msg.reqId, key, transitions: await tickets.transitions(key) });
      return;
    }
    case 'tickets.transition': {
      await tickets.transition(String(msg.key ?? '').slice(0, 60), String(msg.id ?? '').slice(0, 60));
      send(ws, { type: 'ok', reqId: msg.reqId });
      return;
    }
    case 'tickets.search': {
      const q = String(msg.q ?? '').slice(0, 200);
      const r = await tickets.search(q, store.loadWorkspaces().map((w) => w.id));
      send(ws, { type: 'tickets.found', reqId: msg.reqId, q, tickets: r.tickets, ...(r.problem ? { problem: r.problem } : {}) });
      return;
    }
    case 'card.findPr': {
      const key = String(msg.key ?? '').slice(0, 60);
      if (!/^[\w-]+$/.test(key)) throw new Error('No ticket key to look for.');
      // Only real repo folders: each is asked for its remote with git.
      const repos = (Array.isArray(msg.repos) ? msg.repos : []).slice(0, 10).map((r) => normalizeFolder(r)).filter((r): r is string => Boolean(r) && isDir(r!));
      const r = await findPrIn(repos, key);
      send(ws, { type: 'pr.found', reqId: msg.reqId, ...(r.pr ? { pr: r.pr } : {}), notes: r.notes });
      return;
    }
    case 'card.done':
      cards.finish(String(msg.id));
      return;
    case 'workspace.import': {
      const r = workspaceFromFile(msg.file, (library(true) as Extract<ServerMsg, { type: 'library' }>).repos);
      const w = cleanWorkspace({ ...r.workspace, id: crypto.randomUUID() });
      store.saveWorkspace(w);
      if (r.workflows.groups.length) store.saveWorkspacePack(w.id, r.workflows);
      // Marked as imported: its commands are someone else's, and the drawer says to check them.
      if (r.recipe) saveWorkspaceRecipe(store, w.id, r.recipe.steps, r.recipe.url, true);
      if (r.stack) saveStack(store, w.id, r.stack, true);
      workspacesChanged();
      send(ws, {
        type: 'info',
        message: r.missing.length
          ? `Imported ${w.name}. Not in your repo library: ${r.missing.join(', ')}. Add them with + once you have them.`
          : `Imported ${w.name} with ${w.repos.length} repo${w.repos.length === 1 ? '' : 's'}.`,
      });
      return;
    }
  }
}

// Only pages served from loopback may connect: blocks cross-site WebSocket hijacking and DNS rebinding.
// The Vite dev page (:5173, Vite's default, so also any app Try it starts) is allowed only under pnpm dev.
const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const allowedOrigins = new Set([
  `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`,
  ...(process.env.CC_CONTROL_DEV === '1' ? [`http://127.0.0.1:${DEV_PORT}`, `http://localhost:${DEV_PORT}`] : []),
]);
function isTrusted(req: IncomingMessage): boolean {
  return allowedHosts.has(req.headers.host ?? '') && allowedOrigins.has(req.headers.origin ?? '');
}

/** The web app behind a guard: host checks locally, host + token remotely. `routes` go before the static files. */
function buildApp(guard: MiddlewareHandler, routes?: (app: Hono) => void): Hono {
  const app = new Hono();
  app.use('*', guard);
  routes?.(app);
  if (existsSync(WEB_DIST)) {
    app.use('*', serveStatic({ root: WEB_DIST }));
    app.get('*', serveStatic({ root: WEB_DIST, path: 'index.html' }));
  } else {
    app.get('/', (c) => c.text('Web app not built. Run `pnpm build`, or use `pnpm dev` and open http://localhost:5173.'));
  }
  return app;
}

/**
 * What a card session's hook calls (hooks/cc-control-hook.mjs), on loopback only, never on the
 * remote listener. It must carry the card's token in a header: a custom header can't be sent
 * cross-site without a CORS preflight, which this never answers, so web pages can't forge it.
 */
function hookRoutes(app: Hono): void {
  app.post('/hooks/:event', async (c) => {
    const id = c.req.header('x-cc-control-card') ?? '';
    const token = c.req.header('x-cc-control-token') ?? '';
    if (!id || !token) return c.text('Forbidden', 403);
    let input: unknown;
    try { input = await c.req.json(); } catch { return c.text('Bad request', 400); }
    const event = c.req.param('event');
    try {
      if (event !== 'SessionStart') {
        const out = (TRACKED_EVENTS as readonly string[]).includes(event) ? cards.hookEvent(id, token, event, (input ?? {}) as HookInput) : null;
        return out ? c.json(out) : c.body(null, 204);
      }
      const out = cards.sessionStart(id, token, (input ?? {}) as HookInput);
      return out ? c.json(out) : c.body(null, 204);
    } catch (e) {
      return c.text((e as Error).message, 403);
    }
  });
}

const localApp = buildApp(async (c, next) => {
  if (!allowedHosts.has(c.req.header('host') ?? '')) return c.text('Forbidden host', 403);
  await next();
}, hookRoutes);

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => { clients.delete(ws); mirror.forget(ws); });
  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    handle(ws, msg).catch((e: Error) => {
      send(ws, { type: 'error', message: e.message, reqId: 'reqId' in msg ? msg.reqId : undefined });
    });
  });
  send(ws, { type: 'hello', protocol: PROTOCOL });
  send(ws, snapshot());
  send(ws, { type: 'settings', settings: store.loadSettings() });
  send(ws, { type: 'workspaces', workspaces: store.loadWorkspaces() });
  send(ws, library());
  send(ws, cardsMsg());
  send(ws, ticketsMsg());
  send(ws, recipesMsg());
  send(ws, { type: 'runs', runs: runs.list() });
  for (const request of broker.list()) send(ws, { type: 'permission.request', request });
  for (const [id, activity] of manager.activities()) send(ws, { type: 'session.activity', id, activity });
  for (const [id, todos] of manager.allTodos()) send(ws, { type: 'session.todos', id, todos });
});

manager.setWorkspaces(store.loadWorkspaces());
await manager.history.start();
tickets.start();

function listen(hostname: string, app: Hono, trusted: (req: IncomingMessage) => boolean, onReady: () => void) {
  const server = serve({ fetch: app.fetch, hostname, port: PORT }, onReady);
  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.error(`cc-control: ${hostname}:${PORT} is already in use (another cc-control running?). Set CC_CONTROL_PORT to use another.`);
    process.exit(1);
  });
  server.on('upgrade', (req, socket, head) => {
    // A card's channel: a local process, not a page, so no Origin; it proves itself with the card's token in its hello.
    if (req.url === '/channel' && hostname === HOST && allowedHosts.has(req.headers.host ?? '')) {
      wss.handleUpgrade(req, socket, head, (ws) => channels.accept(ws));
      return;
    }
    if (req.url !== '/ws' || !trusted(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  return server;
}

const servers = [listen(HOST, localApp, isTrusted, () => {
  console.log(`cc-control: http://localhost:${PORT}`);
  // Only once the port is ours: a second server started by mistake must not touch the first one's files.
  writeHookSettings();
  // A proxy file a run changed in place and never put back (the server stopped mid-run) goes back now.
  for (const f of restoreLeftovers(runsDir(DB_PATH))) console.log(`Put back ${f}, which Try it had changed.`);
})];

// Remote (phone) access over Tailscale: opt-in, token-guarded. See server/remote.ts.
if (process.argv.includes('--remote') || process.env.CC_CONTROL_REMOTE === '1') {
  let ip: string;
  try {
    ip = findRemoteIp();
  } catch (e) {
    console.error(`cc-control: ${(e as Error).message}`);
    process.exit(1);
  }
  const token = remoteToken(store, process.argv.includes('--rotate-token'));
  const remoteApp = buildApp(async (c, next) => {
    if (!remoteHostAllowed(c.req.header('host'), ip, PORT)) return c.text('Forbidden host', 403);
    if (c.req.path === '/auth') {
      if (!tokenMatches(c.req.query('token'), token)) return c.text('Invalid token.', 401);
      c.header('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
      return c.redirect('/');
    }
    if (!tokenMatches(cookieToken(c.req.header('cookie')), token)) {
      return c.text('cc-control: open the sign-in link printed in the terminal where cc-control is running.', 401);
    }
    await next();
  });
  servers.push(listen(ip, remoteApp, (req) => remoteUpgradeAllowed(req, ip, PORT, token), () => {
    console.log(`cc-control remote (Tailscale): http://${ip}:${PORT}`);
    console.log(`  Sign in once on your phone: http://${ip}:${PORT}/auth?token=${token}`);
    console.log('  Treat that link like a password. Restart with --rotate-token to revoke it.');
  }));
}

// One failed background call (a history read, a context-usage fetch) must not take down every
// live session with it. Log it and keep serving.
process.on('unhandledRejection', (reason) => {
  console.error('cc-control: unhandled rejection:', reason instanceof Error ? reason.stack : reason);
});

function shutdown(): void {
  manager.stopAll();
  runs.stopAll();
  channels.closeAll();
  ship.stop();
  cards.stop();
  tickets.stop();
  manager.history.stop();
  mirror.stop();
  for (const server of servers) server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
