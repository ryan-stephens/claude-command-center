import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextHealth } from './health.ts';

const up = { state: 'up' as const, text: 'Running', steps: [] };

test('a service is starting, then up while it answers, unhealthy after two misses, and up again when it answers', () => {
  let t = nextHealth(undefined, { state: 'running', text: 'x', steps: [{ cmd: 'nx serve', state: 'go', tail: [], waitNote: 'compiling…' }] }, undefined, 0);
  assert.deepEqual([t.health, t.note], ['starting', 'compiling']);
  t = nextHealth(t, up, true, 5_000);
  assert.equal(t.health, 'up');
  assert.equal(t.since, 5_000);
  t = nextHealth(t, up, false, 10_000);
  assert.equal(t.health, 'up', 'one miss is not enough');
  t = nextHealth(t, up, false, 15_000);
  assert.deepEqual([t.health, t.note], ['unhealthy', 'no answer 10 s']);
  t = nextHealth(t, up, true, 20_000);
  assert.deepEqual([t.health, t.misses], ['up', 0]);
  assert.equal(t.since, 20_000);
});

test('a failed run is failed with its words, a stopped one stopped, none stopped', () => {
  assert.deepEqual(nextHealth(undefined, { state: 'failed', text: 'okteto up failed (exit 1)', steps: [] }, undefined, 1).note, 'okteto up failed (exit 1)');
  assert.equal(nextHealth(undefined, { state: 'stopped', text: 'Stopped', steps: [] }, undefined, 1).health, 'stopped');
  assert.equal(nextHealth(undefined, undefined, undefined, 1).health, 'stopped');
});
