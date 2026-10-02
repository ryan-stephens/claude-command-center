import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Typist } from './typist.ts';

test('a message waits for the launcher’s poll, a poll waits for a message, and polls say the tab is alive (§87)', async () => {
  const states: [string, boolean][] = [];
  const t = new Typist((id, on) => states.push([id, on]));
  assert.equal(t.alive('c1'), false);
  // Nothing waits: the poll holds until something arrives.
  const poll = t.poll('c1', 5000);
  assert.deepEqual(states, [['c1', true]], 'the first poll says the tab can be typed into');
  assert.ok(t.alive('c1'));
  await t.send('c1', { kind: 'text', text: 'run the tests' });
  assert.deepEqual(await poll, { kind: 'text', text: 'run the tests' });
  // Something waits: the next poll takes it at once, and the sender's promise resolves then.
  let taken = false;
  const sent = t.send('c1', { kind: 'keys', keys: ['1'] }).then(() => { taken = true; });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(taken, false, 'not taken until a poll comes');
  assert.deepEqual(await t.poll('c1', 10), { kind: 'keys', keys: ['1'] });
  await sent;
  assert.ok(taken);
  // A poll with nothing to take ends empty after its wait.
  assert.equal(await t.poll('c1', 20), null);
  // A message nobody takes is refused after its wait.
  await assert.rejects(t.send('c2', { kind: 'text', text: 'x' }, 30), /isn’t answering/);
  assert.equal(await t.poll('c2', 10), null, 'and is not left in the queue');
  // waitFor: at once when alive, woken by the first poll otherwise.
  await t.waitFor('c1', 10);
  const waited = t.waitFor('c3', 5000);
  void t.poll('c3', 10);
  await waited;
  await assert.rejects(t.waitFor('c4', 20), /nothing in it answered/);
  t.forgetAll();
  assert.deepEqual(states.filter(([, on]) => !on).map(([id]) => id).sort(), ['c1', 'c2', 'c3'], 'every tab that polled is told off at the end');
  assert.equal(t.alive('c1'), false);
  t.stop();
});
