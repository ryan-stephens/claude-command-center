import { PROTOCOL, type ClientMsg, type CommandPack, type FolderListing, type ServerMsg, type WorkspaceFile } from '../shared/protocol.ts';
import { onStatusChange } from './attention.ts';
import { flash, get, groupKeyOf, set, setScope } from './store.ts';

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

const OUTDATED = 'The cc-control server is older than this page, so it ignores this. Restart it: stop it and run pnpm start.';

export function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onopen = () => {
    retryMs = 1000;
    // The server re-sends every pending approval on connect; anything we still hold is stale.
    greeted = false;
    set({ connected: true, lastError: null, permissions: {}, partials: {}, activity: {}, outdated: null });
    const { openId } = get();
    if (openId) {
      send({ type: 'session.open', id: openId });
      send({ type: 'board.get', sessionId: openId });
    }
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
      const { selectedId } = get();
      const stillThere = msg.sessions.some((s) => s.id === selectedId);
      const before = new Map(get().sessions.map((s) => [s.id, s.status]));
      set({ sessions: msg.sessions, repos: msg.repos, selectedId: stillThere ? selectedId : (msg.sessions[0]?.id ?? null) });
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
        selectedId: s.selectedId === msg.oldId ? msg.newId : s.selectedId,
      });
      if (get().openId === msg.newId) send({ type: 'board.get', sessionId: msg.newId });
      return;
    }
    case 'session.transcript':
      set({ transcripts: { ...get().transcripts, [msg.id]: msg.items } });
      return;
    case 'session.items': {
      const t = get().transcripts;
      set({ transcripts: { ...t, [msg.id]: [...(t[msg.id] ?? []), ...msg.items] } });
      return;
    }
    case 'session.activity':
      set({ activity: { ...get().activity, [msg.id]: msg.activity } });
      return;
    case 'session.partial':
      set({ partials: { ...get().partials, [msg.id]: msg.text } });
      return;
    case 'permission.request': {
      set({ permissions: { ...get().permissions, [msg.request.reqId]: msg.request } });
      lastPermissionAt = performance.now();
      // The card takes focus in the open session so Y / A / N work straight away, but never out
      // of the message box: letters you're typing must not answer it (Tab gets you there).
      const s = get();
      if (s.screen === 'session' && s.openId === msg.request.sessionId && s.zone !== 'composer') set({ zone: 'board' });
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
        set({ board: { sessionId: msg.sessionId, groups: msg.groups }, ...(keep ? {} : { groupKey: msg.groups[0] ? groupKeyOf(msg.groups[0]) : null }) });
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
    case 'workspaces': {
      const { scope } = get();
      set({ workspaces: msg.workspaces, workspacesLoaded: true });
      // A remembered workspace that is gone falls back to the first one (or everything else).
      if (scope.kind === 'workspace' && !msg.workspaces.some((w) => w.id === scope.id)) {
        setScope(msg.workspaces[0] ? { kind: 'workspace', id: msg.workspaces[0].id } : { kind: 'rest' });
      }
      return;
    }
    case 'library':
      set({ library: { sources: msg.sources, repos: msg.repos, suggested: msg.suggested } });
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
