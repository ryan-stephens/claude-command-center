import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { IncomingMessage } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { CommandService } from './commands.ts';
import { PermissionBroker } from './permission-broker.ts';
import { SessionManager } from './session-manager.ts';
import { Store } from './store.ts';

// Local-only by design: this is effectively a remote shell. Never bind anything but loopback.
const HOST = '127.0.0.1';
const PORT = Number(process.env.CC_CONTROL_PORT) || 7777;
const DEV_PORT = 5173; // Vite dev server, proxies /ws here
const WEB_DIST = fileURLToPath(new URL('../dist/web', import.meta.url));

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

const manager: SessionManager = new SessionManager({
  sessionsChanged: () => broadcast(snapshot()),
  upsert: (session) => broadcast({ type: 'session.upsert', session }),
  items: (id, items) => broadcast({ type: 'session.items', id, items }),
  partial: (id, text) => broadcast({ type: 'session.partial', id, text }),
  forked: (oldId, newId) => broadcast({ type: 'session.forked', oldId, newId }),
  commandsChanged: () => broadcast({ type: 'commands.changed' }),
}, broker);
const commands = new CommandService(new Store());

function snapshot(): ServerMsg {
  return { type: 'sessions', sessions: manager.summaries(), repos: manager.history.repos() };
}

async function handle(ws: WebSocket, msg: ClientMsg): Promise<void> {
  if ('ref' in msg && msg.ref.scope === 'repo' && !manager.isKnownCwd(msg.ref.cwd ?? '')) {
    throw new Error('Repo commands can only be saved in a directory that has sessions.');
  }
  switch (msg.type) {
    case 'session.create': {
      const id = await manager.create(msg.cwd, msg.prompt);
      send(ws, { type: 'session.created', reqId: msg.reqId, id });
      return;
    }
    case 'session.open':
      send(ws, { type: 'session.transcript', id: msg.id, items: await manager.transcript(msg.id) });
      return;
    case 'session.send':
      await manager.send(msg.id, msg.text);
      return;
    case 'session.interrupt':
      await manager.interrupt(msg.id);
      return;
    case 'session.stop':
      manager.stop(msg.id);
      return;
    case 'session.rename':
      await manager.rename(msg.id, msg.title);
      return;
    case 'permission.respond':
      broker.respond(msg.reqId, msg.decision);
      return;
    case 'board.get':
      send(ws, { type: 'board', sessionId: msg.sessionId, groups: commands.board(manager.cwdOf(msg.sessionId), manager.slashCommands(msg.sessionId)) });
      return;
    case 'command.save':
      commands.save(msg.ref, msg.command);
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

const app = new Hono();
app.use('*', async (c, next) => {
  if (!allowedHosts.has(c.req.header('host') ?? '')) return c.text('Forbidden host', 403);
  await next();
});
if (existsSync(WEB_DIST)) {
  app.use('*', serveStatic({ root: WEB_DIST }));
  app.get('*', serveStatic({ root: WEB_DIST, path: 'index.html' }));
} else {
  app.get('/', (c) => c.text('Web app not built. Run `pnpm build`, or use `pnpm dev` and open http://localhost:5173.'));
}

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
  send(ws, snapshot());
  for (const request of broker.list()) send(ws, { type: 'permission.request', request });
});

await manager.history.start();
const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, () => {
  console.log(`cc-control: http://localhost:${PORT}`);
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`cc-control: port ${PORT} is already in use (another cc-control running?). Set CC_CONTROL_PORT to use another.`);
  process.exit(1);
});
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws' || !isTrusted(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function shutdown(): void {
  manager.stopAll();
  manager.history.stop();
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
