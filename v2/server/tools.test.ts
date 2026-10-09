import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareFields, envOf, findScenario, makeLoan } from './tools.ts';
import type { BuilderTool } from '../../server/verify-builder.ts';

const list = [
  { id: 's1', version: 3, name: 'Late fee due', tags: ['fees'], locked: false },
  { id: 's2', version: 1, name: 'Escrow shortage', tags: ['escrow'], locked: false },
  { id: 's3', version: 2, name: 'Late fee waived', tags: [], locked: true },
];

test('a scenario by id, exact name, or the one name that contains the words; Prod is refused', () => {
  assert.equal(findScenario(list, 's2').name, 'Escrow shortage');
  assert.equal(findScenario(list, 'late fee due').id, 's1');
  assert.equal(findScenario(list, 'escrow').id, 's2');
  assert.throws(() => findScenario(list, 'late fee'), /could be Late fee due; Late fee waived/);
  assert.throws(() => findScenario(list, 'payoff'), /No scenario called/);
  assert.throws(() => envOf('prod'), /never Prod/);
  assert.equal(envOf(undefined), 'dev');
});

test('fields compare with commas and case aside; a missing field differs', () => {
  const read = [{ id: 'LateFee', value: '1,250.00', exists: true }, { id: 'Waived', value: 'True', exists: true }, { id: 'Gone', value: '', exists: false }];
  const r = compareFields(read, ['LateFee', 'Waived', 'Gone', 'Other'], { latefee: '1250.00', Waived: 'true' });
  assert.equal(r.total, 4);
  assert.equal(r.matched, 2);
  assert.deepEqual(r.differs.map((d) => d.id), ['Gone', 'Other']);
  assert.deepEqual(compareFields(read, ['LateFee'], { LateFee: '99' }).differs, [{ id: 'LateFee', expected: '99', actual: '1,250.00' }]);
});

test('a loan is made by starting the scenario and waiting for its run; a failed run says its step', async () => {
  const calls: string[] = [];
  let polls = 0;
  const builder = {
    scenarios: async () => list,
    start: async (env: string, id: string, v: number) => { calls.push(`${env} ${id} v${v}`); return 'run-1'; },
    run: async () => (++polls < 2 ? { runId: 'run-1', env: 'dev', status: 'running', steps: [], recordIds: [] } : { runId: 'run-1', env: 'dev', status: 'succeeded', steps: [], recordIds: ['LN-1'] }),
  } as unknown as BuilderTool;
  const r = await makeLoan(builder, 'dev', 'escrow', 5_000, 1);
  assert.deepEqual(calls, ['dev s2 v1']);
  assert.equal(r.loans[0].loan, 'LN-1');
  const failing = { ...builder, run: async () => ({ runId: 'r', env: 'uat', status: 'failed', steps: [{ order: 2, type: 'CreateLoan', status: 'failed', error: 'no product' }], recordIds: [] }) } as unknown as BuilderTool;
  await assert.rejects(makeLoan(failing, 'uat', 's1', 5_000, 1), /failed at step 2 \(CreateLoan\): no product/);
});
