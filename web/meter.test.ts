import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ctxTone, fmtCost, fmtTokens, meterTitle } from './meter.ts';

test('§115: tokens, cost and the bar’s tone read as people read them', () => {
  assert.deepEqual([850, 1000, 4200, 42_300, 200_000, 1_000_000, 1_250_000].map(fmtTokens), ['850', '1k', '4.2k', '42k', '200k', '1M', '1.3M']);
  assert.deepEqual([0, 0.004, 0.84, 12.3].map(fmtCost), ['$0.00', '<$0.01', '$0.84', '$12.30']);
  assert.deepEqual([10, 70, 85].map(ctxTone), ['ok', 'attn', 'bad']);
});

test('§115: the meter’s title says each part it knows, and nothing it doesn’t', () => {
  assert.equal(meterTitle({ ctxPct: 21, ctxTokens: 42_000, ctxMax: 200_000, costUsd: 0.84, branch: 'card-2' }),
    'Context 21% full (42k of 200k tokens). Near the top, /compact tidies it. About $0.84 so far this session (an estimate at list price, not a bill). On branch card-2.');
  assert.equal(meterTitle({ branch: 'main' }), 'On branch main.');
  assert.equal(meterTitle({}), '');
});
