import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mirror, sessionOfFile } from './mirror.ts';

const ID = '0b7c1c2e-6a6e-4c55-9d0f-3f2b1a9c8d7e';
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(owned = false) {
  const sent: [string, string, unknown[]][] = [];
  let reads = 0;
  const m = new Mirror<string>({
    read: async () => { reads++; return [{ n: reads }]; },
    send: (c, id, items) => sent.push([c, id, items]),
    owned: () => owned,
    throttleMs: 80,
  });
  return { m, sent, reads: () => reads };
}

test('a change reaches the clients watching that session, once per burst', async () => {
  const { m, sent, reads } = setup();
  m.watch('a', ID);
  m.watch('b', 'other');
  m.changed(ID);
  m.changed(ID);
  m.changed(ID);
  await tick(20);
  assert.equal(reads(), 1, 'a burst is read once');
  assert.deepEqual(sent.map(([c]) => c), ['a']);
  m.changed(ID);
  await tick(10);
  assert.equal(reads(), 1, 'the next read waits out the throttle');
  await tick(90);
  assert.equal(reads(), 2);
  m.stop();
});

test('nobody watching, or a session this app runs: nothing is read', async () => {
  const idle = setup();
  idle.m.changed(ID);
  await tick(10);
  assert.equal(idle.reads(), 0);
  const own = setup(true);
  own.m.watch('a', ID);
  own.m.changed(ID);
  await tick(10);
  assert.equal(own.reads(), 0);
});

test('a forgotten client stops getting updates', async () => {
  const { m, sent } = setup();
  m.watch('a', ID);
  m.forget('a');
  m.changed(ID);
  await tick(10);
  assert.equal(sent.length, 0);
});

test('only top-level session files count', () => {
  assert.equal(sessionOfFile(`C--repos-web\\${ID}.jsonl`), ID);
  assert.equal(sessionOfFile(`C--repos-web/${ID}.jsonl`), ID);
  assert.equal(sessionOfFile(`C--repos-web\\${ID}\\subagents\\agent-1.jsonl`), null);
  assert.equal(sessionOfFile(`C--repos-web\\notes.jsonl`), null);
});

test('§119: a client gets only what follows what it has; nothing when nothing does; all of it when its copy is no longer the start', async () => {
  let items = [{ uuid: 'a' }, { uuid: 'b' }];
  const sent: [string, unknown[], number | undefined][] = [];
  const m = new Mirror<string>({ read: async () => items, send: (c, _id, it, from) => sent.push([c, it, from]), owned: () => false, throttleMs: 5 });
  m.watch('p', ID);
  m.has('p', ID, items);
  items = [...items, { uuid: 'c' }, { uuid: 'd' }];
  m.changed(ID);
  await tick(30);
  assert.deepEqual(sent.at(-1), ['p', [{ uuid: 'c' }, { uuid: 'd' }], 2], 'only the two new ones, from 2');
  m.changed(ID);
  await tick(30);
  assert.equal(sent.length, 1, 'nothing new: nothing sent');
  items = [{ uuid: 'x' }, { uuid: 'y' }, { uuid: 'z' }, { uuid: 'w' }, { uuid: 'v' }];
  m.changed(ID);
  await tick(30);
  assert.deepEqual(sent.at(-1), ['p', items, undefined], 'the start changed (a /clear, a compaction): all of it');
  m.watch('q', ID);
  items = [...items, { uuid: 'u' }];
  m.changed(ID);
  await tick(30);
  assert.deepEqual(sent.filter(([c]) => c === 'q').at(-1), ['q', items, undefined], 'a client the mirror knows nothing about gets all of it');
  m.stop();
});

test('§119: a slow read spaces the next ones out', async () => {
  let reads = 0;
  const m = new Mirror<string>({ read: async () => { reads++; await tick(30); return []; }, send: () => {}, owned: () => false, throttleMs: 5 });
  m.watch('p', ID);
  m.changed(ID);
  await tick(50);
  assert.equal(reads, 1);
  m.changed(ID);
  await tick(60);
  assert.equal(reads, 1, 'it took 30 ms, so the next waits about 150 ms, not 5');
  await tick(150);
  assert.equal(reads, 2);
  m.stop();
});
