import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionActivity } from '../shared/protocol.ts';
import { activityLine, activityShort, duration, turnClock } from './activity-label.ts';

const base: SessionActivity = { phase: 'idle', phaseSince: 0, tasks: [] };

test('durations', () => {
  assert.equal(duration(9_400), '9s');
  assert.equal(duration(75_000), '1m 15s');
  assert.equal(duration(3_700_000), '1h 1m');
});

test('lines for each phase', () => {
  assert.equal(activityLine(base, 0), null);
  const tool = activityLine({ ...base, phase: 'tool', phaseSince: 1000, turnStartedAt: 0, tool: { name: 'Bash', detail: 'npm test', fields: { command: 'npm test' } } }, 9000);
  assert.deepEqual(tool, { text: 'Running npm test…', elapsed: '8s', turn: '9s', tone: 'busy' });
  const read = activityLine({ ...base, phase: 'tool', tool: { name: 'Read', fields: { filePath: '/r/index.html' } } }, 0, '/r');
  assert.equal(read!.text, 'Reading index.html…');
  assert.equal(activityLine({ ...base, phase: 'thinking', thinkingTokens: 1540 }, 0)!.text, 'Thinking… · ~1.5k tokens');
  const approval = activityLine({ ...base, phase: 'approval', tool: { name: 'Bash', fields: { command: 'rm x', description: 'Delete the old log' } } }, 0)!;
  assert.deepEqual([approval.tone, approval.text], ['attention', 'Waiting for your OK to delete the old log']);
  assert.equal(
    activityLine({ ...base, phase: 'retrying', retry: { attempt: 2, max: 10, resumeAt: 5000, status: 529 } }, 1200)!.text,
    "Claude's servers are busy (529) · trying again in 4s (attempt 2 of 10)",
  );
});

test('an idle session with background work still says so', () => {
  const a: SessionActivity = { ...base, tasks: [{ id: 't', kind: 'local_bash', description: 'dev server', status: 'running', background: true, startedAt: 0 }] };
  assert.equal(activityLine(a, 0)!.text, 'Done · 1 still running in the background');
});

test('short labels and the turn clock for rows', () => {
  assert.equal(activityShort({ ...base, phase: 'tool', tool: { name: 'Edit', fields: { filePath: '/r/resize.js' } } }, '/r'), 'Changing resize.js');
  assert.equal(activityShort({ ...base, phase: 'requesting' }), 'Working');
  assert.equal(activityShort(base), null);
  assert.equal(turnClock({ ...base, phase: 'tool', turnStartedAt: 0 }, 72_000), '1:12');
  assert.equal(turnClock(base, 72_000), null);
});
