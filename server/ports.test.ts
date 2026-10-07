import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { parsePortList, parseRange, PortPool } from './ports.ts';

test('the range comes from CC_CONTROL_PORTS, with a sane default', () => {
  assert.deepEqual(parseRange(undefined), [18000, 18999]);
  assert.deepEqual(parseRange('20000-20100'), [20000, 20100]);
  assert.deepEqual(parseRange('80-90'), [18000, 18999], 'below 1024: the default');
  assert.deepEqual(parseRange('20000-20005'), [18000, 18999], 'too narrow: the default');
  assert.deepEqual(parseRange('nope'), [18000, 18999]);
});

test('ports are handed out once each, skipping what is held or already listening, and given back', async () => {
  const busy = createServer().listen(18701, '127.0.0.1');
  await new Promise((r) => busy.once('listening', r));
  try {
    const pool = new PortPool([18700, 18712]);
    const a = await pool.take(2);
    assert.deepEqual(a, [18700, 18702], '18701 is in use by something else');
    const b = await pool.take(1);
    assert.deepEqual(b, [18703], 'held ones are skipped');
    assert.deepEqual(pool.taken(), [18700, 18702, 18703]);
    pool.free(a);
    assert.deepEqual(await pool.take(1), [18700], 'given back, taken again');
    await assert.rejects(pool.take(20), /No free port left in 18700-18712/);
    assert.deepEqual(pool.taken(), [18700, 18703], 'a failed take holds nothing');
  } finally {
    busy.close();
  }
});

test('the UI’s sign-in ports come from CC_CONTROL_UI_PORTS: a list, ranges, each once (§122)', () => {
  assert.deepEqual(parsePortList(undefined), []);
  assert.deepEqual(parsePortList('4202, 4203-4204;4209 4202'), [4202, 4203, 4204, 4209]);
  assert.deepEqual(parsePortList('80,nope,70000,4300'), [4300], 'not a port: left out');
  assert.equal(parsePortList('5000-9000').length, 50, 'a range adds at most 50');
});

test('a UI keeps its own port while it is free, then takes a listed one, skipping one in use (§122)', async () => {
  const busy = createServer().listen(18741, '127.0.0.1');
  await new Promise((r) => busy.once('listening', r));
  try {
    const pool = new PortPool([18750, 18759], [18741, 18742]);
    assert.deepEqual(await pool.takeUi(18740, 'A'), { port: 18740, from: 'home' });
    const b = await pool.takeUi(18740, 'B');
    assert.equal(b.port, 18742, '18741 is in use by something else');
    assert.match(b.note!, /own port, 18740, is in use by A, so it runs on 18742 from CC_CONTROL_UI_PORTS/);
    await assert.rejects(pool.takeUi(18740, 'C'), /No sign-in port free for the UI: 18740 \(A\), 18741 \(something else on this machine\), 18742 \(B\)\./);
    pool.free([18740]);
    assert.equal((await pool.takeUi(18740, 'C')).port, 18740, 'given back, its own again');
    // No list: the range, with a note; no own port known: the range with nothing to say.
    const plain = new PortPool([18750, 18759]);
    assert.deepEqual(await plain.takeUi(undefined, 'D'), { port: 18750, from: 'range' });
    const e = await plain.takeUi(18741, 'E');
    assert.equal(e.from, 'range');
    assert.match(e.note!, /own port, 18741, is in use by something else on this machine, so it runs on 18751\. If the app signs in/);
  } finally {
    busy.close();
  }
});

test('two UIs at once never get the same port (§122)', async () => {
  const pool = new PortPool([18760, 18769], [18771, 18772, 18773]);
  const got = await Promise.all(Array.from({ length: 4 }, (_, i) => pool.takeUi(18770, `C${i}`)));
  assert.deepEqual(got.map((g) => g.port).sort(), [18770, 18771, 18772, 18773]);
});

test('two takes at once never get the same port (§114)', async () => {
  const pool = new PortPool([18720, 18739]);
  const got = await Promise.all(Array.from({ length: 6 }, () => pool.take(2)));
  const all = got.flat();
  assert.equal(new Set(all).size, all.length, all.join(' '));
});
