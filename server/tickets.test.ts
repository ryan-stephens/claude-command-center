import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import type { Store } from './store.ts';
import { adfText, boardPrefix, demoTickets, fetchJira, fromJira, fromTrello, jiraConfig, jiraSearch, splitAcceptance, TicketService } from './tickets.ts';

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

test('Jira Cloud or Data Center, from the site; the request each needs', () => {
  assert.equal(jiraConfig({ CC_CONTROL_JIRA_SITE: 'https://acme.atlassian.net', CC_CONTROL_JIRA_TOKEN: 't' }), undefined, 'Cloud needs the email');
  const cloud = jiraConfig({ CC_CONTROL_JIRA_SITE: 'https://acme.atlassian.net/', CC_CONTROL_JIRA_EMAIL: 'me@acme.com', CC_CONTROL_JIRA_TOKEN: 't' })!;
  assert.equal(cloud.kind, 'cloud');
  const c = jiraSearch(cloud);
  assert.equal(c.url, 'https://acme.atlassian.net/rest/api/3/search/jql');
  assert.equal((c.init.headers as Record<string, string>).Authorization, `Basic ${Buffer.from('me@acme.com:t').toString('base64')}`);
  const dc = jiraConfig({ CC_CONTROL_JIRA_SITE: 'https://jira.vu.local/jira', CC_CONTROL_JIRA_TOKEN: 'pat', CC_CONTROL_JIRA_AC_FIELD: 'customfield_10500' })!;
  assert.equal(dc.kind, 'server');
  const s = jiraSearch(dc);
  assert.equal(s.url, 'https://jira.vu.local/jira/rest/api/2/search', 'the context path is kept');
  assert.equal((s.init.headers as Record<string, string>).Authorization, 'Bearer pat', 'a personal access token');
  assert.ok((JSON.parse(String(s.init.body)).fields as string[]).includes('customfield_10500'));
  const basic = jiraSearch(jiraConfig({ CC_CONTROL_JIRA_SITE: 'https://jira.vu.local', CC_CONTROL_JIRA_EMAIL: 'rstephens', CC_CONTROL_JIRA_TOKEN: 'pw' })!);
  assert.match((basic.init.headers as Record<string, string>).Authorization, /^Basic /, 'username and password');
  assert.equal(jiraConfig({ CC_CONTROL_JIRA_SITE: 'https://jira.example.com', CC_CONTROL_JIRA_TOKEN: 't', CC_CONTROL_JIRA_EMAIL: 'a@b', CC_CONTROL_JIRA_KIND: 'cloud' })!.kind, 'cloud', 'the kind can be said outright');
});

test('Data Center descriptions are wiki markup: headings, bold lines and # lists', () => {
  assert.deepEqual(splitAcceptance('Guests lose the cart.\n\nh3. Acceptance Criteria\n# Survives closing the tab\n# Merges on sign-in\n\nh3. Notes\nSee PAY-9.'),
    { description: 'Guests lose the cart.\n\nh3. Notes\nSee PAY-9.', acceptance: ['Survives closing the tab', 'Merges on sign-in'] });
  assert.deepEqual(splitAcceptance('Fix it.\n*Acceptance criteria:*\n* One\n** Nested'), { description: 'Fix it.', acceptance: ['One', 'Nested'] });
});

test('acceptance criteria from their own field win over the description', () => {
  const issue = { key: 'WS-7', fields: { summary: 'Proxy to Okteto', description: 'Point the UI at the backend.\n\nh3. Acceptance Criteria\n# not this', customfield_10500: '* Calls go to the Okteto URL\n* Local mode still works' } };
  const t = fromJira(issue, 'https://jira.vu.local', 'customfield_10500');
  assert.deepEqual(t.acceptance, ['Calls go to the Okteto URL', 'Local mode still works']);
  assert.equal(t.url, 'https://jira.vu.local/browse/WS-7');
});

test('a real request to a Data Center-shaped server: Bearer token, v2 search, wiki markup; and what a 401 means', async () => {
  let seen: { url?: string; auth?: string; body?: string } = {};
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen = { url: req.url, auth: req.headers.authorization, body };
      if (req.headers.authorization !== 'Bearer good') { res.statusCode = 401; res.statusMessage = 'Unauthorized'; res.end(); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ total: 1, issues: [{ key: 'WS-12', fields: {
        summary: 'Workspaces UI talks to Okteto', description: 'The UI should proxy /api.\n\nh3. Acceptance Criteria\n# /api goes to the Okteto namespace',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, project: { key: 'WS', name: 'Workspaces' }, updated: '2026-09-30T10:00:00.000-0500',
        comment: { comments: [{ author: { displayName: 'Pat' }, body: 'Use *okteto up* first', created: '2026-09-30T09:00:00.000-0500' }] },
      } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const site = `http://127.0.0.1:${(server.address() as { port: number }).port}/jira`;
  try {
    const tickets = await fetchJira(jiraConfig({ CC_CONTROL_JIRA_SITE: site, CC_CONTROL_JIRA_TOKEN: 'good' })!);
    assert.equal(seen.url, '/jira/rest/api/2/search');
    assert.equal(seen.auth, 'Bearer good');
    assert.equal(JSON.parse(seen.body!).jql, 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC');
    assert.equal(tickets.length, 1);
    assert.deepEqual([tickets[0].key, tickets[0].project, tickets[0].status, tickets[0].done], ['WS-12', 'WS', 'In Progress', false]);
    assert.deepEqual(tickets[0].acceptance, ['/api goes to the Okteto namespace']);
    assert.equal(tickets[0].comments[0].body, 'Use *okteto up* first');
    await assert.rejects(fetchJira(jiraConfig({ CC_CONTROL_JIRA_SITE: site, CC_CONTROL_JIRA_TOKEN: 'bad' })!), /Jira said 401 Unauthorized: check the personal access token/);
    await assert.rejects(fetchJira(jiraConfig({ CC_CONTROL_JIRA_SITE: 'https://127.0.0.1:1', CC_CONTROL_JIRA_TOKEN: 'x' })!), /Couldn't reach Jira at https:\/\/127\.0\.0\.1:1/);
  } finally {
    server.close();
  }
});
