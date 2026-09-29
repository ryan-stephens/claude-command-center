// Phase 0 spike: prove the risky Agent SDK behaviours cc-control depends on.
// Run: pnpm spike   (plain ESM, no build step)
// Uses a fresh temp dir as cwd and Haiku, so it never touches real sessions.

import { query, listSessions, getSessionMessages, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODEL = 'claude-haiku-4-5-20251001';
// session_state_changed is only emitted when this env var is set (found in the bundled CLI, not in sdk.d.ts).
const SDK_ENV = { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' };
const STEP_TIMEOUT_MS = 120_000;
const tempDir = mkdtempSync(join(tmpdir(), 'cc-control-spike-'));
const results = [];

function record(n, name, pass, detail) {
  results.push({ n, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}. ${name}: ${detail}`);
}

function withTimeout(promise, label, ms = STEP_TIMEOUT_MS) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout: ${label}`)), ms); }),
  ]);
}

function maskEmail(email) {
  if (!email) return '(none)';
  const [user, domain] = email.split('@');
  return `${user[0]}***@${domain}`;
}

// Async input queue: the SDK prompt stays open while this iterable is pending,
// which is what keeps a live session across turns.
function createInputQueue() {
  const buffer = [];
  let wake = null;
  let closed = false;
  return {
    push(text, sessionId = '') {
      buffer.push({
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null,
        session_id: sessionId,
      });
      wake?.();
    },
    close() { closed = true; wake?.(); },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (buffer.length) yield buffer.shift();
        if (closed) return;
        await new Promise((r) => { wake = r; });
        wake = null;
      }
    },
  };
}

// Pumps a Query in the background and lets callers await the next message matching a predicate.
function createPump(q, onMessage = () => {}) {
  const log = [];
  const waiters = [];
  let done = false;
  let error = null;
  (async () => {
    try {
      for await (const msg of q) {
        log.push(msg);
        onMessage(msg);
        for (const w of [...waiters]) {
          if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
        }
      }
    } catch (e) { error = e; }
    done = true;
    for (const w of waiters) w.reject(error ?? new Error('query ended'));
  })();
  return {
    log,
    next(pred, label) {
      if (done) return Promise.reject(error ?? new Error('query ended'));
      return withTimeout(new Promise((resolve, reject) => waiters.push({ pred, resolve, reject })), label);
    },
  };
}

const isResult = (m) => m.type === 'result';

