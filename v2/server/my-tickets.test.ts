import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MyTickets } from './my-tickets.ts';

const env = { CC_CONTROL_JIRA_SITE: 'https://jira.example.invalid', CC_CONTROL_JIRA_TOKEN: 't', CC_CONTROL_JIRA_KIND: 'server' };
const issue = (key: string, status: string, done = false) => ({ key, fields: { summary: `Title ${key}`, status: { name: status, statusCategory: { key: done ? 'done' : 'indeterminate' } }, project: { key: key.split('-')[0] }, updated: '2026-10-01T10:00:00.000Z' } });

function fakeJira(answer: (jql: string) => unknown[]): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const jql = (JSON.parse(String(init.body)) as { jql: string }).jql;
    asked.push(jql);
    return new Response(JSON.stringify({ issues: answer(jql) }), { status: 200 });
  }) as typeof fetch;
  return asked;
}

test('your tickets: assigned to you and not done, Ready for PO and Prod left out, asked once a minute', async () => {
  const real = globalThis.fetch;
  try {
    const asked = fakeJira(() => [issue('SHOP-1', 'In Progress'), issue('SHOP-2', 'Ready for PO'), issue('SHOP-3', 'To Do'), issue('SHOP-4', 'Ready for Prod')]);
    const m = new MyTickets(env);
    const r = await m.picks('');
    assert.equal(r.source, 'jira');
    assert.deepEqual(r.mine.map((t) => t.key), ['SHOP-1', 'SHOP-3']);
    assert.match(asked[0], /assignee = currentUser\(\) AND statusCategory != Done/);
    await m.picks('');
    assert.equal(asked.length, 1);
    await m.picks('', true);
    assert.equal(asked.length, 2);
  } finally { globalThis.fetch = real; }
});

test('a search adds what Jira finds that isn’t yours already; a missing key is no problem', async () => {
  const real = globalThis.fetch;
  try {
    fakeJira((jql) => (jql.startsWith('assignee') ? [issue('SHOP-1', 'In Progress')] : jql.startsWith('text') ? [issue('SHOP-1', 'In Progress'), issue('PAY-9', 'In Review')] : []));
    const m = new MyTickets(env);
    const r = await m.picks('cart badge');
    assert.deepEqual(r.found.map((t) => [t.key, t.mine]), [['PAY-9', false]]);
    globalThis.fetch = (async () => new Response('', { status: 400, statusText: 'Bad Request' })) as unknown as typeof fetch;
    assert.equal((await m.picks('NOPE-1')).problem, undefined);
  } finally { globalThis.fetch = real; }
});

test('without Jira: the demo set, your open ones only', async () => {
  const r = await new MyTickets({}).picks('');
  assert.equal(r.source, 'demo');
  assert.ok(r.mine.some((t) => t.key === 'SHOP-160'));
  assert.ok(!r.mine.some((t) => t.key === 'PAY-71' || t.key === 'SHOP-98' || t.key === 'SHOP-149'));
});
