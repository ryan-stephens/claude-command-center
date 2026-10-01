import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { WebSocketServer } from 'ws';
import { ChannelService, type ChannelSocket, type PermissionRequest } from './channel.ts';
import { channelArgs, tabCommand } from './cards.ts';

/** A socket as the service sees it, driven from the test. */
function fake(): ChannelSocket & { sent: string[]; closed: boolean; emit(event: 'message' | 'close', data?: string): void } {
  const handlers: Record<string, ((d?: unknown) => void)[]> = { message: [], close: [] };
  return {
    readyState: 1, sent: [], closed: false,
    send(d: string) { this.sent.push(d); },
    close() { this.closed = true; this.readyState = 3; },
    on(event: 'message' | 'close', fn: (d?: unknown) => void) { handlers[event].push(fn); return this; },
    emit(event, data) { for (const fn of handlers[event]) fn(data); },
  };
}

test('a channel proves itself with the card’s token, then carries messages in and permission prompts out', () => {
  const states: [string, boolean][] = [];
  const asks: [string, PermissionRequest][] = [];
  const svc = new ChannelService({ tokenOk: (id, t) => id === 'c1' && t === 'tok', state: (id, on) => states.push([id, on]), ask: (id, r) => asks.push([id, r]) });
  const bad = fake();
  svc.accept(bad);
  bad.emit('message', JSON.stringify({ type: 'hello', card: 'c1', token: 'wrong' }));
  assert.ok(bad.closed, 'a wrong token is dropped');
  assert.throws(() => svc.send('c1', 'hi'), /can’t be reached/);

  const early = fake();
  svc.accept(early);
  early.emit('message', JSON.stringify({ type: 'permission_request', request_id: 'x', tool_name: 'Bash' }));
  assert.deepEqual(asks, [], 'nothing is believed before the hello');
  assert.ok(early.closed, 'and a socket that starts with anything else is dropped');

  const s = fake();
  svc.accept(s);
  s.emit('message', JSON.stringify({ type: 'hello', card: 'c1', token: 'tok', sessionId: 'sess' }));
  assert.deepEqual(states, [['c1', true]]);
  assert.ok(svc.has('c1'));
  svc.send('c1', 'run the tests');
  svc.answer('c1', 'abc', 'allow');
  assert.deepEqual(s.sent.map((x) => JSON.parse(x)), [{ type: 'send', text: 'run the tests' }, { type: 'permission', request_id: 'abc', behavior: 'allow' }]);
  s.emit('message', JSON.stringify({ type: 'permission_request', request_id: 'p1', tool_name: 'Bash', description: 'Run the tests', input_preview: '{ "command": "pnpm test" }', extra: 'ignored' }));
  assert.deepEqual(asks, [['c1', { request_id: 'p1', tool_name: 'Bash', description: 'Run the tests', input_preview: '{ "command": "pnpm test" }' }]]);

  const newer = fake();
  svc.accept(newer);
  newer.emit('message', JSON.stringify({ type: 'hello', card: 'c1', token: 'tok' }));
  assert.ok(s.closed, 'a newer channel for the same card replaces the older');
  s.emit('close');
  assert.ok(svc.has('c1'), 'the old one closing does not drop the new one');
  newer.emit('close');
  assert.equal(svc.has('c1'), false);
  assert.deepEqual(states.at(-1), ['c1', false]);
});

test('the card’s claude gets the channel as an MCP server, unless turned off', () => {
  const args = channelArgs(true);
  assert.equal(args[0], '--mcp-config');
  assert.match(args[1], /claude-channel\.json$/, 'a file, not inline JSON (Windows Terminal re-quotes the command line)');
  assert.match(JSON.parse(readFileSync(args[1], 'utf8')).mcpServers['cc-control'].args[0], /hooks\/cc-control-channel\.mjs$/);
  assert.deepEqual(args.slice(2), ['--dangerously-load-development-channels', 'server:cc-control']);
  assert.deepEqual(channelArgs(false), []);
  // With a channel, the tab runs the launcher with everything base64-encoded; without, claude itself.
  const cmd = tabCommand('C:\\bin\\claude.exe', ['--permission-mode', 'default'], 'Fix the "size" guide; carefully', true);
  assert.deepEqual(cmd.slice(0, 6), ['powershell.exe', '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File']);
  assert.match(cmd[6], /cc-control-launch\.ps1$/);
  assert.deepEqual(JSON.parse(Buffer.from(cmd[7], 'base64').toString('utf8')), ['C:\\bin\\claude.exe', '--permission-mode', 'default', '--', 'Fix the "size" guide; carefully']);
  assert.deepEqual(tabCommand('claude', ['--permission-mode', 'default'], 'Fix the "size" guide; carefully', false), ['claude', '--permission-mode', 'default', '--', 'Fix the \\"size\\" guide\\; carefully']);
});

