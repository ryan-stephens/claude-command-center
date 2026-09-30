import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Store } from './store.ts';
import { adfText, boardPrefix, demoTickets, fromJira, fromTrello, splitAcceptance, TicketService } from './tickets.ts';

const text = (t: string) => ({ type: 'text', text: t });
const para = (...c: object[]) => ({ type: 'paragraph', content: c });
const item = (t: string) => ({ type: 'listItem', content: [para(text(t))] });
const doc = (...c: object[]) => ({ type: 'doc', version: 1, content: c });

// The shape Jira Cloud's REST API v3 returns (fields trimmed to the ones asked for).
const ISSUE = {
  key: 'SHOP-155',
  fields: {
    summary: 'Save cart for signed-out users',
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    project: { key: 'SHOP', name: 'Storefront' },
    updated: '2026-09-28T10:00:00.000+0000',
    description: doc(
      para(text('Guests lose their cart when they close the tab.'), { type: 'hardBreak' }, text('Keep it for 30 days.')),
      { type: 'heading', attrs: { level: 3 }, content: [text('Acceptance criteria')] },
      { type: 'bulletList', content: [item('The cart survives closing the tab'), item('It merges on sign-in')] },
      para(text('Design: '), { type: 'inlineCard', attrs: { url: 'https://figma.com/x' } }),
    ),
    comment: { comments: [
      { author: { displayName: 'Priya' }, body: doc(para(text('Keep the 30 days '), { type: 'mention', attrs: { text: '@Sam' } })), created: '2026-09-27T09:00:00.000+0000' },
      { author: { displayName: 'Sam' }, body: doc(para()), created: '2026-09-27T10:00:00.000+0000' },
    ] },
    attachment: [{ filename: 'cart-merge-flow.png', content: 'https://you.atlassian.net/rest/api/3/attachment/content/1' }],
    issuelinks: [
      { type: { inward: 'is blocked by', outward: 'blocks' }, outwardIssue: { key: 'SHOP-160', fields: { summary: 'Cart badge' } } },
      { type: { inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'PAY-7', fields: { summary: 'Cart API' } } },
    ],
  },
};

test('a Jira issue becomes a ticket: rich text flattened, acceptance criteria split out', () => {
  const t = fromJira(ISSUE, 'https://you.atlassian.net/');
  assert.equal(t.key, 'SHOP-155');
  assert.equal(t.source, 'jira');
  assert.equal(t.project, 'SHOP');
  assert.equal(t.projectName, 'Storefront');
  assert.equal(t.description, 'Guests lose their cart when they close the tab.\nKeep it for 30 days.\nDesign: https://figma.com/x');
  assert.deepEqual(t.acceptance, ['The cart survives closing the tab', 'It merges on sign-in']);
  assert.deepEqual(t.comments.map((c) => `${c.author}: ${c.body}`), ['Priya: Keep the 30 days @Sam'], 'an empty comment is dropped');
  assert.deepEqual(t.attachments, [{ name: 'cart-merge-flow.png', url: 'https://you.atlassian.net/rest/api/3/attachment/content/1' }]);
  assert.deepEqual(t.links, [{ key: 'SHOP-160', title: 'Cart badge', relation: 'blocks' }, { key: 'PAY-7', title: 'Cart API', relation: 'is blocked by' }]);
  assert.equal(t.status, 'In Progress');
  assert.equal(t.done, false);
  assert.equal(t.url, 'https://you.atlassian.net/browse/SHOP-155');
  assert.equal(fromJira({ key: 'X-1', fields: { status: { statusCategory: { key: 'done' } } } }).done, true);
});

test('acceptance criteria from a bold line, from plain text, or none at all', () => {
  const bold = doc(para(text('Intro')), para({ type: 'text', text: 'Done when:', marks: [{ type: 'strong' }] }), { type: 'orderedList', content: [item('A'), item('B')] }, para(text('After')));
  assert.deepEqual(splitAcceptance(bold), { description: 'Intro\nAfter', acceptance: ['A', 'B'] });
  assert.deepEqual(splitAcceptance('Fix it.\n\n## Acceptance criteria\n- One\n* Two\n\nNotes after'), { description: 'Fix it.\n\nNotes after', acceptance: ['One', 'Two'] });
  assert.deepEqual(splitAcceptance('Nothing special'), { description: 'Nothing special', acceptance: [] });
  assert.equal(adfText(doc({ type: 'bulletList', content: [{ type: 'listItem', content: [para(text('outer')), { type: 'bulletList', content: [item('inner')] }] }] })), '- outer\n- inner');
});

