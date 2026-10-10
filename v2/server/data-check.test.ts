import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldChange, LookupField, LookupResult } from '../../shared/verify.ts';
import type { DataCheck, DataCheckAsk } from '../shared/types.ts';
import { newCheck, runDataCheck, type DataDeps } from './data-check.ts';
import { compareFields } from './tools.ts';

/** A pretend loan and lookup: an update shows after `lag` reads; CX.RO is read-only; CX.PICK has options. */
function fakes(o: { lag?: number; updates?: boolean; loanFails?: boolean } = {}) {
  const values: Record<string, string> = { 'CX.FEE': '1,250.00', 'CX.RO': 'fixed', 'CX.PICK': 'No', 'CX.NOTE': 'old' };
  let pending: { changes: FieldChange[]; left: number } | undefined;
  const sent: FieldChange[][] = [];
  let clock = 0;
  const read = (ids: string[]): LookupField[] => ids.map((id) => (id in values ? { id, value: values[id], exists: true, ...(id === 'CX.RO' ? { readOnly: true } : {}), ...(id === 'CX.PICK' ? { options: ['Yes', 'No'] } : {}) } : { id, value: '', exists: false }));
  const tick = () => { if (pending && --pending.left <= 0) { for (const ch of pending.changes) values[ch.id] = ch.clear ? '' : ch.value; pending = undefined; } };
  const deps: DataDeps = {
    makeLoan: async (env, scenario) => { if (o.loanFails) throw new Error(`${scenario} failed at step 2`); return { loans: [{ loan: 'LN-1', env, scenario, at: 0 }] }; },
    lookup: {
      fetch: async (_env, loan, ids, _advanced, opts): Promise<LookupResult> => {
        if (opts.session === false) tick();
        return { env: 'dev', recordId: loan, found: true, fields: read(ids), updatable: true, token: 't', editable: ids.filter((i) => i in values && i !== 'CX.RO') };
      },
      update: async (_t, changes) => { sent.push(changes); pending = { changes, left: o.lag ?? 2 }; return { sent: changes.length, watchUrl: 'http://lookup.example.invalid/Watch/LN-1' }; },
    },
    check: async (_env, loan, ids, expect, list) => {
      const f = read(ids);
      const values2: Record<string, string | null> = {};
      for (const x of f) values2[x.id] = x.exists ? x.value : null;
      return { result: { loan, env: 'dev', ...(list ? { list } : {}), ...compareFields(f, ids, expect), at: 0 }, values: values2 };
    },
    listIds: (name) => { if (name !== 'Fees') throw new Error(`No saved field list called "${name}".`); return ['CX.FEE']; },
    updatesOn: () => o.updates !== false,
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  };
  return { deps, sent, values };
}

async function run(ask: DataCheckAsk, f: ReturnType<typeof fakes>) {
  const seen: DataCheck[] = [];
  const made: string[] = [];
  const end = await runDataCheck(newCheck(ask, 'claude', 0), f.deps, (c, m) => { seen.push(c); if (m?.loans) made.push(...m.loans.map((l) => l.loan)); });
  return { end, seen, made };
}

test('a new loan, two fields filled, waited on until they apply, then everything checked', async () => {
  const f = fakes();
  const { end, seen, made } = await run({ env: 'dev', scenario: 'Late fee', set: { 'CX.NOTE': 'Goodwill', 'CX.PICK': 'yes' }, list: 'Fees', expect: { 'CX.FEE': '1250' } }, f);
  assert.equal(end.state, 'passed');
  assert.equal(end.loan, 'LN-1');
  assert.deepEqual(made, ['LN-1']);
  assert.deepEqual(f.sent, [[{ id: 'CX.NOTE', value: 'Goodwill' }, { id: 'CX.PICK', value: 'Yes' }]]);
  assert.deepEqual(end.steps.map((s) => s.state), ['done', 'done', 'done', 'done']);
  assert.equal(end.result!.total, 3);
  assert.equal(end.watchUrl, 'http://lookup.example.invalid/Watch/LN-1');
  assert.ok(seen.some((c) => c.steps[2].state === 'running'), 'the apply step was shown while it waited');
});

test('a field with its value already is not sent; nothing to send skips the wait', async () => {
  const f = fakes();
  const { end } = await run({ env: 'dev', loan: 'LN-9', set: { 'CX.FEE': '1250.00' } }, f);
  assert.equal(f.sent.length, 0);
  assert.equal(end.steps[1].text, 'every field had its value already');
  assert.equal(end.state, 'passed');
});

test('an update that never applies fails the check after the wait, but still reads the fields', async () => {
  const f = fakes({ lag: 1000 });
  const { end } = await run({ env: 'dev', loan: 'LN-9', set: { 'CX.NOTE': 'new' } }, f);
  assert.equal(end.state, 'failed');
  assert.match(end.steps[2].text, /not applied after 3 minutes: CX.NOTE/);
  assert.equal(end.result?.differs[0].id, 'CX.NOTE');
});

test('refused before anything is sent: updates off, a read-only field, a value not among the options', async () => {
  for (const [o, set, why] of [[{ updates: false }, { 'CX.NOTE': 'x' }, /off on this machine/], [{}, { 'CX.RO': 'x' }, /Can’t fill CX.RO/], [{}, { 'CX.PICK': 'Maybe' }, /isn’t one of its options/]] as const) {
    const f = fakes(o);
    const { end } = await run({ env: 'dev', loan: 'LN-9', set: { ...set } }, f);
    assert.equal(end.state, 'failed');
    assert.match(end.steps[1].text, why);
    assert.equal(f.sent.length, 0);
    assert.equal(end.steps[3].state, 'skipped');
  }
});

test('a loan that fails to make stops the check there, saying why', async () => {
  const { end } = await run({ env: 'uat', scenario: 'Late fee', fields: ['CX.FEE'] }, fakes({ loanFails: true }));
  assert.equal(end.state, 'failed');
  assert.match(end.steps[0].text, /failed at step 2/);
});

test('a check only: what differs is the check’s result', async () => {
  const { end } = await run({ env: 'dev', loan: 'LN-9', expect: { 'CX.NOTE': 'new' }, fields: ['CX.GONE'] }, fakes());
  assert.equal(end.state, 'differs');
  assert.deepEqual(end.result!.differs.map((d) => d.id), ['CX.GONE', 'CX.NOTE']);
});
