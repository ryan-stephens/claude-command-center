import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
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
