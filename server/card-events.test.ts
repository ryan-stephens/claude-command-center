import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Card } from '../shared/cards.ts';
import { applyEvent, describeTool, endingQuestion, type HookInput } from './card-events.ts';

const card = (over: Partial<Card> = {}): Card => ({
  id: 'c1', key: 'CARD-1', title: 'T', workspaceId: null, stage: 'plan', createdAt: 0, boot: [], sessionId: 's1', cwd: 'D:\\r',
  packet: { workspace: [], ticket: [], card: [], note: '' }, launch: { home: 'D:\\r', branch: 'new', mode: 'plan', message: '' },
  ...over,
});

/** Run events in order, as the probe recorded them in a real tab. */
function run(c: Card, events: [string, HookInput][]): Card {
  return events.reduce((acc, [e, i], n) => applyEvent(acc, e, i, 1000 + n), c);
}

test('plan mode: the plan waits on you in Plan, approving it starts the build, a finished turn with changes goes to Try it', () => {
  const plan = '# Plan\n1. Add a comment';
  let c = run(card(), [
    ['UserPromptSubmit', { permission_mode: 'plan', prompt: 'Plan it' }],
    ['PreToolUse', { permission_mode: 'plan', tool_name: 'ExitPlanMode', tool_input: { plan }, tool_use_id: 't1' }],
    ['PermissionRequest', { permission_mode: 'plan', tool_name: 'ExitPlanMode', tool_input: { plan } }],
    ['Notification', { notification_type: 'permission_prompt', message: 'Claude Code needs your approval for the plan' }],
  ]);
  assert.equal(c.stage, 'plan');
  assert.equal(c.live!.phase, 'needs');
  assert.equal(c.live!.ask!.kind, 'plan');
  assert.equal(c.live!.ask!.plan, plan);
  assert.match(c.live!.text, /Plan ready/);
  c = run(c, [
    ['PostToolUse', { permission_mode: 'default', tool_name: 'ExitPlanMode', tool_input: { plan } }],
    ['PreToolUse', { permission_mode: 'default', tool_name: 'Edit', tool_input: { file_path: 'D:\\r\\app.js' } }],
  ]);
  assert.equal(c.stage, 'build');
  assert.equal(c.live!.text, 'editing app.js');
  assert.equal(c.live!.ask, undefined);
  c = run(c, [
    ['PostToolUse', { permission_mode: 'default', tool_name: 'Edit', tool_input: { file_path: 'D:\\r\\app.js' } }],
    ['Stop', { permission_mode: 'default', last_assistant_message: 'Added the comment.\nAnything else?' }],
  ]);
  assert.equal(c.stage, 'try');
  assert.equal(c.live!.phase, 'waiting');
  assert.equal(c.live!.text, 'Done. Ready to try');
  assert.equal(c.live!.lastMessage, 'Added the comment.\nAnything else?');
  assert.deepEqual(c.files, ['D:\\r\\app.js']);
});

test('a tool to allow puts the card in Needs you; once it runs, back to Build', () => {
  let c = run(card({ stage: 'build' }), [
    ['PreToolUse', { permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'git push', description: 'Push the branch' } }],
    ['PermissionRequest', { permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'git push', description: 'Push the branch' } }],
  ]);
  assert.equal(c.stage, 'needs');
  assert.equal(c.live!.text, 'Waiting for you to allow running: Push the branch');
  c = run(c, [['PostToolUse', { permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'git push' } }]]);
  assert.equal(c.stage, 'build');
  assert.equal(c.live!.phase, 'working');
});

test('a denied tool: the turn ends with nothing changed, so the card goes back to Build, not Try it', () => {
  const c = run(card({ stage: 'build' }), [
    ['PermissionRequest', { permission_mode: 'default', tool_name: 'Write', tool_input: { file_path: 'x.txt' } }],
    ['Stop', { permission_mode: 'default', last_assistant_message: 'OK, I will not write it.' }],
  ]);
  assert.equal(c.stage, 'build');
  assert.equal(c.live!.text, 'Replied: OK, I will not write it.');
});

