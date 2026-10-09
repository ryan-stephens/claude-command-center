import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BuilderTool, readRun, readScenarios, type BuilderTransport } from './verify-builder.ts';
import { guard, type VerifyRequest } from './verify.ts';
import type { VerifyConfig } from '../shared/verify.ts';

// A made-up scenario runner on this machine: nothing here is a real scenario, loan or step.
const BASE = 'http://localhost:5100';
const CFG: VerifyConfig = { builder: { name: 'Sample data', url: BASE, start: 'run the sample tool' } };

function tool(answer: (r: VerifyRequest) => { status: number; json: unknown } | Error, cfg: VerifyConfig = CFG) {
  const seen: VerifyRequest[] = [];
  const t: BuilderTransport = async (r) => { seen.push(r); const a = answer(r); if (a instanceof Error) throw a; return a; };
  return { b: new BuilderTool(() => cfg, t), seen };
}

test('guard, the test-data tool: its three requests pass; everything else is refused', () => {
  const allowed: VerifyRequest[] = [
    { tool: 'builder', method: 'GET', url: `${BASE}/api/scenarios` },
    { tool: 'builder', method: 'GET', url: `${BASE}/api/runs/3f2c-run_1` },
    { tool: 'builder', method: 'POST', url: `${BASE}/api/scenarios/sc-1/versions/3/runs`, json: { environment: 'dev' } },
    { tool: 'builder', method: 'POST', url: `${BASE}/api/scenarios/sc-1/versions/3/runs`, json: { environment: 'uat' } },
  ];
  for (const r of allowed) assert.doesNotThrow(() => guard(r, CFG), `${r.method} ${r.url}`);
  const refused: [string, VerifyRequest][] = [
    ['Prod', { tool: 'builder', method: 'POST', url: `${BASE}/api/scenarios/sc-1/versions/3/runs`, json: { environment: 'prod' } }],
    ['a body with extra keys', { tool: 'builder', method: 'POST', url: `${BASE}/api/scenarios/sc-1/versions/3/runs`, json: { environment: 'dev', steps: [] } }],
    ['no body', { tool: 'builder', method: 'POST', url: `${BASE}/api/scenarios/sc-1/versions/3/runs` }],
    ['an array body', { tool: 'builder', method: 'POST', url: `${BASE}/api/scenarios/sc-1/versions/3/runs`, json: ['dev'] }],
    ['a form', { tool: 'builder', method: 'POST', url: `${BASE}/api/scenarios/sc-1/versions/3/runs`, json: { environment: 'dev' }, form: [['a', 'b']] }],
    ['DELETE', { tool: 'builder', method: 'DELETE' as 'GET', url: `${BASE}/api/scenarios/sc-1` }],
    ['PUT', { tool: 'builder', method: 'PUT' as 'GET', url: `${BASE}/api/scenarios/sc-1` }],
    ['PATCH', { tool: 'builder', method: 'PATCH' as 'GET', url: `${BASE}/api/scenarios/sc-1/versions/3` }],
    ['create a scenario', { tool: 'builder', method: 'POST', url: `${BASE}/api/scenarios`, json: { environment: 'dev' } }],
    ['a new version', { tool: 'builder', method: 'POST', url: `${BASE}/api/scenarios/sc-1/versions`, json: { environment: 'dev' } }],
    ['copy', { tool: 'builder', method: 'POST', url: `${BASE}/api/scenarios/sc-1/copy`, json: { environment: 'dev' } }],
    ['lock', { tool: 'builder', method: 'POST', url: `${BASE}/api/scenarios/sc-1/lock`, json: { environment: 'dev' } }],
    ['steps', { tool: 'builder', method: 'POST', url: `${BASE}/api/scenarios/sc-1/versions/3/steps`, json: { environment: 'dev' } }],
    ['resume', { tool: 'builder', method: 'POST', url: `${BASE}/api/runs/r1/resume`, json: { environment: 'dev' } }],
    ['a run’s steps', { tool: 'builder', method: 'GET', url: `${BASE}/api/runs/r1/steps` }],
    ['a token', { tool: 'builder', method: 'GET', url: `${BASE}/api/token` }],
    ['a token POST', { tool: 'builder', method: 'POST', url: `${BASE}/api/token`, json: { environment: 'dev' } }],
    ['tags', { tool: 'builder', method: 'GET', url: `${BASE}/api/tags` }],
    ['a query', { tool: 'builder', method: 'GET', url: `${BASE}/api/scenarios?all=true` }],
    ['dot-dot', { tool: 'builder', method: 'GET', url: `${BASE}/api/runs/../scenarios/sc-1` }],
    ['a GET with a body', { tool: 'builder', method: 'GET', url: `${BASE}/api/scenarios`, json: {} }],
    ['a lookalike host', { tool: 'builder', method: 'GET', url: 'http://localhost:5100.example.invalid/api/scenarios' }],
    ['another port', { tool: 'builder', method: 'GET', url: 'http://localhost:5101/api/scenarios' }],
    ['another host', { tool: 'builder', method: 'GET', url: 'http://127.0.0.2:5100/api/scenarios' }],
    ['a builder request not marked as one', { method: 'GET', url: `${BASE}/api/scenarios` }],
    ['JSON to the lookup', { method: 'POST', url: 'https://l.example.invalid/F', json: { environment: 'dev' } }],
  ];
  for (const [why, r] of refused) assert.throws(() => guard(r, CFG), /refused/, why);
  // A builder off this machine is refused even when handed in directly (cleanVerify drops it from the file).
  assert.throws(() => guard({ tool: 'builder', method: 'GET', url: 'http://builder.example.invalid:5100/api/scenarios' }, { builder: { url: 'http://builder.example.invalid:5100' } }), /refused/);
  assert.throws(() => guard({ tool: 'builder', method: 'GET', url: `${BASE}/api/scenarios` }, {}), /refused/, 'none set up');
});

