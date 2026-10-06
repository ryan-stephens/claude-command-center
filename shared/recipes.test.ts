import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appToOpen, runKey, type CardRun } from './recipes.ts';

const run = (over: Partial<CardRun>): CardRun => ({ cardId: 'c1', repo: 'r', cwd: 'r', steps: [], state: 'up', startedAt: 0, text: '', ...over });
const map = (...rs: CardRun[]) => Object.fromEntries(rs.map((r) => [runKey(r.cardId, r.service), r]));

test('o opens a stack card’s UI: its runs are keyed by service, not by the card (§102)', () => {
  const runs = map(run({ service: 'orders-api', url: 'http://localhost:5001' }), run({ service: 'ui', url: 'http://localhost:4200' }));
  assert.deepEqual(appToOpen(runs, 'c1'), { url: 'http://localhost:4200' });
  assert.deepEqual(appToOpen(map(run({ url: 'http://localhost:5173' })), 'c1'), { url: 'http://localhost:5173' }, 'a single recipe’s run');
  assert.equal(appToOpen(map(run({ service: 'ui', state: 'running' })), 'c1'), 'starting');
  assert.equal(appToOpen(map(run({ service: 'ui', state: 'stopped', url: 'http://localhost:4200' })), 'c1'), null);
  assert.equal(appToOpen(runs, 'other-card'), null);
});
