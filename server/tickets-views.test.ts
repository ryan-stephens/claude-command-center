import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { inbox } from '../shared/tickets.ts';
import type { Store } from './store.ts';
import { fromJira, personIn, pickQaField, qaJql, searchJql, TicketService } from './tickets.ts';
import { qaLine, ticketSub } from '../shared/tickets.ts';

function fakeStore(): Store {
  const meta = new Map<string, string>();
  return { getMeta: (k: string) => meta.get(k), setMeta: (k: string, v: string) => { meta.set(k, v); } } as unknown as Store;
}

const issue = (key: string, status: string, assignee: string, qa?: string) => ({
  key, fields: {
    summary: `${key} title`, status: { name: status, statusCategory: { key: 'indeterminate' } }, project: { key: 'WSS', name: 'Workspaces' }, assignee: { displayName: assignee }, updated: '2026-09-28T10:00:00.000+0000',
    customfield_10077: qa ? { displayName: qa, accountId: 'x' } : null,
  },
});

test('the QA view: that status in the projects your tickets come from, a setting of its own, or off', () => {
  assert.equal(qaJql({}, ['WSS', 'WSS', 'demo-trello-board']), 'status = "Ready for QA" AND project in ("WSS") ORDER BY updated DESC');
  assert.equal(qaJql({}, []), undefined, 'no project to look in yet');
  assert.equal(qaJql({ qaJql: 'project = X AND status = "In QA"' }, ['WSS']), 'project = X AND status = "In QA"');
  assert.equal(qaJql({ qaJql: 'off' }, ['WSS']), undefined);
});

test('the search box in JQL: a key finds that ticket, words search open tickets, quotes can’t break out', () => {
  assert.equal(searchJql('wss-12'), 'key = "WSS-12"');
  assert.equal(searchJql('refund email'), 'text ~ "refund email" AND statusCategory != Done ORDER BY updated DESC');
  assert.equal(searchJql('say "hi" \\ there'), 'text ~ "say hi there" AND statusCategory != Done ORDER BY updated DESC');
  assert.equal(searchJql('a'), undefined);
});

test('Jira: your tickets and the ones ready for QA come in as two views; search finds anyone’s, and a card can start from it', async () => {
  const asked: string[] = [];
  const askedFields: string[][] = [];
  let fieldLookups = 0;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const json = (code: number, body: unknown) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
      if (req.method === 'GET' && req.url === '/rest/api/3/field') {
        fieldLookups++;
        json(200, [{ id: 'summary', name: 'Summary', custom: false }, { id: 'customfield_10050', name: 'QA Notes', custom: true, schema: { type: 'string' } }, { id: 'customfield_10077', name: 'QA Reviewer', custom: true, schema: { type: 'user' } }]);
        return;
      }
      const { jql, fields } = JSON.parse(raw) as { jql: string; fields: string[] };
      asked.push(jql);
      askedFields.push(fields);
      if (jql.startsWith('assignee = currentUser()')) json(200, { issues: [issue('WSS-1', 'In Progress', 'Me')] });
      else if (jql.includes('Ready for QA')) json(200, { issues: [issue('WSS-2', 'Ready for QA', 'Priya', 'Sam'), issue('WSS-1', 'In Progress', 'Me')] });
      else if (jql === 'key = "WSS-9"') json(200, { issues: [issue('WSS-9', 'In Progress', 'Sam')] });
      else if (jql === 'key = "WSS-1"') json(200, { issues: [issue('WSS-1', 'In Progress', 'Me')] });
      else if (jql === 'key = "WSS-404"') json(400, { errorMessages: ['An issue with key WSS-404 does not exist'] });
      else json(200, { issues: [] });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    const svc = new TicketService(fakeStore(), () => {}, { CC_CONTROL_JIRA_SITE: `http://127.0.0.1:${port}`, CC_CONTROL_JIRA_KIND: 'cloud', CC_CONTROL_JIRA_EMAIL: 'a@b.c', CC_CONTROL_JIRA_TOKEN: 't' });
    await svc.refresh();
    assert.match(asked[1], /status = "Ready for QA" AND project in \("WSS"\)/);
    const all = svc.list([]);
    assert.deepEqual(all.map((t) => [t.key, t.views]), [['WSS-1', ['mine', 'qa']], ['WSS-2', ['qa']]]);
    assert.equal(all[1].assignee, 'Priya');
    assert.equal(all[1].qaReviewer, 'Sam', 'the QA reviewer, from the field found by name');
    assert.equal(all[0].qaReviewer, null, 'the field is there but empty');
    assert.ok(askedFields.every((f) => f.includes('customfield_10077')), 'every search asks for it');
    assert.equal(ticketSub(all[1]), 'Jira · Workspaces · Ready for QA · Priya · QA Sam');
    await svc.refresh();
    assert.equal(fieldLookups, 1, 'the field is looked up once');
    assert.deepEqual(inbox(all, new Set(), 'all').map((t) => t.key), ['WSS-1']);
    assert.deepEqual(inbox(all, new Set(), 'all', 'qa').map((t) => t.key), ['WSS-1', 'WSS-2']);

    const r = await svc.search('wss-9', []);
    assert.deepEqual(r.tickets.map((t) => [t.key, t.found]), [['WSS-9', true]]);
    assert.equal(svc.get('WSS-9', [])!.title, 'WSS-9 title', 'a found ticket can start a card');
    assert.equal(svc.list([]).some((t) => t.key === 'WSS-9'), false, 'but it doesn’t join the Inbox');
    assert.deepEqual(await svc.search('WSS-404', []), { tickets: [] }, 'a key that doesn’t exist is nothing found, not a failure');
    const mine = await svc.search('WSS-1', []);
    assert.equal(mine.tickets[0].found, undefined, 'a ticket already fetched comes back as it is');
  } finally {
    server.close();
  }
});

