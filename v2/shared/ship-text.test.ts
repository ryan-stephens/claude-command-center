import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultTitle, evidenceOf, prBody, slackText } from './ship-text.ts';

const s = {
  key: 'SHOP-160', title: 'Waive the late fee', ticket: { key: 'SHOP-160', title: 'Waive the late fee', url: 'https://example.invalid/browse/SHOP-160', description: '', acceptance: ['Waive with a reason'], links: [] },
  evidence: [{ kind: 'tests' as const, text: '18 tests pass, 4 new', at: 1, ok: true }],
  loans: [{ loan: 'LN-20481', env: 'dev' as const, scenario: 'Late fee due', at: 2 }],
  fields: [{ loan: 'LN-20481', env: 'dev' as const, list: 'Fee fields', total: 12, matched: 11, differs: [{ id: 'WaiverReason' }], at: 3 }],
};

test('the PR carries the ticket, the criteria and every piece of evidence in order', () => {
  assert.equal(defaultTitle(s), 'feat: SHOP-160 waive the late fee');
  const ev = evidenceOf(s);
  assert.deepEqual(ev.map((e) => e.kind), ['tests', 'loan', 'fields']);
  assert.equal(ev[2].ok, false);
  const body = prBody(s, 'Adds a waive action.', [{ repo: 'web-app', url: 'https://example.invalid/pr/2' }]);
  assert.match(body, /\*\*SHOP-160\*\*/);
  assert.match(body, /- \[ \] Waive with a reason/);
  assert.match(body, /✅ Test loan LN-20481 \(Dev\)/);
  assert.match(body, /⚠️ Field check "Fee fields" on LN-20481: 11 of 12 as expected \(differs: WaiverReason\)/);
  assert.match(body, /web-app: https:\/\/example.invalid\/pr\/2/);
});

test('the review request links each PR and says what was checked', () => {
  const t = slackText(s, [{ repo: 'payments-api', number: 483, url: 'https://example.invalid/pr/483' }], '@payments');
  assert.match(t, /^@payments \*Review please: SHOP-160 Waive the late fee\*/);
  assert.match(t, /<https:\/\/example.invalid\/pr\/483\|payments-api #483>/);
  assert.match(t, /✓ 18 tests pass/);
});
