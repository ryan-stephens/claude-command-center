import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionActivity } from '../shared/protocol.ts';
import { activityLine, activityShort, duration } from './activity-label.ts';

const base: SessionActivity = { phase: 'idle', phaseSince: 0, tasks: [] };

test('durations', () => {
  assert.equal(duration(9_400), '9s');
  assert.equal(duration(75_000), '1m 15s');
  assert.equal(duration(3_700_000), '1h 1m');
});

test('lines for each phase', () => {
  assert.equal(activityLine(base, 0), null);
  const tool = activityLine({ ...base, phase: 'tool', phaseSince: 1000, turnStartedAt: 0, tool: { name: 'Bash', detail: 'npm test' } }, 9000);
  assert.deepEqual(tool, { text: 'Bash · npm test', elapsed: '8s', turn: '9s', tone: 'busy' });
  assert.equal(activityLine({ ...base, phase: 'thinking', thinkingTokens: 1540 }, 0)!.text, 'Thinking… · ~1.5k tokens');
  assert.equal(activityLine({ ...base, phase: 'approval', tool: { name: 'Edit' } }, 0)!.tone, 'attention');
  assert.equal(
    activityLine({ ...base, phase: 'retrying', retry: { attempt: 2, max: 10, resumeAt: 5000, status: 529 } }, 1200)!.text,
    'API 529 · retrying in 4s (attempt 2/10)',
  );
});

test('an idle session with background work still says so', () => {
  const a: SessionActivity = { ...base, tasks: [{ id: 't', kind: 'local_bash', description: 'dev server', status: 'running', background: true, startedAt: 0 }] };
  assert.equal(activityLine(a, 0)!.text, 'Idle · 1 running in the background');
});

test('short labels for the list', () => {
  assert.equal(activityShort({ ...base, phase: 'tool', turnStartedAt: 0, tool: { name: 'Bash' } }, 12_000), 'Bash 12s');
  assert.equal(activityShort({ ...base, phase: 'requesting', turnStartedAt: 0 }, 3000), 'working 3s');
  assert.equal(activityShort(base, 0), null);
});
