import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fuzzyScore } from './fuzzy.ts';

const rank = (query: string, items: string[]) =>
  items.map((t) => [t, fuzzyScore(query, t)] as const).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1]).map(([t]) => t);

test('requires every character in order', () => {
  assert.equal(fuzzyScore('xyz', 'New session'), -1);
  assert.ok(fuzzyScore('nse', 'New session') > 0);
});

test('word starts and runs beat scattered matches', () => {
  assert.deepEqual(rank('cr', ['Scratch record', 'Code review'])[0], 'Code review');
  assert.deepEqual(rank('sound', ['Toggle sound', 'Session unread order']) [0], 'Toggle sound');
});

test('empty query matches everything equally', () => {
  assert.equal(fuzzyScore('', 'anything'), 0);
});
