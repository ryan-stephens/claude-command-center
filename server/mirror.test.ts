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
