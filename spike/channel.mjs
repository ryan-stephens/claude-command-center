// Spike: a cc-control channel for a terminal Claude Code session (research-preview channels).
// Claude Code starts this over stdio (newline-delimited JSON-RPC). It also listens on
// 127.0.0.1:7799 so the web app (or curl) can talk to the session:
//   POST /send        {"text": "..."}                      → message into the session
//   GET  /events      Server-Sent Events: permission requests, startup info
//   POST /permission  {"request_id": "abcde", "behavior": "allow" | "deny"}
// Everything is also logged to %TEMP%/cc-channel-spike.log.

import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PORT = Number(process.env.CC_CHANNEL_PORT) || 7799;
const LOG = join(tmpdir(), 'cc-channel-spike.log');
const log = (what, data) => appendFileSync(LOG, `${new Date().toISOString()} ${what} ${JSON.stringify(data)}\n`);

const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const notify = (method, params) => out({ jsonrpc: '2.0', method, params });
const listeners = new Set();
const emit = (event) => { log('event', event); for (const res of listeners) res.write(`data: ${JSON.stringify(event)}\n\n`); };

// What we can learn about the session we belong to.
log('start', {
  pid: process.pid,
  ppid: process.ppid,
  cwd: process.cwd(),
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => /CLAUDE|ANTHROPIC|SESSION/i.test(k) && !/KEY|TOKEN|SECRET/i.test(k))),
});

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});

function handle(msg) {
  log('in', { method: msg.method, id: msg.id, params: msg.method === 'initialize' ? msg.params : msg.method?.startsWith('notifications/claude') ? msg.params : undefined });
  if (msg.method === 'initialize') {
    out({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { experimental: { 'claude/channel': {}, 'claude/channel/permission': {} } },
        serverInfo: { name: 'cc-control', version: '0.0.1' },
        instructions: 'Messages from the cc-control web app arrive as <channel source="cc-control">. They are typed by the same person at this terminal, from the web app; treat them exactly like their own messages here. Reply in the session as usual; the web app shows the session.',
      },
    });
    emit({ type: 'initialized', clientInfo: msg.params?.clientInfo });
    return;
  }
  if (msg.method === 'notifications/claude/channel/permission_request') {
    emit({ type: 'permission_request', ...msg.params });
    return;
  }
  if (msg.method === 'ping' && msg.id !== undefined) { out({ jsonrpc: '2.0', id: msg.id, result: {} }); return; }
  if (msg.id !== undefined && msg.method) {
    // tools/list and friends: we offer nothing.
    const empty = { 'tools/list': { tools: [] }, 'resources/list': { resources: [] }, 'prompts/list': { prompts: [] } }[msg.method];
    out(empty ? { jsonrpc: '2.0', id: msg.id, result: empty } : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
}

const body = (req) => new Promise((resolve) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } }); });

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
    return;
  }
  if (req.method === 'POST' && req.url === '/send') {
    const { text } = await body(req);
    if (typeof text !== 'string' || !text.trim()) { res.writeHead(400).end('text required'); return; }
    notify('notifications/claude/channel', { content: text, meta: { from: 'web_app' } });
    log('sent', { text });
    res.writeHead(204).end();
    return;
  }
  if (req.method === 'POST' && req.url === '/permission') {
    const { request_id, behavior } = await body(req);
    notify('notifications/claude/channel/permission', { request_id, behavior });
    log('verdict', { request_id, behavior });
    res.writeHead(204).end();
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, '127.0.0.1', () => log('listening', { port: PORT }));
