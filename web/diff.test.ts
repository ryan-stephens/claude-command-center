import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffStats, lineDiff } from './diff.ts';

const show = (before: string, after: string, context?: number) =>
  lineDiff(before, after, context).map((l) => (l.kind === 'gap' ? `…${l.count}` : `${{ same: ' ', del: '-', add: '+' }[l.kind]}${l.text}`));

test('an inserted line shows as one addition between unchanged neighbours', () => {
  assert.deepEqual(show('<h1>Acme</h1>\n<button>', '<h1>Acme</h1>\n<p>Updated daily</p>\n<button>'), [' <h1>Acme</h1>', '+<p>Updated daily</p>', ' <button>']);
});

test('a changed line is a removal then an addition', () => {
  assert.deepEqual(show('a\nb\nc', 'a\nB\nc'), [' a', '-b', '+B', ' c']);
});

test('long unchanged runs fold to a gap, keeping context around the change', () => {
  const before = ['1', '2', '3', '4', '5', '6', '7', '8'].join('\n');
  const after = ['1', '2', '3', '4', '5', 'six', '7', '8'].join('\n');
  assert.deepEqual(show(before, after, 1), ['…4', ' 5', '-6', '+six', ' 7', '…1']);
});

test('new files are all additions, and stats count lines', () => {
  const d = lineDiff('', 'x\ny');
  assert.deepEqual(diffStats(d), { added: 2, removed: 0 });
  assert.deepEqual(diffStats(lineDiff('a\nb', 'a')), { added: 0, removed: 1 });
});
