import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMatches, skipStatuses, suggest, workable } from './tickets.ts';
import type { TicketPick } from './types.ts';

const p = (key: string, title: string, mine = true, status = 'In Progress'): TicketPick => ({ key, title, status, updatedAt: 0, mine });

test('your list leaves out done tickets, Ready for PO and Ready for Prod; CCV2_JIRA_SKIP replaces the statuses, none keeps all', () => {
  const skip = skipStatuses(undefined);
  assert.deepEqual(skip, ['Ready for PO', 'Ready for Prod']);
  assert.equal(workable({ status: 'Ready for Prod', done: false }, skip), false);
  assert.equal(workable({ status: 'In Progress', done: false }, skip), true);
  assert.equal(workable({ status: 'ready for po', done: false }, skip), false);
  assert.equal(workable({ status: 'Done', done: true }, skip), false);
  assert.deepEqual(skipStatuses(' Ready for PO, In Review '), ['Ready for PO', 'In Review']);
  assert.deepEqual(skipStatuses('none'), []);
});

test('a ticket matches by the start of its key or every word in it', () => {
  const t = p('SHOP-160', 'Cart badge shows the wrong count');
  assert.equal(pickMatches(t, 'shop-1'), true);
  assert.equal(pickMatches(t, 'badge count'), true);
  assert.equal(pickMatches(t, 'badge refund'), false);
  assert.equal(pickMatches(t, ''), true);
});

test('suggestions: your matching tickets first, then what the search found, without repeats', () => {
  const mine = [p('SHOP-160', 'Cart badge'), p('PAY-91', 'Refund status')];
  const found = [p('SHOP-160', 'Cart badge', false), p('PAY-93', 'Retry refunds', false)];
  assert.deepEqual(suggest(mine, found, '').map((x) => x.key), ['SHOP-160', 'PAY-91']);
  assert.deepEqual(suggest(mine, found, 'refund').map((x) => x.key), ['PAY-91', 'SHOP-160', 'PAY-93']);
});
