#!/usr/bin/env node
// Command Center v2's Claude Code hook. The session's .claude/settings.local.json runs it as
//   node hook.mjs <Event> <session id> <token> <http://127.0.0.1:port>
// and it passes the hook's input to the local v2 server, which keeps what Claude is doing for the
// Switchboard and the HUD. It only reports: it prints nothing, and when the server is down or slow
// it gives up at once, so Claude Code carries on as if it weren't there.

const [event, session, token, base] = process.argv.slice(2);
if (!event || !session || !token || !base || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(base)) process.exit(0);

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const c of process.stdin) {
    size += c.length;
    if (size > 1_000_000) break;
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

try {
  const input = await readStdin();
  await fetch(`${base}/hooks/${encodeURIComponent(event)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ccv2-session': session, 'x-ccv2-token': token },
    body: input || '{}',
    signal: AbortSignal.timeout(3000),
  });
} catch {
  // Server down, slow or gone: say nothing.
}
process.exit(0);