const BOARD = { id: 'b1', name: 'Web board', lists: [{ id: 'l1', name: 'Doing' }, { id: 'l2', name: 'Done' }] };

test('a Trello card becomes a ticket: board prefix, checklist as acceptance criteria, list as status', () => {
  const t = fromTrello({
    id: 'c1', idShort: 12, name: 'Footer links 404', desc: 'Three links point to old paths. ', idList: 'l1', shortUrl: 'https://trello.com/c/abc',
    dateLastActivity: '2026-09-28T10:00:00.000Z',
    checklists: [{ name: 'Todo', checkItems: [{ name: 'x' }] }, { name: 'Acceptance criteria', checkItems: [{ name: 'Second', pos: 2 }, { name: 'First', pos: 1 }] }],
    attachments: [{ name: 'shot.png', url: 'https://trello.com/1' }],
    actions: [{ type: 'commentCard', date: '2026-09-28T11:00:00Z', memberCreator: { fullName: 'Dana' }, data: { text: 'Later' } }, { type: 'commentCard', date: '2026-09-28T09:00:00Z', memberCreator: { fullName: 'Sam' }, data: { text: 'Earlier' } }],
  }, BOARD);
  assert.equal(t.key, 'WB-12');
  assert.equal(t.source, 'trello');
  assert.equal(t.project, 'b1');
  assert.equal(t.description, 'Three links point to old paths.');
  assert.deepEqual(t.acceptance, ['First', 'Second'], 'the named checklist, in its order');
  assert.deepEqual(t.comments.map((c) => c.body), ['Earlier', 'Later']);
  assert.equal(t.status, 'Doing');
  assert.equal(t.done, false);
  assert.equal(fromTrello({ id: 'c2', idShort: 3, name: 'x', idList: 'l2' }, BOARD).done, true, 'in Done');
  assert.equal(fromTrello({ id: 'c3', idShort: 4, name: 'y', closed: true }, BOARD).done, true, 'archived');
  assert.equal(boardPrefix('web'), 'WEB');
  assert.equal(boardPrefix('Storefront board!'), 'SB');
  assert.equal(boardPrefix('—'), 'TR');
});

function fakeStore(): Store {
  const meta = new Map<string, string>();
  return { getMeta: (k: string) => meta.get(k), setMeta: (k: string, v: string) => { meta.set(k, v); } } as unknown as Store;
}

test('the service: demo tickets on request, projects mapped to workspaces, nothing connected by default', async () => {
  let changes = 0;
  const svc = new TicketService(fakeStore(), () => { changes++; }, {});
  await svc.refresh();
  assert.deepEqual(svc.sources(), { jira: { state: 'off' }, trello: { state: 'off' }, demo: false, at: svc.sources().at });
  assert.equal(svc.list(['w1']).length, 0);
  svc.setDemo(true);
  const all = svc.list(['w1']);
  assert.equal(all.length, demoTickets().length);
  assert.ok(all.every((t) => t.demo && t.workspaceId === null), 'unmapped');
  svc.setMapping('SHOP', 'w1');
  assert.deepEqual(svc.list(['w1']).filter((t) => t.workspaceId === 'w1').map((t) => t.key), ['SHOP-155', 'SHOP-160', 'SHOP-98']);
  assert.ok(svc.list([]).every((t) => t.workspaceId === null), 'a deleted workspace maps nothing');
  const shop = svc.projects(['w1']).find((p) => p.id === 'SHOP')!;
  assert.deepEqual(shop, { id: 'SHOP', name: 'Storefront', source: 'jira', count: 3, workspaceId: 'w1' });
  svc.setMapping('SHOP', null);
  assert.equal(svc.get('SHOP-155', ['w1'])!.workspaceId, null);
  assert.ok(changes >= 4);
});

test('a source that fails says why, and the others still load', async () => {
  const svc = new TicketService(fakeStore(), () => {}, { CC_CONTROL_JIRA_SITE: 'http://127.0.0.1:9', CC_CONTROL_JIRA_EMAIL: 'a@b.c', CC_CONTROL_JIRA_TOKEN: 't' });
  svc.setDemo(true);
  await svc.refresh();
  assert.equal(svc.sources().jira.state, 'error');
  assert.equal(svc.list([]).length, demoTickets().length);
});
