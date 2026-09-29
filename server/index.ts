import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type MiddlewareHandler } from 'hono';
import type { IncomingMessage } from 'node:http';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL, type ClientMsg, type ImageAttachment, type RepoInfo, type ServerMsg, type Settings, type Workspace } from '../shared/protocol.ts';
import { addPath, removePath, samePath, suggestSources, WORKSPACE_COLORS } from '../shared/workspaces.ts';
import { CommandService } from './commands.ts';
import { PermissionBroker } from './permission-broker.ts';
import { COOKIE, cookieToken, findRemoteIp, remoteHostAllowed, remoteToken, remoteUpgradeAllowed, tokenMatches } from './remote.ts';
import { searchFiles } from './file-search.ts';
import { listFolder, listRoots, normalizeFolder, notAFullPath } from './fs-browse.ts';
import { cleanSources, scanSources } from './repo-library.ts';
import { workspaceFromFile, workspaceToFile } from './workspace-file.ts';
import { SessionManager } from './session-manager.ts';
import { Store } from './store.ts';

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
}, broker, store);

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
  return { id, name, color, repos, home };
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
      return;
    case 'workspace.export': {
      const w = store.loadWorkspaces().find((x) => x.id === msg.id);
      if (!w) throw new Error('That workspace no longer exists.');
      send(ws, { type: 'workspace.file', reqId: msg.reqId, file: workspaceToFile(w, store.loadWorkspacePack(w.id)) });
      return;
    }
    case 'workspace.import': {
      const r = workspaceFromFile(msg.file, (library(true) as Extract<ServerMsg, { type: 'library' }>).repos);
      const w = cleanWorkspace({ ...r.workspace, id: crypto.randomUUID() });
      store.saveWorkspace(w);
      if (r.workflows.groups.length) store.saveWorkspacePack(w.id, r.workflows);
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
const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const allowedOrigins = new Set([
  `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`,
  `http://127.0.0.1:${DEV_PORT}`, `http://localhost:${DEV_PORT}`,
]);
function isTrusted(req: IncomingMessage): boolean {
  return allowedHosts.has(req.headers.host ?? '') && allowedOrigins.has(req.headers.origin ?? '');
}

/** The web app behind a guard: host checks locally, host + token remotely. */
function buildApp(guard: MiddlewareHandler): Hono {
  const app = new Hono();
  app.use('*', guard);
  if (existsSync(WEB_DIST)) {
    app.use('*', serveStatic({ root: WEB_DIST }));
    app.get('*', serveStatic({ root: WEB_DIST, path: 'index.html' }));
  } else {
    app.get('/', (c) => c.text('Web app not built. Run `pnpm build`, or use `pnpm dev` and open http://localhost:5173.'));
  }
  return app;
}

const localApp = buildApp(async (c, next) => {
  if (!allowedHosts.has(c.req.header('host') ?? '')) return c.text('Forbidden host', 403);
  await next();
});

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
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
  for (const request of broker.list()) send(ws, { type: 'permission.request', request });
  for (const [id, activity] of manager.activities()) send(ws, { type: 'session.activity', id, activity });
  for (const [id, todos] of manager.allTodos()) send(ws, { type: 'session.todos', id, todos });
});

manager.setWorkspaces(store.loadWorkspaces());
await manager.history.start();

function listen(hostname: string, app: Hono, trusted: (req: IncomingMessage) => boolean, onReady: () => void) {
  const server = serve({ fetch: app.fetch, hostname, port: PORT }, onReady);
  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.error(`cc-control: ${hostname}:${PORT} is already in use (another cc-control running?). Set CC_CONTROL_PORT to use another.`);
    process.exit(1);
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws' || !trusted(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  return server;
}

const servers = [listen(HOST, localApp, isTrusted, () => console.log(`cc-control: http://localhost:${PORT}`))];

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
  manager.history.stop();
  for (const server of servers) server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
