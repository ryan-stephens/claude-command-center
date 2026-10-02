import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PROMPTS, fillers, placeholdersIn, promptsFor, renderPrompt, unrenderPrompt, type SavedPrompt } from './prompts.ts';

const ctx = {
  ticket: { key: 'SHOP-155', title: 'Add a size guide to product pages' },
  tickets: [{ key: 'SHOP-155', title: 'Add a size guide to product pages' }, { key: 'SHOP-160', title: 'Size chart data' }],
  repos: ['web-app', 'payments-api'],
  home: 'web-app',
  folders: ['D:\\specs\\sizing'],
  lane: 'Shop',
  branch: 'shop-155-add-a-size-guide',
  kind: 'Develop',
};

test('every placeholder fills from the card; lists read inline', () => {
  const f = fillers(ctx);
  assert.equal(f.ticket, 'SHOP-155 (Add a size guide to product pages)');
  assert.equal(f.tickets, 'SHOP-155 (Add a size guide to product pages), SHOP-160 (Size chart data)');
  assert.equal(f.repos, 'web-app, payments-api');
  assert.equal(f.folders, 'D:\\specs\\sizing');
  assert.equal(f.branch, 'shop-155-add-a-size-guide');
  const r = renderPrompt('Review {{ticket}} in {{repos}}, starting in {{home}}, on {{branch}} ({{kind}}, lane {{lane}}).', ctx);
  assert.equal(r.text, 'Review SHOP-155 (Add a size guide to product pages) in web-app, payments-api, starting in web-app, on shop-155-add-a-size-guide (Develop, lane Shop).');
  assert.deepEqual(r.missing, []);
});

test('spacing and case in the braces are forgiven; a ticket without a title is its key', () => {
  assert.equal(renderPrompt('{{ Ticket }} and {{TICKETS}}', { ticket: { key: 'SHOP-1', title: '  ' } }).text, 'SHOP-1 and SHOP-1');
  assert.deepEqual(placeholdersIn('{{repos}} {{ repos }} {{Home}} {{nope}}'), ['repos', 'home', 'nope']);
});

test('an empty placeholder renders to nothing and is named; a line with nothing filled is left out', () => {
  const r = renderPrompt(DEFAULT_PROMPTS[0].body, { ticket: ctx.ticket, repos: ['web-app'], home: 'web-app', branch: 'b' });
  assert.ok(!/folders|business logic/i.test(r.text), `the folders line is gone: ${r.text}`);
  assert.match(r.text, /^Please review SHOP-155 \(Add a size guide to product pages\) and take them into context\.\n/);
  assert.match(r.text, /these repos: web-app\. Start in web-app\./);
  assert.deepEqual(r.missing, ['folders']);
  const bare = renderPrompt('Work on {{ticket}} in {{repos}}.', {});
  assert.equal(bare.text, '');
  assert.deepEqual(bare.missing, ['ticket', 'repos']);
});

test('an unknown name renders to nothing and is reported', () => {
  const r = renderPrompt('Hello {{name}}, review {{ticket}}.', { ticket: { key: 'SHOP-2', title: 'x' } });
  assert.equal(r.text, 'Hello, review SHOP-2 (x).');
  assert.deepEqual(r.unknown, ['name']);
});

test('the leftovers of a removed placeholder are tidied: doubled spaces, a space before punctuation, empty brackets', () => {
  const r = renderPrompt('Need {{repos}} ( {{folders}} ) , then {{home}} .', { repos: ['a'], home: 'h' });
  assert.equal(r.text, 'Need a, then h.');
});

test('prompts for a kind come first, then the ones for any kind, then the rest, each by name', () => {
  const p = (name: string, kind?: SavedPrompt['kind']): SavedPrompt => ({ id: name, name, body: '', updatedAt: 0, ...(kind ? { kind } : {}) });
  const list = [p('Zed'), p('QA this change', 'qa'), p('Review and plan', 'build'), p('Alpha'), p('Fix a bug', 'build')];
  assert.deepEqual(promptsFor(list, 'build').map((x) => x.name), ['Fix a bug', 'Review and plan', 'Alpha', 'Zed', 'QA this change']);
  assert.deepEqual(promptsFor(list, 'qa').map((x) => x.name), ['QA this change', 'Alpha', 'Zed', 'Fix a bug', 'Review and plan']);
});

test('an edited message saved as a prompt gets its filled values back as placeholders, longest first', () => {
  const r = renderPrompt('Review {{tickets}} in {{repos}}; start in {{home}} on {{branch}}.', ctx).text;
  const back = unrenderPrompt(`${r} Also check the cart.`, ctx);
  assert.equal(back, 'Review {{tickets}} in {{repos}}; start in {{home}} on {{branch}}. Also check the cart.');
  // One repo: the list and the home repo are the same text, so the list wins (it was tried first).
  const one = { ...ctx, repos: ['web-app'] };
  assert.equal(unrenderPrompt('Use web-app.', one), 'Use {{repos}}.');
  // One ticket likewise: the list placeholder, which grows with related tickets on the next card.
  assert.equal(unrenderPrompt('QA SHOP-155 (Add a size guide to product pages).', { ticket: ctx.ticket }), 'QA {{tickets}}.');
  assert.equal(unrenderPrompt('Nothing here.', {}), 'Nothing here.');
});

test('the defaults use only known placeholders and say the worktree is already made', () => {
  for (const d of DEFAULT_PROMPTS) {
    const r = renderPrompt(d.body, ctx);
    assert.deepEqual(r.unknown, [], d.name);
    assert.deepEqual(r.missing, [], d.name);
    assert.match(d.body, /worktree/i, d.name);
    assert.match(r.text, /SHOP-155/, d.name);
  }
});
