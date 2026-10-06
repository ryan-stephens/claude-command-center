import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PartialFanout, type PartialMsg } from './partial-stream.ts';

/** A fanout with a hand-cranked clock: `tick()` runs the pending timer. */
function rig() {
  const got: [string, PartialMsg][] = [];
  let pending: (() => void) | null = null;
  const f = new PartialFanout<string>((c, m) => got.push([c, m]), 30, (fn) => { pending = fn; return fn; }, () => { pending = null; });
  const tick = () => { const p = pending; pending = null; p?.(); };
  return { f, got, tick };
}

/** What a page holds after applying its messages, as ws.ts does. */
function apply(msgs: PartialMsg[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of msgs) out[m.id] = m.from === undefined ? m.text : (out[m.id] ?? '').slice(0, m.from) + m.text;
  return out;
}

test('only the page showing a session gets its reply, the first token at once and the rest as deltas per window', () => {
  const { f, got, tick } = rig();
  f.watch('page', 's1');
  f.watch('other', 's2');
  got.length = 0; // each watch says where the reply is (nothing yet)
  f.update('s1', 'Hel');
  assert.deepEqual(got, [['page', { id: 's1', from: 0, text: 'Hel' }]]);
  f.update('s1', 'Hello');
  f.update('s1', 'Hello wor');
  assert.equal(got.length, 1); // coalesced until the window passes
  tick();
  assert.deepEqual(got[1], ['page', { id: 's1', from: 3, text: 'lo wor' }]);
  tick(); // nothing new: the timer stops
  f.update('s1', 'Hello world');
  assert.deepEqual(got[2], ['page', { id: 's1', from: 9, text: 'ld' }]);
  assert.equal(apply(got.map((g) => g[1])).s1, 'Hello world');
  assert.ok(got.every(([c]) => c === 'page'));
});

test('a clear goes at once and cancels the window; the next message starts from nothing', () => {
  const { f, got, tick } = rig();
  f.watch('page', 's1');
  got.length = 0;
  f.update('s1', 'First message');
  f.update('s1', 'First message, longer');
  f.update('s1', '');
  assert.deepEqual(got.at(-1), ['page', { id: 's1', text: '' }]);
  tick(); // the cancelled window sends nothing
  f.update('s1', 'Second');
  assert.deepEqual(got.at(-1), ['page', { id: 's1', from: 0, text: 'Second' }]);
  assert.equal(apply(got.map((g) => g[1])).s1, 'Second');
});

test('opening a session mid-reply sends all of it so far, then deltas', () => {
  const { f, got, tick } = rig();
  f.update('s1', 'Already half');
  assert.equal(got.length, 0); // nobody watches
  f.watch('page', 's1');
  assert.deepEqual(got, [['page', { id: 's1', text: 'Already half' }]]);
  tick();
  f.update('s1', 'Already half way');
  tick();
  assert.equal(apply(got.map((g) => g[1])).s1, 'Already half way');
});

test('a page that moves to another session stops getting the first; a forget stops everything', () => {
  const { f, got, tick } = rig();
  f.watch('page', 's1');
  f.update('s1', 'a');
  f.watch('page', 's2');
  tick();
  f.update('s1', 'ab');
  tick();
  f.update('s2', 'x');
  assert.deepEqual(got.map((g) => g[1]), [{ id: 's1', text: '' }, { id: 's1', from: 0, text: 'a' }, { id: 's2', text: '' }, { id: 's2', from: 0, text: 'x' }]);
  f.forget('page');
  tick();
  f.update('s2', 'xy');
  assert.equal(got.length, 4);
});

test('back on a session whose message landed while the page looked elsewhere: its old partial is cleared', () => {
  const { f, got } = rig();
  f.watch('page', 's1');
  f.update('s1', 'Half a reply');
  f.watch('page', 's2');
  f.update('s1', ''); // it landed; the page wasn't watching
  f.watch('page', 's1');
  assert.equal(apply(got.map((g) => g[1])).s1, '');
});

test('a renamed session (/clear, a fork) keeps its watchers', () => {
  const { f, got } = rig();
  f.watch('page', 'old');
  f.rename('old', 'new');
  f.update('new', 'Fresh');
  assert.deepEqual(got.at(-1), ['page', { id: 'new', from: 0, text: 'Fresh' }]);
});