test('a question from Claude says what it asks', () => {
  const c = applyEvent(card({ stage: 'build' }), 'PermissionRequest', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Return 200 or 409?' }] } }, 1);
  assert.equal(c.stage, 'needs');
  assert.equal(c.live!.text, 'Asking: Return 200 or 409?');
});

test('a new message after Try it is round 2', () => {
  const c = applyEvent(card({ stage: 'try', files: ['a'] }), 'UserPromptSubmit', { permission_mode: 'default' }, 1);
  assert.equal(c.stage, 'build');
  assert.equal(c.round, 2);
  const done = run(c, [['PostToolUse', { tool_name: 'Edit', tool_input: { file_path: 'D:\\r\\b.ts' } }], ['Stop', {}]]);
  assert.equal(done.live!.text, 'Round 2 done. Ready to try');
});

test('the to-do list follows TodoWrite and TaskCreate / TaskUpdate; subagents’ lists are not the card’s', () => {
  let c = applyEvent(card(), 'PreToolUse', { tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Read', status: 'completed' }, { content: 'Edit', status: 'in_progress' }] } }, 1);
  assert.deepEqual(c.todos!.map((t) => t.status), ['completed', 'in_progress']);
  c = run(card(), [
    ['PreToolUse', { tool_name: 'TaskCreate', tool_input: { subject: 'Write tests' }, tool_use_id: 'u1' }],
    ['PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject: 'Write tests' }, tool_use_id: 'u1', tool_response: { task: { id: '7' } } }],
    ['PreToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId: '7', status: 'completed' } }],
    ['PreToolUse', { agent_id: 'a1', tool_name: 'TodoWrite', tool_input: { todos: [] } }],
  ]);
  assert.deepEqual(c.todos, [{ id: '7', content: 'Write tests', status: 'completed', activeForm: undefined }]);
});

test('Ship and Done belong to you: hooks update the line but never move the card', () => {
  const c = applyEvent(card({ stage: 'ship' }), 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'x' } }, 1);
  assert.equal(c.stage, 'ship');
  assert.equal(c.live!.phase, 'needs');
});

test('idle after working says it is waiting; the end of the session says so', () => {
  let c = applyEvent(card(), 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a/b.ts' } }, 1);
  c = applyEvent(c, 'Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }, 2);
  assert.equal(c.live!.phase, 'waiting');
  c = applyEvent(c, 'SessionEnd', { reason: 'prompt_input_exit' }, 3);
  assert.equal(c.live!.text, 'Session ended (prompt input exit)');
  assert.equal(applyEvent(c, 'Nonsense', {}, 4), c);
});

test('tool lines read like the mock', () => {
  assert.equal(describeTool('Write', { file_path: 'C:\\a\\guestCart.ts' }), 'writing guestCart.ts');
  assert.equal(describeTool('Bash', { command: 'pnpm test\nmore' }), 'running: pnpm test');
  assert.equal(describeTool('WebFetch', { url: 'https://docs.example.com/x' }), 'reading docs.example.com');
  assert.equal(describeTool('mcp__x__y'), 'using mcp__x__y');
});

test('a turn that ends on a question needs you; after changes it is ready to try instead', () => {
  const msg = 'I need one clarification before finalizing the plan: **What should the one line in NOTES.md say?** Should it be generic?\n\nOnce you answer, I will write the plan.';
  assert.equal(endingQuestion(msg), 'Should it be generic?');
  assert.equal(endingQuestion('All done. Tests pass.'), null);
  assert.equal(endingQuestion('Is this right?\n\nFirst para.\n\nSecond.\n\nThird.'), null, 'only the last two paragraphs count');
  const planning = applyEvent(card(), 'Stop', { permission_mode: 'plan', last_assistant_message: msg }, 1);
  assert.equal(planning.stage, 'plan');
  assert.equal(planning.live!.phase, 'needs');
  assert.equal(planning.live!.text, 'Asking: Should it be generic?');
  const building = applyEvent(card({ stage: 'build' }), 'Stop', { permission_mode: 'default', last_assistant_message: 'Which file do you mean?' }, 1);
  assert.equal(building.stage, 'needs');
  const changed = applyEvent(card({ stage: 'build', files: ['a.ts'] }), 'Stop', { last_assistant_message: 'Done. Anything else?' }, 1);
  assert.equal(changed.stage, 'try');
  assert.equal(applyEvent(planning, 'UserPromptSubmit', { permission_mode: 'plan' }, 2).live!.ask, undefined, 'your reply clears it');
});

test('only files in the card’s own repos count as changes; the plan file does not', () => {
  const planFile = String.raw`C:\Users\me\.claude\plans\add-notes.md`;
  const c = run(card(), [
    ['PreToolUse', { permission_mode: 'plan', tool_name: 'Write', tool_input: { file_path: planFile } }],
    ['PostToolUse', { permission_mode: 'plan', tool_name: 'Write', tool_input: { file_path: planFile } }],
  ]);
  assert.equal(c.live!.text, 'writing the plan');
  assert.deepEqual(c.files, []);
});

test('a helper still working in parallel doesn’t hide a prompt another helper is waiting on', () => {
  const c = run(card({ stage: 'plan' }), [
    ['UserPromptSubmit', { permission_mode: 'plan', prompt: 'Plan it' }],
    ['PreToolUse', { agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'cd web && ls' } }],
    ['PermissionRequest', { agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'cd web && ls' } }],
    ['PreToolUse', { agent_id: 'a2', tool_name: 'Read', tool_input: { file_path: 'D:\r\a.ts' } }],
  ]);
  assert.equal(c.stage, 'needs');
  assert.equal(c.live!.phase, 'needs');
  assert.match(c.live!.text, /Waiting for you to allow/);
  const after = run(c, [['PostToolUse', { agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'cd web && ls' } }]]);
  assert.equal(after.live!.phase, 'working', 'once it runs, it was allowed');
  assert.equal(after.stage, 'plan');
});

test('a QA or review card ends with its report: the card moves to Ship with the result; a development card never takes one', () => {
  const msg = 'All done.\n\n# QA report: SHOP-149\nResult: **Failed**\n\n| # | Check | Result |\n|---|---|---|\n| 1 | Balance shows | pass |';
  const qa = applyEvent(card({ kind: 'qa', stage: 'build', files: ['D:/r/notes.md'] }), 'Stop', { last_assistant_message: msg }, 5);
  assert.equal(qa.stage, 'ship', 'not Try it, though a file changed');
  assert.equal(qa.report!.result, 'Failed');
  assert.match(qa.report!.text, /^# QA report: SHOP-149/);
  assert.match(qa.live!.text, /QA report ready: Failed/);
  const review = applyEvent(card({ kind: 'review', stage: 'plan' }), 'Stop', { last_assistant_message: '## Code review: SHOP-162\nVerdict: Changes requested\n- a.ts:3 blocking' }, 5);
  assert.equal(review.stage, 'ship');
  assert.equal(review.report!.result, 'Changes requested');
  const midway = applyEvent(card({ kind: 'qa', stage: 'build' }), 'Stop', { last_assistant_message: 'Step 2: open the checkout. What do you see?' }, 5);
  assert.equal(midway.report, undefined);
  assert.equal(midway.stage, 'needs', 'a walkthrough question waits on you');
  const build = applyEvent(card({ stage: 'build' }), 'Stop', { last_assistant_message: msg }, 5);
  assert.equal(build.report, undefined);
});
