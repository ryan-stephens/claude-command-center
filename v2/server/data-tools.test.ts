import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldChange, LookupField, LookupResult } from '../../shared/verify.ts';
import { dataEnv, loanId, parseFieldLines, sameValue } from '../shared/data-tools.ts';
import type { FieldRow } from '../shared/types.ts';
import { lookupFields, updateFields, type Lookup } from './tools.ts';

/** A pretend lookup: an update shows after `lag` reads; CX.RO is read-only; CX.PICK has options. */
function fakeLookup(o: { lag?: number } = {}) {
  const values: Record<string, string> = { 'CX.FEE': '1,250.00', 'CX.RO': 'fixed', 'CX.PICK': 'No', 'CX.NOTE': 'old' };
  let pending: { changes: FieldChange[]; left: number } | undefined;
  const sent: FieldChange[][] = [];
  const asked: { advanced: boolean; session?: boolean }[] = [];
  const read = (ids: string[]): LookupField[] => ids.map((id) => (id in values ? { id, value: values[id], exists: true, ...(id === 'CX.RO' ? { readOnly: true } : {}), ...(id === 'CX.PICK' ? { options: ['Yes', 'No'] } : {}) } : { id, value: '', exists: false }));
  const lookup: Lookup = {
    fetch: async (_env, loan, ids, advanced, opts): Promise<LookupResult> => {
      asked.push({ advanced, ...(opts.session === false ? { session: false } : {}) });
      if (opts.session === false && pending && --pending.left <= 0) { for (const ch of pending.changes) values[ch.id] = ch.clear ? '' : ch.value; pending = undefined; }
      if (loan === 'NOPE') return { env: 'dev', recordId: loan, found: false, fields: [] };
      const updatable = advanced && opts.session !== false;
      return { env: 'dev', recordId: loan, found: true, fields: read(ids), ...(updatable ? { updatable: true, token: 't', editable: ids.filter((i) => i in values && i !== 'CX.RO') } : {}) };
    },
    update: async (_t, changes) => { sent.push(changes); pending = { changes, left: o.lag ?? 2 }; return { sent: changes.length, watchUrl: 'http://lookup.example.invalid/Watch/LN-1' }; },
  };
  let clock = 0;
  return { lookup, sent, asked, opts: { sleep: async (ms: number) => { clock += ms; }, now: () => clock } };
}

test('shared: values alike, field lines, Dev or UAT only, a loan id', () => {
  assert.equal(sameValue('1,250.00', '1250'), true);
  assert.equal(sameValue(' Yes ', 'yes'), true);
  assert.equal(sameValue('12.5', '13'), false);
  assert.deepEqual(parseFieldLines('CX.FEE = 12.50\nGROUP.NAME.ROLE NAME\n# note\nCX.EMPTY =\ncx.fee'), { ids: ['CX.FEE', 'GROUP.NAME.ROLE NAME', 'CX.EMPTY'], values: { 'CX.FEE': '12.50', 'CX.EMPTY': '' } });
  assert.throws(() => dataEnv('prod'), /never Prod/);
  assert.equal(dataEnv('UAT'), 'uat');
  assert.throws(() => loanId('a b;c'), /look like/);
  assert.throws(() => loanId(''), /Name the loan/);
});

test('a lookup: values, missing fields as null, details with read-only, options and what can change, and expectations', async () => {
  const f = fakeLookup();
  const plain = await lookupFields(f.lookup, 'dev', 'LN-1', ['CX.FEE', 'CX.GONE']);
  assert.deepEqual(plain.rows, [{ id: 'CX.FEE', value: '1,250.00' }, { id: 'CX.GONE', value: null }]);
  assert.equal(plain.check, undefined);
  assert.deepEqual(f.asked.at(-1), { advanced: false, session: false });
  const d = await lookupFields(f.lookup, 'dev', 'LN-1', ['CX.RO', 'CX.PICK'], { details: true, updates: true, expect: { 'cx.pick': 'no' } });
  assert.deepEqual(d.rows, [{ id: 'CX.RO', value: 'fixed', readOnly: true }, { id: 'CX.PICK', value: 'No', editable: true, options: ['Yes', 'No'], expected: 'no', ok: true }]);
  assert.equal(d.check?.matched, 2);
  // Details without updates on: no update session is opened, nothing is editable.
  const ro = await lookupFields(f.lookup, 'dev', 'LN-1', ['CX.PICK'], { details: true, updates: false });
  assert.deepEqual(f.asked.at(-1), { advanced: true, session: false });
  assert.equal(ro.rows[0].editable, undefined);
  await assert.rejects(lookupFields(f.lookup, 'uat', 'NOPE', ['CX.FEE']), /NOPE wasn’t found in UAT/);
});

test('a change: only what differs is sent, an option as it is written, then read again until it shows', async () => {
  const f = fakeLookup();
  const seen: FieldRow[][] = [];
  const r = await updateFields(f.lookup, 'dev', 'LN-1', { 'CX.NOTE': 'Goodwill', 'CX.PICK': 'yes', 'CX.FEE': '1250' }, { updates: true, ...f.opts, progress: (rows) => seen.push(rows) });
  assert.deepEqual(f.sent, [[{ id: 'CX.NOTE', value: 'Goodwill' }, { id: 'CX.PICK', value: 'Yes' }]]);
  assert.deepEqual(r.pending, []);
  assert.deepEqual(r.rows.map((x) => [x.id, x.value, x.sent, x.applied]), [['CX.NOTE', 'Goodwill', 'Goodwill', 'applied'], ['CX.PICK', 'Yes', 'Yes', 'applied'], ['CX.FEE', '1,250.00', '1250', 'applied']]);
  assert.equal(r.watchUrl, 'http://lookup.example.invalid/Watch/LN-1');
  assert.ok(seen.some((rows) => rows.some((x) => x.applied === 'pending')), 'progress showed it pending first');
});

test('a change that doesn’t show in time says which are still pending', async () => {
  const f = fakeLookup({ lag: 1000 });
  const r = await updateFields(f.lookup, 'dev', 'LN-1', { 'CX.NOTE': '' }, { updates: true, ...f.opts, waitMs: 30_000 });
  assert.deepEqual(f.sent, [[{ id: 'CX.NOTE', value: '', clear: true }]]);
  assert.deepEqual(r.pending, ['CX.NOTE']);
});

test('refused before anything is sent: updates off, read-only, not on the loan, not an option, nothing to set', async () => {
  for (const [updates, set, why] of [[false, { 'CX.NOTE': 'x' }, /off on this machine/], [true, { 'CX.RO': 'x' }, /CX.RO is read-only/], [true, { 'CX.GONE': 'x' }, /isn’t a field on LN-1/], [true, { 'CX.PICK': 'Maybe' }, /isn’t one of its options/], [true, {}, /Name the fields/]] as const) {
    const f = fakeLookup();
    await assert.rejects(updateFields(f.lookup, 'dev', 'LN-1', { ...set }, { updates, ...f.opts }), why);
    assert.equal(f.sent.length, 0);
  }
});
