import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextHints, trimLegend } from './hints.ts';
import type { LegendItem } from './legend.ts';

const items: LegendItem[] = [
  { keys: ['Esc'], label: 'Back to the board' },
  { keys: ['y', 'n'], label: 'Allow / deny', tone: 'attn' },
  { keys: ['t'], label: 'Try it', tone: 'acc' },
  { keys: ['e'], label: 'How it runs' },
];

test('key hints cycle always → on hover → off → always', () => {
  assert.equal(nextHints('always'), 'hover');
  assert.equal(nextHints('hover'), 'never');
  assert.equal(nextHints('never'), 'always');
});

test('the legend keeps everything, only what matters now, or goes', () => {
  assert.equal(trimLegend(items, 'always'), items);
  assert.deepEqual(trimLegend(items, 'hover')!.map((i) => i.label), ['Allow / deny', 'Try it']);
  assert.equal(trimLegend(items, 'never'), null);
});
