import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bucketToggled, NO_FOLDS, parseFolds, toggled, unfolded } from './folds.ts';

test('parseFolds keeps only known keys and survives junk', () => {
  assert.deepEqual(parseFolds(null), NO_FOLDS);
  assert.deepEqual(parseFolds('not json'), NO_FOLDS);
  assert.deepEqual(parseFolds('[1,2]').buckets, {});
  assert.deepEqual(
    parseFolds(JSON.stringify({ workspaces: true, pad: 'yes', library: false, buckets: { earlier: true, bogus: true, done: 1 } })),
    { workspaces: true, library: false, pad: false, todos: false, buckets: { earlier: true } },
  );
});

test('toggling a section or a group flips only that one', () => {
  const f = toggled(NO_FOLDS, 'pad');
  assert.equal(f.pad, true);
  assert.equal(toggled(f, 'pad').pad, false);
  assert.equal(NO_FOLDS.pad, false, 'no mutation');
  const g = bucketToggled(NO_FOLDS, 'earlier');
  assert.deepEqual(g.buckets, { earlier: true });
  assert.deepEqual(bucketToggled(g, 'earlier').buckets, {});
});

test('unfolded skips the sessions of folded groups', () => {
  const groups = [{ bucket: 'needs' as const, sessions: ['a'] }, { bucket: 'done' as const, sessions: ['b', 'c'] }, { bucket: 'earlier' as const, sessions: ['d'] }];
  assert.deepEqual(unfolded(groups, NO_FOLDS), ['a', 'b', 'c', 'd']);
  assert.deepEqual(unfolded(groups, bucketToggled(NO_FOLDS, 'done')), ['a', 'd']);
});