test('readScenarios: camelCase or PascalCase, odd entries skipped, missing arrays empty', () => {
  assert.deepEqual(readScenarios([
    { scenarioId: 'sc-1', versionNumber: 3, name: 'Sample purchase', createdAtUtc: '2026-01-01T00:00:00Z', isLocked: true, tags: ['fha', 7] },
    { ScenarioId: 'sc-2', VersionNumber: '1', Name: 'Sample refinance' },
    { scenarioId: 'sc-3' },
    null,
    'junk',
  ]), [
    { id: 'sc-1', version: 3, name: 'Sample purchase', tags: ['fha', '7'], locked: true },
    { id: 'sc-2', version: 1, name: 'Sample refinance', tags: [], locked: false },
  ]);
  assert.deepEqual(readScenarios({ not: 'a list' }), []);
});

test('readRun: statuses in any case, steps in order, only the error’s message (cut at 300, never the stack), the loan guids', () => {
  const r = readRun({
    runId: 'r1', scenarioId: 'sc-1', versionNumber: 3, environment: 'UAT', status: 'FAILED', startedAtUtc: 'x',
    stepRuns: [
      { order: 2, typeId: 'SampleSubmit', status: 'Failed', error: { message: 'x'.repeat(400), exceptionType: 'SampleException', stackTrace: 'at Sample.Secret()' } },
      { order: 1, typeId: 'SampleCreate', status: 'SUCCEEDED' },
      { order: 3, typeId: 'SampleTail', status: 'weird' },
    ],
    runError: { message: 'The sample run failed', stackTrace: 'at Sample.Secret()' },
  }, 'r1');
  assert.equal(r.status, 'failed');
  assert.equal(r.env, 'uat');
  assert.deepEqual(r.steps.map((s) => [s.order, s.type, s.status]), [[1, 'SampleCreate', 'succeeded'], [2, 'SampleSubmit', 'failed'], [3, 'SampleTail', 'pending']]);
  assert.equal(r.steps[1].error!.length, 300);
  assert.equal(r.error, 'The sample run failed');
  assert.ok(!JSON.stringify(r).includes('Secret'), 'no stack trace');
  assert.deepEqual(r.recordIds, []);
  const ok = readRun({ status: 'succeeded', environment: 'dev', finalArtifacts: { loanGuids: ['a1', 'b2'], documentGuids: ['d'] } }, 'r2');
  assert.deepEqual([ok.runId, ok.status, ok.recordIds, ok.steps], ['r2', 'succeeded', ['a1', 'b2'], []]);
  assert.equal(readRun({}, 'r3').status, 'running', 'no status yet: running');
  assert.equal(readRun({ runError: 'plain words' }, 'r4').error, 'plain words');
});

test('BuilderTool: start sends exactly { environment } to the version’s runs; the list and a run are reads', async () => {
  const t = tool((r) => (r.method === 'POST' ? { status: 202, json: { runId: 'run-9' } } : r.url.endsWith('/api/scenarios') ? { status: 200, json: [{ scenarioId: 'sc-1', versionNumber: 3, name: 'S' }] } : { status: 200, json: { status: 'Running', environment: 'dev' } }));
  assert.equal((await t.b.scenarios()).length, 1);
  assert.equal(await t.b.start('uat', 'sc-1', 3), 'run-9');
  assert.equal((await t.b.run('run-9')).status, 'running');
  assert.deepEqual(t.seen, [
    { tool: 'builder', method: 'GET', url: `${BASE}/api/scenarios` },
    { tool: 'builder', method: 'POST', url: `${BASE}/api/scenarios/sc-1/versions/3/runs`, json: { environment: 'uat' } },
    { tool: 'builder', method: 'GET', url: `${BASE}/api/runs/run-9` },
  ]);
  for (const r of t.seen) assert.doesNotThrow(() => guard(r, CFG));
  await assert.rejects(t.b.start('prod' as 'dev', 'sc-1', 3), /Dev or UAT only/);
  await assert.rejects(t.b.start('dev', '../x', 3), /isn’t a scenario/);
  await assert.rejects(t.b.run('a/b'), /isn’t a run/);
  assert.equal(t.seen.length, 3, 'none of those were sent');
});

test('BuilderTool: not running says so, with the start hint; an error answer says the status, never a body’s stack', async () => {
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  await assert.rejects(tool(() => refused).b.scenarios(), /Sample data isn’t running here\. To start it: run the sample tool/);
  await assert.rejects(tool(() => refused, { builder: { url: BASE } }).b.scenarios(), (e: Error) => e.message === 'The test-data tool isn’t running here.');
  await assert.rejects(tool(() => ({ status: 400, json: { title: 'Bad environment', stackTrace: 'at Secret' } })).b.start('dev', 'sc-1', 1), (e: Error) => /answered 400: Bad environment/.test(e.message) && !/Secret/.test(e.message));
  await assert.rejects(tool(() => ({ status: 202, json: {} })).b.start('dev', 'sc-1', 1), /didn’t say which run/);
  await assert.rejects(new BuilderTool(() => ({})).scenarios(), /no "url"/);
});