function assistantText(messages) {
  return messages
    .filter((m) => m.type === 'assistant')
    .flatMap((m) => m.message.content)
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

async function step(n, name, fn) {
  try { await fn(); } catch (e) { record(n, name, false, `threw: ${e.message}`); }
}

// ---------------------------------------------------------------------------
console.log(`cwd for spike sessions: ${tempDir}`);
console.log(`ANTHROPIC_API_KEY set: ${Boolean(process.env.ANTHROPIC_API_KEY)}\n`);

// Approval policy for the live session: which decision the next canUseTool call gets.
let approvalPolicy = 'allow';
const approvalCalls = [];
const states = [];
let pump;

const input = createInputQueue();
const q = query({
  prompt: input,
  options: {
    cwd: tempDir,
    model: MODEL,
    settingSources: [],
    permissionMode: 'default',
    includePartialMessages: true,
    env: SDK_ENV,
    async canUseTool(toolName, toolInput, { suggestions }) {
      const stateAtCall = states.at(-1);
      approvalCalls.push({ toolName, toolInput, policy: approvalPolicy, stateAtCall, suggestions });
      if (approvalPolicy === 'allow') return { behavior: 'allow', updatedInput: toolInput };
      return { behavior: 'deny', message: 'Denied by the cc-control spike. Do not retry.' };
    },
  },
});
pump = createPump(q, (m) => {
  if (m.type === 'system' && m.subtype === 'session_state_changed') states.push(m.state);
});

async function turn(text) {
  const start = pump.log.length;
  input.push(text);
  await pump.next(isResult, `result for "${text.slice(0, 30)}"`);
  return pump.log.slice(start);
}

let sessionId = null;

await step(1, 'Auth via existing login', async () => {
  const info = await withTimeout(q.accountInfo(), 'accountInfo');
  const pass = !process.env.ANTHROPIC_API_KEY && (info.apiProvider ?? 'firstParty') === 'firstParty';
  record(1, 'Auth via existing login', pass,
    `provider=${info.apiProvider ?? '?'} tokenSource=${info.tokenSource ?? '-'} apiKeySource=${info.apiKeySource ?? '-'} ` +
    `plan=${info.subscriptionType ?? '-'} email=${maskEmail(info.email)}`);
});

await step(2, 'Multi-turn via input queue', async () => {
  const t1 = await turn('Remember this codeword: PERIWINKLE-42. Reply with just OK.');
  const r1 = t1.find(isResult);
  const t2 = await turn('What was the codeword? Reply with just the codeword.');
  const r2 = t2.find(isResult);
  sessionId = r1.session_id;
  const text = assistantText(t2);
  const pass = r1.session_id === r2.session_id && text.includes('PERIWINKLE-42');
  record(2, 'Multi-turn via input queue', pass, `session=${r1.session_id.slice(0, 8)} same=${r1.session_id === r2.session_id} reply="${text.trim()}"`);
});

await step(3, 'Approvals allow/deny via canUseTool', async () => {
  approvalPolicy = 'allow';
  const before = approvalCalls.length;
  await turn('Use the Bash tool to run exactly this command and nothing else: echo hello > allowed.txt');
  const allowCalls = approvalCalls.length - before;
  approvalPolicy = 'deny';
  const mid = approvalCalls.length;
  await turn('Use the Bash tool to run exactly this command and nothing else: echo hello > denied.txt');
  const denyCalls = approvalCalls.length - mid;
  approvalPolicy = 'allow';
  const allowed = existsSync(join(tempDir, 'allowed.txt'));
  const denied = existsSync(join(tempDir, 'denied.txt'));
  const tools = approvalCalls.map((c) => c.toolName).join(',');
  const hasSuggestions = approvalCalls.some((c) => c.suggestions?.length);
  record(3, 'Approvals allow/deny via canUseTool', allowCalls > 0 && denyCalls > 0 && allowed && !denied,
    `canUseTool calls allow=${allowCalls} deny=${denyCalls} tools=[${tools}] allowed.txt=${allowed} denied.txt=${denied} suggestions=${hasSuggestions}`);
});

await step(4, 'session_state_changed events', async () => {
  const seen = [...new Set(states)];
  const duringApproval = [...new Set(approvalCalls.map((c) => c.stateAtCall))];
  const pass = seen.includes('running') && seen.includes('idle');
  record(4, 'session_state_changed events', pass,
    `seen=[${seen.join(',')}] stateWhenCanUseToolFired=[${duringApproval.join(',')}] sequence=${states.slice(0, 12).join('>')}${states.length > 12 ? '…' : ''}`);
});

await step(5, 'Interrupt mid-turn then continue', async () => {
  input.push('Write the numbers from 1 to 400 spelled out in English words, one per line. No preamble.');
  await pump.next((m) => m.type === 'stream_event' || m.type === 'assistant', 'first assistant chunk');
  const t0 = Date.now();
  const interruptResp = await q.interrupt();
  const res = await pump.next(isResult, 'result after interrupt');
  const stopMs = Date.now() - t0;
  const t = await turn('Reply with just the word PONG.');
  const text = assistantText(t);
  record(5, 'Interrupt mid-turn then continue', text.includes('PONG'),
    `interrupt()→${JSON.stringify(interruptResp) ?? 'undefined'} result.subtype=${res.subtype} stoppedIn=${stopMs}ms followUp="${text.trim()}"`);
});

await step(6, 'Introspection (commands, context usage)', async () => {
  const cmds = await withTimeout(q.supportedCommands(), 'supportedCommands');
  const ctx = await withTimeout(q.getContextUsage({ detail: 'summary' }), 'getContextUsage');
  // Second probe with default settingSources to see user skills/commands.
  const probeInput = createInputQueue();
  const probe = query({ prompt: probeInput, options: { cwd: tempDir, model: MODEL } });
  const userCmds = await withTimeout(probe.supportedCommands(), 'supportedCommands (default settings)');
  probe.close();
  probeInput.close();
  const custom = userCmds.filter((c) => !c.builtin).map((c) => c.name);
  record(6, 'Introspection (commands, context usage)', cmds.length > 0 && typeof ctx.percentage === 'number',
    `commands(settingSources=[])=${cmds.length} commands(default)=${userCmds.length} nonBuiltin=${custom.length} [${custom.slice(0, 8).join(', ')}…] ` +
    `context=${ctx.totalTokens}/${ctx.maxTokens} (${ctx.percentage.toFixed(1)}%)`);
});

input.close();
q.close();

await step(7, 'History (listSessions/getSessionMessages)', async () => {
  const sessions = await listSessions({ dir: tempDir });
  const found = sessions.find((s) => s.sessionId === sessionId);
  const msgs = await getSessionMessages(sessionId, { dir: tempDir });
  const info = await getSessionInfo(sessionId, { dir: tempDir });
  const users = msgs.filter((m) => m.type === 'user').length;
  const assistants = msgs.filter((m) => m.type === 'assistant').length;
  record(7, 'History (listSessions/getSessionMessages)', Boolean(found) && users >= 2 && assistants >= 2,
    `listSessions=${sessions.length} found=${Boolean(found)} summary="${found?.summary?.slice(0, 40)}" messages=${msgs.length} (user=${users} assistant=${assistants}) ` +
    `infoKeys=[${Object.keys(info ?? {}).join(',')}]`);
});

await step(8, 'Resume a terminal-created session', async () => {
  const out = await withTimeout(new Promise((resolve, reject) => {
    const child = spawn('claude -p "Remember this codeword: TANGERINE-7. Reply with just OK." --output-format json --model haiku',
      { cwd: tempDir, shell: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`claude exited ${code}: ${stderr.slice(0, 200)}`))));
  }), 'claude -p');
  const cliSession = JSON.parse(out).session_id;
  const rq = query({
    prompt: 'What was the codeword? Reply with just the codeword.',
    options: { cwd: tempDir, model: MODEL, settingSources: [], resume: cliSession },
  });
  const msgs = [];
  for await (const m of rq) msgs.push(m);
  const text = assistantText(msgs);
  const resumedId = msgs.find(isResult)?.session_id;
  record(8, 'Resume a terminal-created session', text.includes('TANGERINE-7'),
    `cliSession=${cliSession.slice(0, 8)} resumedResultSession=${resumedId?.slice(0, 8)} sameId=${resumedId === cliSession} reply="${text.trim()}"`);
});

// ---------------------------------------------------------------------------
console.log('\n| # | Check | Result |\n|---|---|---|');
for (const r of results) console.log(`| ${r.n} | ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} |`);
console.log('| 9 | Voice (manual) | run `pnpm spike:voice` |');
console.log(`\nTemp dir left for inspection: ${tempDir}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
