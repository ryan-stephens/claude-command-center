#!/usr/bin/env node
// Command Center's toolbelt for a session's Claude: an MCP server over stdio, started by Claude Code
// from the session's .mcp.json with CCV2_URL, CCV2_SESSION and CCV2_TOKEN set. Every call goes to
// the v2 server on this machine as that session.

import { createInterface } from 'node:readline';
import { handle, type CallTool } from './protocol.ts';

const base = process.env.CCV2_URL ?? '';
const session = process.env.CCV2_SESSION ?? '';
const token = process.env.CCV2_TOKEN ?? '';

const call: CallTool = async (name, args) => {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(base) || !session || !token) return { error: 'This folder isn’t a Command Center session (its .mcp.json has no session).' };
  try {
    const res = await fetch(`${base}/tool/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ccv2-session': session, 'x-ccv2-token': token },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(15 * 60_000),
    });
    return (await res.json()) as { result?: unknown; error?: string };
  } catch (e) {
    return { error: `Command Center isn’t answering on ${base} (${(e as Error).message}). Is the v2 server running?` };
  }
};

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg: unknown;
  try { msg = JSON.parse(line); } catch { return; }
  void handle(msg as Parameters<typeof handle>[0], call).then((out) => { if (out) process.stdout.write(`${JSON.stringify(out)}\n`); });
});
rl.on('close', () => process.exit(0));
