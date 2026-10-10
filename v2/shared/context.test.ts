import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchOf, contextPack, firstMessageFor, keyFor, suggestApis, suggestRepos, titleFor } from './context.ts';
import type { Stack } from '../../shared/stack.ts';

const stack: Stack = {
  choose: { env: ['dev', 'uat'] },
  api: { steps: ['okteto up'] },
  apis: [{ repo: 'payments-api', values: {} }, { repo: 'fees-api', values: {} }, { repo: 'loans-api', values: {} }],
  ui: { repo: 'web-app', proxyFile: 'proxy.conf.json', steps: ['nx serve shell'] },
};
const ticket = { key: 'SHOP-160', title: 'Waive the late fee on a loan', description: 'The fees-api records the waiver.', acceptance: ['Waive with a reason'], links: [] };

test('a key, title and branch for a ticket and for a plain ask', () => {
  assert.equal(keyFor('Tidy the loan page styles, please'), 'tidy-the-loan-page');
  assert.equal(titleFor(undefined, 'Tidy the loan page styles\nmore'), 'Tidy the loan page styles');
  assert.equal(titleFor(ticket, 'x'), 'Waive the late fee on a loan');
  assert.equal(branchOf('SHOP-160', 'Waive the late fee on a loan'), 'shop-160-waive-late-fee-loan');
  assert.equal(branchOf('tidy-the-loan-page', 'Tidy'), 'cc/tidy-the-loan-page');
  assert.match(firstMessageFor(ticket, ''), /plan SHOP-160/);
  assert.match(firstMessageFor(undefined, 'Tidy it'), /^Tidy it/);
});

test('repos named in the ticket, the stack\'s UI and the home are ticked; the APIs follow the ticked repos', () => {
  const repos = suggestRepos(['C:/src/web-app', 'C:/src/payments-api', 'C:/src/fees-api', 'C:/src/docs'], 'C:/src/payments-api', stack, `${ticket.title}\n${ticket.description}`);
  assert.deepEqual(repos.map((r) => [r.name, r.on]), [['web-app', true], ['payments-api', true], ['fees-api', true], ['docs', false]]);
  assert.equal(repos[2].why, 'named in the ticket');
  const apis = suggestApis(stack, repos.filter((r) => r.on).map((r) => r.name));
  assert.deepEqual(apis.map((a) => [a.name, a.on]), [['payments-api', true], ['fees-api', true], ['loans-api', false]]);
});

test('the context pack has the ticket, the worktrees, the stack, the logs and only the tools this machine has', () => {
  const pack = contextPack({ key: 'SHOP-160', title: ticket.title, ticket, repos: [{ name: 'web-app', dir: 'C:/src/web-app-shop-160' }], branch: 'shop-160-waive', logsDir: 'C:/logs/SHOP-160', apis: ['fees-api'], tools: { loans: true, fields: false, fieldLists: [] } });
  assert.match(pack, /# SHOP-160 · Waive the late fee/);
  assert.match(pack, /- Waive with a reason/);
  assert.match(pack, /web-app: `C:\/src\/web-app-shop-160`/);
  assert.match(pack, /fees-api\. Every other API comes from Dev/);
  assert.match(pack, /make_test_loan/);
  assert.doesNotMatch(pack, /lookup_fields/);
});