test('search without Jira: the demo set (other people’s tickets too) when it is on, otherwise it says what to set', async () => {
  const svc = new TicketService(fakeStore(), () => {}, {});
  assert.match((await svc.search('wishlist', [])).problem!, /CC_CONTROL_JIRA_SITE/);
  svc.setDemo(true);
  const r = await svc.search('wishlist', []);
  assert.deepEqual(r.tickets.map((t) => [t.key, t.assignee, t.found]), [['SHOP-162', 'Sam', true]]);
  assert.equal(r.problem, undefined);
  assert.deepEqual(inbox(svc.list([]), new Set(), 'all', 'qa').map((t) => t.key), ['SHOP-149', 'PAY-84']);
});

test('the QA reviewer: a custom field named like one (user fields first), whatever shape its value takes', () => {
  assert.equal(pickQaField([{ id: 'customfield_1', name: 'QA Notes', custom: true }, { id: 'customfield_2', name: 'QA Reviewer', custom: true, schema: { type: 'string' } }, { id: 'customfield_3', name: 'qa assignee', custom: true, schema: { type: 'user' } }]), 'customfield_3');
  assert.equal(pickQaField([{ id: 'customfield_4', name: 'Tester', custom: true, schema: { type: 'array', items: 'user' } }]), 'customfield_4');
  assert.equal(pickQaField([{ id: 'assignee', name: 'Assignee', custom: false }, { id: 'customfield_5', name: 'QA environment', custom: true }]), undefined);
  assert.equal(personIn({ displayName: 'Sam Lee' }), 'Sam Lee');
  assert.equal(personIn([{ displayName: 'Ana' }, { displayName: 'Bo' }]), 'Ana', 'one reviewer: the first');
  assert.equal(personIn({ value: 'Team QA' }), 'Team QA');
  assert.equal(personIn('sam.lee'), 'sam.lee');
  assert.equal(personIn(null), null);
  assert.equal(personIn([]), null);
  const t = fromJira({ key: 'WSS-3', fields: { summary: 's', customfield_9: { name: 'jdoe' } } as never }, undefined, undefined, 'customfield_9');
  assert.equal(t.qaReviewer, 'jdoe', 'Data Center users have a name');
  assert.equal(fromJira({ key: 'WSS-4', fields: { summary: 's' } }).qaReviewer, undefined, 'no field: nothing said');
  assert.equal(qaLine({ qaReviewer: null }), 'no QA reviewer yet');
});

test('CC_CONTROL_JIRA_QA_FIELD names the field (no lookup), or off hides it', async () => {
  let lookups = 0;
  const seen: string[][] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET') { lookups++; res.end('[]'); return; }
      seen.push((JSON.parse(raw) as { fields: string[] }).fields);
      res.end(JSON.stringify({ issues: [] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const env = { CC_CONTROL_JIRA_SITE: `http://127.0.0.1:${port}`, CC_CONTROL_JIRA_KIND: 'cloud', CC_CONTROL_JIRA_EMAIL: 'a@b.c', CC_CONTROL_JIRA_TOKEN: 't' };
  try {
    await new TicketService(fakeStore(), () => {}, { ...env, CC_CONTROL_JIRA_QA_FIELD: 'customfield_42' }).refresh();
    assert.equal(lookups, 0);
    assert.ok(seen[0].includes('customfield_42'));
    seen.length = 0;
    await new TicketService(fakeStore(), () => {}, { ...env, CC_CONTROL_JIRA_QA_FIELD: 'off' }).refresh();
    assert.equal(lookups, 0);
    assert.ok(!seen[0].some((f) => f.startsWith('customfield')));
  } finally {
    server.close();
  }
});
