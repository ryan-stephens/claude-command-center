import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyHook } from './hook-state.ts';
import type { ClaudeStatus } from '../shared/types.ts';

const start: ClaudeStatus = { state: 'starting', text: 'opening', at: 0 };

test('a session moves through its hooks: started, working, a permission prompt, carrying on, done', () => {
  let s = applyHook(start, 'SessionStart', { session_id: 'abc', source: 'startup' }, 1);
  assert.equal(s.state, 'done');
  assert.equal(s.claudeId, 'abc');
  s = applyHook(s, 'UserPromptSubmit', { session_id: 'abc', prompt: 'go' }, 2);
  assert.equal(s.state, 'working');
  s = applyHook(s, 'PreToolUse', { session_id: 'abc', tool_name: 'Edit', tool_input: { file_path: 'C:/x/fees.ts' } }, 3);
  assert.deepEqual([s.state, s.text], ['working', 'editing fees.ts']);
  s = applyHook(s, 'PermissionRequest', { session_id: 'abc', tool_name: 'Bash', tool_input: { command: 'pnpm db:migrate' } }, 4);
  assert.deepEqual([s.state, s.text], ['needs-you', 'wants to run: pnpm db:migrate']);
  // The terminal's own notification of the same prompt keeps the better words and the time it started.
  s = applyHook(s, 'Notification', { session_id: 'abc', message: 'Claude needs your permission to use Bash' }, 5);
  assert.deepEqual([s.state, s.text, s.at], ['needs-you', 'wants to run: pnpm db:migrate', 4]);
  s = applyHook(s, 'PostToolUse', { session_id: 'abc', tool_name: 'Bash' }, 6);
  assert.equal(s.state, 'working');
  s = applyHook(s, 'Stop', { session_id: 'abc', last_assistant_message: 'Done. Tests pass.' }, 7);
  assert.deepEqual([s.state, s.text], ['done', 'turn ended']);
  s = applyHook(s, 'SessionEnd', { session_id: 'abc' }, 8);
  assert.equal(s.state, 'ended');
  assert.equal(s.claudeId, 'abc');
});

test('a turn that ends on a question, a plan to approve and a question form are the user\'s move', () => {
  assert.equal(applyHook(start, 'Stop', { last_assistant_message: 'I can do A or B.\n\nWhich do you want?' }, 1).text, 'asks: Which do you want?');
  assert.equal(applyHook(start, 'PreToolUse', { tool_name: 'ExitPlanMode' }, 1).state, 'needs-you');
  assert.equal(applyHook(start, 'PreToolUse', { tool_name: 'AskUserQuestion' }, 1).state, 'needs-you');
});

test('a subagent\'s events leave the session as it was, and an idle notice after a turn changes nothing', () => {
  const working: ClaudeStatus = { state: 'working', text: 'editing a.ts', at: 1, claudeId: 'main' };
  assert.deepEqual(applyHook(working, 'PreToolUse', { session_id: 'sub', agent_id: 'x', tool_name: 'Read' }, 2), working);
  const done: ClaudeStatus = { state: 'done', text: 'turn ended', at: 1 };
  assert.deepEqual(applyHook(done, 'Notification', { message: 'Claude is waiting for your input' }, 9), done);
});
