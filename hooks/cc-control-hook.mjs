#!/usr/bin/env node
// cc-control's Claude Code hook. cc-control starts a card's session with
// `claude --settings <file that points here>` and sets CC_CONTROL_CARD, CC_CONTROL_TOKEN and
// CC_CONTROL_URL in its environment. This passes the hook's input to the local cc-control server
// and prints what it answers (for SessionStart: the card's context as additionalContext).
//
// It must never get in the way: without those variables, or when the server is down or slow, it
// exits at once with no output, and Claude Code carries on as if it weren't there.

const card = process.env.CC_CONTROL_CARD;
const token = process.env.CC_CONTROL_TOKEN;
const base = process.env.CC_CONTROL_URL;
const event = process.argv[2] || 'SessionStart';

// Only ever talk to this machine: the server binds to loopback, and so does the hook.
if (!card || !token || !base || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(base)) process.exit(0);

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
  const res = await fetch(`${base}/hooks/${encodeURIComponent(event)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cc-control-card': card, 'x-cc-control-token': token },
    body: input || '{}',
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 200) {
    const out = await res.text();
    if (out) process.stdout.write(out);
  }
} catch {
  // Server down, slow or gone: say nothing.
}
process.exit(0);