const script = fileURLToPath(new URL('../hooks/cc-control-channel.mjs', import.meta.url));
const procs: ReturnType<typeof spawn>[] = [];
after(() => { for (const p of procs) { p.stdin?.end(); p.kill(); } });

/** Start the channel script as Claude Code would, with the given environment; returns what it writes, line by line. */
function startChannel(env: Record<string, string>): { proc: ReturnType<typeof spawn>; lines: string[]; write(msg: object): void } {
  const proc = spawn(process.execPath, [script], { env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  procs.push(proc);
  const lines: string[] = [];
  let buf = '';
  proc.stdout!.on('data', (d: Buffer) => { buf += d.toString('utf8'); const parts = buf.split('\n'); buf = parts.pop()!; lines.push(...parts.filter(Boolean)); });
  return { proc, lines, write: (msg) => proc.stdin!.write(`${JSON.stringify(msg)}\n`) };
}

const until = async (ok: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 30)); }
};

test('the channel script answers the MCP handshake even with no server, and otherwise relays both ways', async () => {
  // Without the card's variables: it must still let Claude Code start.
  const alone = startChannel({});
  alone.write({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  await until(() => alone.lines.length >= 1);
  const init = JSON.parse(alone.lines[0]) as { result: { capabilities: { experimental: Record<string, unknown> } } };
  assert.deepEqual(Object.keys(init.result.capabilities.experimental), ['claude/channel', 'claude/channel/permission']);
  alone.write({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  await until(() => alone.lines.length >= 2);
  assert.deepEqual(JSON.parse(alone.lines[1]).result, { tools: [] });

  // With a server: hello with the token, a send comes out as a channel notification, a permission request goes in.
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  const port = (wss.address() as { port: number }).port;
  const got: Record<string, unknown>[] = [];
  const sockets: import('ws').WebSocket[] = [];
  wss.on('connection', (ws) => { sockets.push(ws); ws.on('message', (d) => got.push(JSON.parse(String(d)) as Record<string, unknown>)); });
  try {
    const ch = startChannel({ CC_CONTROL_CARD: 'card-1', CC_CONTROL_TOKEN: 'tok', CC_CONTROL_URL: `http://127.0.0.1:${port}`, CLAUDE_CODE_SESSION_ID: 'sess-1' });
    await until(() => got.length >= 1);
    assert.deepEqual(got[0], { type: 'hello', card: 'card-1', token: 'tok', sessionId: 'sess-1' });
    sockets[0].send(JSON.stringify({ type: 'send', text: 'run the tests' }));
    sockets[0].send(JSON.stringify({ type: 'permission', request_id: 'p1', behavior: 'deny' }));
    await until(() => ch.lines.length >= 2);
    assert.deepEqual(ch.lines.map((l) => JSON.parse(l)), [
      { jsonrpc: '2.0', method: 'notifications/claude/channel', params: { content: 'run the tests', meta: { from: 'cc-control' } } },
      { jsonrpc: '2.0', method: 'notifications/claude/channel/permission', params: { request_id: 'p1', behavior: 'deny' } },
    ]);
    ch.write({ jsonrpc: '2.0', method: 'notifications/claude/channel/permission_request', params: { request_id: 'q', tool_name: 'Bash', description: 'Run the tests' } });
    await until(() => got.length >= 2);
    assert.deepEqual(got[1], { type: 'permission_request', request_id: 'q', tool_name: 'Bash', description: 'Run the tests' });
  } finally {
    for (const c of wss.clients) c.terminate();
    wss.close();
  }
});
