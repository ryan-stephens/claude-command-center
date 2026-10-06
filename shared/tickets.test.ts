import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packetText, type Packet } from './cards.ts';
import { doneStatuses, finishedTickets, finishesCard, inbox, relatedItem, ticketItems, type Ticket } from './tickets.ts';

test('a ticket past the work finishes its card: the done category, or Done / Ready for PO / Ready for Prod by name (CC_CONTROL_DONE_STATUSES changes the names)', () => {
  assert.equal(finishesCard({ status: 'In Progress', done: false }), false);
  assert.equal(finishesCard({ status: 'Ready for QA', done: false }), false);
  assert.equal(finishesCard({ status: 'Ready for PO', done: false }), true);
  assert.equal(finishesCard({ status: 'Ready for Prod', done: false }), true);
  assert.equal(finishesCard({ status: 'done', done: false }), true, 'any case');
  assert.equal(finishesCard({ status: 'Closed', done: true }), true, 'the done category, whatever the name');
  assert.equal(finishesCard({ status: 'Ready for PO', done: false }, ['Done']), false, 'a list of your own');
  assert.equal(finishesCard({ status: 'Accepted', done: false }, doneStatuses('Accepted, Done ')), true);
  assert.deepEqual(doneStatuses(''), ['Done', 'Ready for PO', 'Ready for Prod']);
  assert.deepEqual(doneStatuses(undefined), ['Done', 'Ready for PO', 'Ready for Prod']);
});

const T = (over: Partial<Ticket> = {}): Ticket => ({
  key: 'SHOP-155', source: 'jira', project: 'SHOP', projectName: 'Storefront', title: 'Save cart for signed-out users',
  description: 'Guests lose their cart.', acceptance: ['The cart survives closing the tab', 'It merges on sign-in'],
  comments: [{ author: 'Priya', body: 'Keep the 30 days configurable', at: 1 }, { author: 'Sam', body: 'Check the cookie banner', at: 2 }],
  attachments: [{ name: 'flow.png' }], links: [{ key: 'SHOP-98', title: 'Guest checkout', relation: 'relates to' }],
  status: 'To Do', done: false, updatedAt: 10, workspaceId: 'w1', ...over,
});

test('a ticket’s layer: description and criteria on, comments and links there but off, attachments on', () => {
  const items = ticketItems(T());
  assert.deepEqual(items.map((i) => [i.kind, i.on]), [['desc', true], ['ac', true], ['ac', true], ['comments', false], ['attach', true], ['linked', false]]);
  assert.equal(items[3].label, 'Comments (2), latest: “Check the cookie banner”');
  assert.equal(items[3].text, '- Priya: Keep the 30 days configurable\n- Sam: Check the cookie banner');
  assert.equal(ticketItems(T({ description: ' ', comments: [], attachments: [], links: [] })).length, 2, 'only what the ticket has');
});

test('the packet text leads with the ticket, and includes what is switched on', () => {
  const t = T();
  const items = ticketItems(t).map((i) => (i.kind === 'comments' ? { ...i, on: true } : i));
  const packet: Packet = { workspace: [{ kind: 'repo', id: 'D:\\r\\web-app', label: 'web-app', on: true }], ticket: items, card: [relatedItem(T({ key: 'PAY-7', title: 'Cart API', description: 'The API.' }))], note: '' };
  const text = packetText({ title: t.title, packet, launch: { home: 'D:\\r\\web-app', branch: 'new', mode: 'plan', message: '' }, ticket: t }, 'SHOP-155');
  assert.match(text, /^# Context from cc-control · SHOP-155 Save cart for signed-out users\n\n## The ticket \(Jira SHOP-155\)\nGuests lose their cart\.\n\nDone when:\n- The cart survives closing the tab\n- It merges on sign-in\n\nComments:\n- Priya: Keep/);
  assert.match(text, /Attachment: flow\.png/);
  assert.doesNotMatch(text, /Linked ticket/, 'off by default');
  assert.doesNotMatch(text, /## The task/, 'the ticket says what the task is');
  assert.match(text, /## Also look at\n- PAY-7 Cart API\n {2}The API\./);
});

test('the Inbox: open tickets without a card, in the workspace shown, newest first', () => {
  const list = [T({ key: 'A-1', updatedAt: 1 }), T({ key: 'A-2', updatedAt: 3 }), T({ key: 'A-3', done: true }), T({ key: 'B-1', workspaceId: null, updatedAt: 2 }), T({ key: 'A-4' })];
  assert.deepEqual(inbox(list, new Set(['A-4']), 'all').map((t) => t.key), ['A-2', 'B-1', 'A-1']);
  assert.deepEqual(inbox(list, new Set(), 'w1').map((t) => t.key), ['A-4', 'A-2', 'A-1'], 'an unmapped project shows under All only');
});

test('tickets past the work (Done, Ready for PO, Ready for Prod) leave the Inbox for the Done column (§100)', () => {
  const list = [T({ key: 'A-1', status: 'In Progress' }), T({ key: 'A-2', status: 'Ready for PO', updatedAt: 2 }), T({ key: 'A-3', status: 'Ready for Prod', updatedAt: 3 }), T({ key: 'A-4', status: 'Closed', done: true, updatedAt: 1 }), T({ key: 'A-5', status: 'Ready for PO' })];
  assert.deepEqual(inbox(list, new Set(['A-5']), 'all').map((t) => t.key), ['A-1']);
  assert.deepEqual(finishedTickets(list, new Set(['A-5']), 'all').map((t) => t.key), ['A-3', 'A-2', 'A-4'], 'a ticket with a card shows as its card');
  // CC_CONTROL_DONE_STATUSES: only these names (and the done category).
  assert.deepEqual(inbox(list, new Set(), 'all', 'mine', ['Done']).map((t) => t.key), ['A-1', 'A-5', 'A-3', 'A-2']);
  assert.deepEqual(finishedTickets(list, new Set(), 'all', 'mine', ['Done']).map((t) => t.key), ['A-4']);
});
