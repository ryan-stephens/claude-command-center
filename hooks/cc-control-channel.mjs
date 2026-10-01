#!/usr/bin/env node
// cc-control's channel into a card's terminal session. cc-control starts a card's `claude` with
// `--mcp-config` naming this script and `--dangerously-load-development-channels server:cc-control`
// (channels are a research preview). Claude Code runs it over stdio as an MCP server; it offers no
// tools, only the channel capabilities: a message pushed in here reaches Claude as if typed at
// the terminal, and the terminal's permission prompts are relayed here to be answered.
//
// It talks to the local cc-control server over a WebSocket (loopback only), proving which card it
// belongs to with the card's token from the environment, the way the hook does. Without those
// variables, or with the server down, it still answers Claude Code's MCP handshake so the session
// starts as usual; it just can't be reached from the page until the server is back.

import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const card = process.env.CC_CONTROL_CARD;
const token = process.env.CC_CONTROL_TOKEN;
const base = process.env.CC_CONTROL_URL;
const sessionId = process.env.CLAUDE_CODE_SESSION_ID || '';
const reachable = Boolean(card && token && base && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(base));

// CC_CONTROL_DEBUG=1 (set where the server starts) writes every message both ways to %TEMP%\cc-control-channel.log.
const debug = process.env.CC_CONTROL_DEBUG === '1'
  ? (what, data) => { try { appendFileSync(join(tmpdir(), 'cc-control-channel.log'), `${new Date().toISOString()} ${card ?? '-'} ${what} ${JSON.stringify(data)}\n`); } catch { /* nothing */ } }
  : () => {};
const out = (msg) => { debug('out', msg); process.stdout.write(`${JSON.stringify(msg)}\n`); };
const notify = (method, params) => out({ jsonrpc: '2.0', method, params });

// ---- Claude Code, over stdio -----------------------------------------------------------------
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try { fromClaude(JSON.parse(line)); } catch { /* not JSON: ignore */ }
  }
});
process.stdin.on('end', () => process.exit(0));

function fromClaude(msg) {
  debug('in', msg);
  if (msg.method === 'initialize') {
    out({
      jsonrpc: '2.0', id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { experimental: { 'claude/channel': {}, 'claude/channel/permission': {} } },
        serverInfo: { name: 'cc-control', version: '1.0.0' },
        instructions: 'Messages tagged <channel source="cc-control"> are typed by the person at this terminal, from the cc-control web app that shows this session. Treat them exactly like their own messages here and reply in the session as usual.',
      },
    });
    return;
  }
  if (msg.method === 'notifications/claude/channel/permission_request') { toServer({ type: 'permission_request', ...msg.params }); return; }
  if (msg.method === 'ping' && msg.id !== undefined) { out({ jsonrpc: '2.0', id: msg.id, result: {} }); return; }
  if (msg.id !== undefined && msg.method) {
    const empty = { 'tools/list': { tools: [] }, 'resources/list': { resources: [] }, 'prompts/list': { prompts: [] } }[msg.method];
    out(empty ? { jsonrpc: '2.0', id: msg.id, result: empty } : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
}

// ---- cc-control, over a WebSocket ------------------------------------------------------------
let ws = null;
let backoff = 1000;

function toServer(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  if (!reachable) return;
  const sock = new WebSocket(`${base.replace(/^http/, 'ws')}/channel`);
  sock.onopen = () => {
    ws = sock;
    backoff = 1000;
    sock.send(JSON.stringify({ type: 'hello', card, token, sessionId }));
  };
  sock.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    debug('from-server', msg);
    if (msg.type === 'send' && typeof msg.text === 'string' && msg.text.trim()) {
      notify('notifications/claude/channel', { content: msg.text, meta: { from: 'cc-control' } });
    } else if (msg.type === 'permission' && typeof msg.request_id === 'string' && (msg.behavior === 'allow' || msg.behavior === 'deny')) {
      notify('notifications/claude/channel/permission', { request_id: msg.request_id, behavior: msg.behavior });
    }
  };
  const again = () => {
    if (ws === sock) ws = null;
    // The server restarts now and then; keep trying, a little less often each time, up to 15 s.
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 15_000);
  };
  sock.onclose = again;
  sock.onerror = () => { /* onclose follows */ };
}

connect();
