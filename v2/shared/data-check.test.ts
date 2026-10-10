import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanAsk, idsToRead, parseFieldLines, sameValue } from './data-check.ts';

test('values alike: commas and trailing zeros in numbers, case elsewhere', () => {
  assert.equal(sameValue('1,250.00', '1250'), true);
  assert.equal(sameValue(' Yes ', 'yes'), true);
  assert.equal(sameValue('12.5', '12.50'), true);
  assert.equal(sameValue('12.5', '13'), false);
  assert.equal(sameValue('', ''), true);
});

test('field lines: "ID = value", bare ids, ids with spaces, an empty value, comments', () => {
  const r = parseFieldLines('CX.FEE = 12.50\nGROUP.NAME.ROLE NAME = Sample role\n\n# a note\nCX.ONLY\nCX.EMPTY =\ncx.fee = again');
  assert.deepEqual(r.ids, ['CX.FEE', 'GROUP.NAME.ROLE NAME', 'CX.ONLY', 'CX.EMPTY']);
  assert.deepEqual(r.values, { 'CX.FEE': '12.50', 'GROUP.NAME.ROLE NAME': 'Sample role', 'CX.EMPTY': '', 'cx.fee': 'again' });
});

test('an ask: Dev or UAT only, a scenario or a loan, something to fill or check', () => {
  assert.throws(() => cleanAsk({ env: 'prod', scenario: 'x', fields: ['a'] }), /never Prod/);
  assert.throws(() => cleanAsk({ env: 'dev', fields: ['a'] }), /scenario/);
  assert.throws(() => cleanAsk({ env: 'dev', scenario: 'x', loan: 'y', fields: ['a'] }), /not both/);
  assert.throws(() => cleanAsk({ env: 'dev', scenario: 'x' }), /which fields/);
  assert.throws(() => cleanAsk({ env: 'dev', loan: 'a b;c', fields: ['a'] }), /look like/);
  assert.deepEqual(cleanAsk({ env: 'UAT', loan: ' LN-1 ', set: { A: 1 }, list: ' ' }), { env: 'uat', loan: 'LN-1', set: { A: '1' } });
});

test('the ids read at the end: the list, the named, the filled, the expected, each once', () => {
  assert.deepEqual(idsToRead({ env: 'dev', loan: 'x', fields: ['B', 'a'], set: { C: '1' }, expect: { b: '2', D: '3' } }, ['A']), ['A', 'B', 'C', 'D']);
});
