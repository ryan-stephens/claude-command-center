import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeInstructions } from './write-prompt.ts';

test('the instructions hold the notes verbatim and the card’s context as facts, leaving out what it has nothing for', () => {
  const t = writeInstructions('  review the ticket, need the api too  ', {
    ticket: { key: 'SHOP-155', title: 'Save cart' }, repos: ['web-app', 'payments-api'], home: 'web-app', branch: 'shop-155-save-cart', kind: 'Develop',
  });
  assert.match(t, /"""\nreview the ticket, need the api too\n"""/);
  assert.match(t, /- tickets: SHOP-155 \(Save cart\)/);
  assert.match(t, /- repos: web-app, payments-api/);
  assert.match(t, /- home: web-app/);
  assert.match(t, /- branch: shop-155-save-cart/);
  assert.ok(!/- folders/.test(t) && !/- lane/.test(t) && !/- ticket:/.test(t), 'nothing for folders, lane; the single ticket is in tickets');
  assert.match(t, /Write the opening message\.$/);
});

test('with no context at all, it says so', () => {
  assert.match(writeInstructions('fix it', {}), /given no ticket, repos or folders yet/);
});
