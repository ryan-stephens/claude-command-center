import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionActivity } from '../shared/protocol.ts';
import { applyEvent, backgroundRunning, idleActivity, setApproval, startTurn } from './activity.ts';

// Event shapes as captured from a real turn (see docs/PLAN.md §16).
const blockStart = (type: string, name?: string, sub = false) =>
  ({ type: 'stream_event', parent_tool_use_id: sub ? 'toolu_parent' : null, event: { type: 'content_block_start', content_block: { type, name } } });
const toolUseMsg = (name: string, input: unknown) =>
  ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name, input }] } });
const toolResult = { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result' }] } };

function run(events: object[], start = startTurn(idleActivity(0), 0)): SessionActivity {
  return events.reduce<SessionActivity>((a, e, i) => applyEvent(a, e as never, (i + 1) * 1000), start);
}

test('a turn moves through requesting → tool (with its input) → requesting → thinking → writing → idle', () => {
  let a = startTurn(idleActivity(0), 0);
  assert.equal(a.phase, 'requesting');
  a = applyEvent(a, blockStart('tool_use', 'Bash') as never, 1000);
  assert.deepEqual([a.phase, a.tool?.name], ['tool', 'Bash']);
  a = applyEvent(a, toolUseMsg('Bash', { command: 'npm test' }) as never, 1500);
  assert.equal(a.tool?.detail, 'npm test');
  assert.equal(a.phaseSince, 1000, 'the input arriving does not reset the tool timer');
  a = applyEvent(a, toolResult as never, 2000);
  assert.equal(a.phase, 'requesting');
  a = applyEvent(a, blockStart('thinking') as never, 3000);
  assert.equal(a.phase, 'thinking');
  a = applyEvent(a, blockStart('text') as never, 4000);
  assert.equal(a.phase, 'writing');
  a = applyEvent(a, { type: 'result', subtype: 'success' } as never, 5000);
  assert.deepEqual([a.phase, a.turnStartedAt, a.tool], ['idle', undefined, undefined]);
});

test('subagent stream events do not change the main phase', () => {
  const a = run([blockStart('tool_use', 'Agent'), blockStart('thinking', undefined, true)]);
  assert.equal(a.phase, 'tool');
  assert.equal(a.tool?.name, 'Agent');
});

test('background shells outlive the turn; subagents are listed while they run', () => {
  const a = run([
    { type: 'system', subtype: 'task_started', task_id: 'agent1', description: 'Compute 17*23', subagent_type: 'general-purpose', is_backgrounded: false, task_type: 'local_agent' },
    { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'bash1', task_type: 'local_bash', description: 'Sleep then echo' }] },
    { type: 'system', subtype: 'task_started', task_id: 'bash1', description: 'Sleep then echo', is_backgrounded: true, task_type: 'local_bash' },
    { type: 'system', subtype: 'task_updated', task_id: 'agent1', patch: { status: 'completed', end_time: 4000 } },
    { type: 'result', subtype: 'success' },
  ]);
  assert.equal(a.phase, 'idle');
  assert.equal(backgroundRunning(a), 1, 'the shell is still running after the turn');
  assert.deepEqual(a.tasks.map((t) => [t.id, t.status]), [['agent1', 'completed'], ['bash1', 'running']]);

  const done = applyEvent(a, { type: 'system', subtype: 'background_tasks_changed', tasks: [] } as never, 20_000);
  assert.equal(backgroundRunning(done), 0);
  assert.equal(done.tasks.find((t) => t.id === 'bash1')?.status, 'completed');
});

test('finished tasks age out of the list', () => {
  const a = run([
    { type: 'system', subtype: 'task_started', task_id: 't1', description: 'x', task_type: 'local_bash' },
    { type: 'system', subtype: 'task_notification', task_id: 't1', status: 'completed', summary: 'done' },
  ]);
  assert.equal(a.tasks.length, 1);
  const later = applyEvent(a, { type: 'result', subtype: 'success' } as never, 10 * 60_000);
  assert.equal(later.tasks.length, 0);
});

test('compacting, API retries and approvals', () => {
  let a = run([{ type: 'system', subtype: 'status', status: 'compacting' }]);
  assert.equal(a.phase, 'compacting');
  a = applyEvent(a, { type: 'system', subtype: 'status', status: null } as never, 9000);
  assert.equal(a.phase, 'requesting');

  a = applyEvent(a, { type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, retry_delay_ms: 4000, error_status: 529 } as never, 10_000);
  assert.deepEqual([a.phase, a.retry?.attempt, a.retry?.resumeAt, a.retry?.status], ['retrying', 2, 14_000, 529]);

  a = applyEvent(a, blockStart('tool_use', 'Bash') as never, 15_000);
  assert.equal(a.retry, undefined, 'a new phase clears the retry');
  a = setApproval(a, true, 16_000);
  assert.deepEqual([a.phase, a.tool?.name], ['approval', 'Bash']);
  a = setApproval(a, false, 17_000);
  assert.deepEqual([a.phase, a.phaseSince], ['tool', 17_000]);
});

test('between turns, the CLI streaming its own chores is not Claude thinking', () => {
  const done = applyEvent(startTurn(idleActivity(0), 1), { type: 'result', subtype: 'success' }, 2);
  const after = applyEvent(done, { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking' } } }, 3);
  assert.equal(after.phase, 'idle');
  assert.equal(applyEvent(done, { type: 'system', subtype: 'thinking_tokens', estimated_tokens: 129 }, 3).thinkingTokens, undefined);
  const turn = applyEvent(startTurn(done, 4), { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking' } } }, 5);
  assert.equal(turn.phase, 'thinking');
});
