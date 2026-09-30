import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NO_FOLDS, parseFolds, toggled } from './folds.ts';

test('parseFolds keeps only known keys and survives junk', () => {
  assert.deepEqual(parseFolds(null), NO_FOLDS);
  assert.deepEqual(parseFolds('not json'), NO_FOLDS);
  assert.deepEqual(parseFolds('[1,2]'), NO_FOLDS);
  // Folds saved before Home went (workspaces, library, dock, buckets) are dropped.
  assert.deepEqual(parseFolds(JSON.stringify({ workspaces: true, pad: 'yes', todos: true, dock: true, buckets: { earlier: true } })), { pad: false, todos: true });
});

test('toggling a section flips only that one', () => {
  const f = toggled(NO_FOLDS, 'pad');
  assert.equal(f.pad, true);
  assert.equal(f.todos, false);
  assert.equal(toggled(f, 'pad').pad, false);
  assert.equal(NO_FOLDS.pad, false, 'no mutation');
});
