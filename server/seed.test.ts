import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanSeed, seedAllowed, seedCard, seedTranscript } from './seed.ts';

test('seeding is refused on the default port only', () => {
  assert.equal(seedAllowed(7777), false);
  assert.equal(seedAllowed(7802), true);
});

test('cleanSeed keeps what it understands and needs a repo', () => {
  assert.throws(() => cleanSeed({}), /at least one repo/);
  const o = cleanSeed({ repos: ['C:/x/web-app', 5], worktrees: ['C:/x/web-app-shop-155'], key: 'SHOP-155', state: 'tool', channel: false, title: 'T', workspaceId: 'ws1', junk: 1 });
  assert.deepEqual(o, { repos: ['C:/x/web-app'], worktrees: ['C:/x/web-app-shop-155'], workspaceId: 'ws1', key: 'SHOP-155', title: 'T', state: 'tool', channel: false });
  assert.equal(cleanSeed({ repos: ['a'], key: 'bad key', state: 'nope' }).key, undefined);
});

test('a plan card waits on a plan, in Needs you, with a note still waiting', () => {
  const c = seedCard({ repos: ['C:/x/web-app', 'C:/x/payments-api'], worktrees: ['C:/x/web-app-shop-155', 'C:/x/payments-api-shop-155'] }, 'id1', 1_000_000);
  assert.equal(c.id, 'id1');
  assert.equal(c.key, 'SHOP-155');
  assert.equal(c.stage, 'needs');
  assert.equal(c.live?.ask?.kind, 'plan');
  assert.equal(c.live?.ask?.requestId, 'seed-req-id1', 'the app runs it (§93): the ask carries a request id');
  assert.equal(c.relayed, undefined);
  assert.equal(c.cwd, 'C:/x/web-app-shop-155');
  assert.deepEqual(c.folders, [{ repo: 'C:/x/web-app', dir: 'C:/x/web-app-shop-155' }, { repo: 'C:/x/payments-api', dir: 'C:/x/payments-api-shop-155' }]);
  assert.equal(c.launch.branch, 'worktree');
  assert.equal(c.sessionId, 'seed-id1');
  assert.equal(c.runner, 'app');
  const tab = seedCard({ repos: ['C:/x/web-app'], channel: false }, 'id2', 1_000_000);
  assert.equal(tab.runner, undefined, 'channel false: a terminal card whose tab is gone');
  assert.equal(tab.relayed?.tool, 'ExitPlanMode');
  assert.equal(c.later?.length, 1);
  assert.deepEqual(c.files, []);
  assert.equal(c.todos?.filter((t) => t.status === 'completed').length, 1);
});

test('the other states: a tool ask, working, idle in Try it, done with a merged PR', () => {
  const at = (s: 'tool' | 'working' | 'idle' | 'done') => seedCard({ repos: ['C:/x/web-app'], state: s }, 'i', 5_000_000);
  assert.equal(at('tool').live?.ask?.kind, 'tool');
  assert.equal(at('tool').stage, 'needs');
  assert.equal(at('working').live?.phase, 'working');
  assert.equal(at('working').stage, 'build');
  assert.equal(at('idle').stage, 'try');
  assert.equal(at('idle').files?.length, 2);
  assert.equal(at('done').stage, 'done');
  assert.equal(at('done').ship?.prs?.[0].state, 'MERGED');
  assert.equal(at('done').launch.branch, 'current');
  assert.equal(at('done').cwd, 'C:/x/web-app');
});

test('the transcript grows with the state and keeps unique uuids', () => {
  const plan = seedTranscript('SHOP-1', 'plan');
  const idle = seedTranscript('SHOP-1', 'idle');
  assert.ok(plan.length < idle.length);
  assert.equal(new Set(idle.map((i) => i.uuid)).size, idle.length);
  assert.equal(idle.at(-1)?.kind, 'assistant');
});

test('a sized transcript is that long, ends as the unsized one does, and keeps unique uuids (walk-perf)', () => {
  const big = seedTranscript('PERF-1', 'idle', 300);
  const own = seedTranscript('PERF-1', 'idle');
  assert.equal(big.length, 300);
  assert.deepEqual(big.slice(-own.length), own);
  assert.equal(new Set(big.map((i) => i.uuid)).size, 300);
  assert.equal(cleanSeed({ repos: ['C:/x'], size: 99999 }).size, 2000);
  assert.equal(cleanSeed({ repos: ['C:/x'], size: -1 }).size, undefined);
});
