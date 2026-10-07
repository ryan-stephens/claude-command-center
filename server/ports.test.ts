import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { parseRange, PortPool } from './ports.ts';

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

test('two takes at once never get the same port (§114)', async () => {
  const pool = new PortPool([18720, 18739]);
  const got = await Promise.all(Array.from({ length: 6 }, () => pool.take(2)));
  const all = got.flat();
  assert.equal(new Set(all).size, all.length, all.join(' '));
});
