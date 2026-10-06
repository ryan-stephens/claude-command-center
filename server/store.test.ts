import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { Card } from '../shared/cards.ts';
import { DEFAULT_PROMPTS } from '../shared/prompts.ts';
import { Store } from './store.ts';

const dir = mkdtempSync(join(tmpdir(), 'cc-store-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('a new store starts with the three default prompts, written once', () => {
  const path = join(dir, 'prompts.db');
  const store = new Store(path);
  const first = store.loadPrompts();
  assert.deepEqual(first.map((p) => p.name), DEFAULT_PROMPTS.map((p) => p.name));
  assert.deepEqual(first.map((p) => p.kind), ['build', 'build', 'qa']);
  assert.ok(first.every((p) => /^[0-9a-f-]{36}$/.test(p.id) && p.updatedAt > 0 && p.body.includes('{{')));
  // Edit one and delete another: reopening the same file keeps that, and seeds nothing again.
  store.savePrompt({ ...first[0], body: 'Changed.', updatedAt: 5 });
  store.deletePrompt(first[2].id);
  store.close();
  const again = new Store(path);
  const second = again.loadPrompts();
  assert.deepEqual(second.map((p) => p.name), [first[0].name, first[1].name]);
  assert.equal(second[0].body, 'Changed.');
  assert.equal(second[0].updatedAt, 5);
  again.close();
});

test('a default prompt seeded before §69 gets its blank lines once; an edited one is left alone', () => {
  const path = join(dir, 'prompts-spacing.db');
  const store = new Store(path);
  const [review, bug] = store.loadPrompts();
  // As the first seeding wrote them: the same words, one line per part.
  store.savePrompt({ ...review, body: review.body.replace(/\n\n/g, '\n') });
  store.savePrompt({ ...bug, body: 'My own words.' });
  store.setMeta('prompts.spaced', ''); // as a store from before §69 has it: unset
  store.close();
  const again = new Store(path);
  const [review2, bug2] = again.loadPrompts();
  assert.equal(review2.body, DEFAULT_PROMPTS[0].body, 'the default wording is respaced');
  assert.equal(bug2.body, 'My own words.');
  assert.ok(again.getMeta('prompts.spaced'));
  again.close();
});

test('a saved prompt keeps its place; a new one goes to the end', () => {
  const store = new Store(join(dir, 'order.db'));
  const [a, b, c] = store.loadPrompts();
  store.savePrompt({ ...b, name: 'B2', updatedAt: 1 });
  store.savePrompt({ id: 'new-1', name: 'Mine', body: 'Hi {{ticket}}', updatedAt: 2 });
  assert.deepEqual(store.loadPrompts().map((p) => p.name), [a.name, 'B2', c.name, 'Mine']);
  assert.equal(store.loadPrompts()[3].kind, undefined, 'no kind: offered for every card');
  store.close();
});

test('cards are kept in memory and written through: copies out, saves and deletes seen at once, all of it in SQLite (§97)', () => {
  const path = join(dir, 'cards.db');
  const s = new Store(path);
  const card = (id: string, createdAt: number, title: string) => ({ id, key: `CARD-${id}`, title, createdAt, stage: 'build', boot: [] } as unknown as Card);
  s.saveCard(card('b', 2, 'B'));
  s.saveCard(card('a', 1, 'A'));
  assert.deepEqual(s.loadCards().map((c) => c.id), ['a', 'b']); // oldest first
  s.saveCard(card('c', 3, 'C'));
  s.saveCard(card('a0', 0, 'A0'));
  assert.deepEqual(s.loadCards().map((c) => c.id), ['a0', 'a', 'b', 'c']);
  // A copy: changing what came out changes nothing until it is saved.
  const got = s.loadCard('b')!;
  got.title = 'changed';
  assert.equal(s.loadCard('b')!.title, 'B');
  s.saveCard(got);
  assert.equal(s.loadCards().find((c) => c.id === 'b')!.title, 'changed');
  // What was saved is a stored copy: changing the object afterwards doesn't leak in.
  got.title = 'later';
  assert.equal(s.loadCard('b')!.title, 'changed');
  s.deleteCard('a');
  assert.equal(s.loadCard('a'), undefined);
  assert.deepEqual(s.loadCards().map((c) => c.id), ['a0', 'b', 'c']);
  // SQLite has the same: a second store on the file reads it back.
  const again = new Store(path);
  assert.deepEqual(again.loadCards().map((c) => [c.id, c.title]), [['a0', 'A0'], ['b', 'changed'], ['c', 'C']]);
  again.close();
  s.close();
});
