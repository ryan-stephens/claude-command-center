import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenarioAsk } from '../shared/data-tools.ts';
import { createOperation, fit } from './scenarios.ts';

const openapi3 = {
  openapi: '3.0.1',
  paths: {
    '/api/Scenarios': {
      get: { summary: 'List' },
      post: {
        summary: 'Create a scenario',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateScenario' } } } },
        responses: { 201: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Created' } } } } },
      },
    },
    '/api/scenarios/{id}/versions/{n}/runs': { post: { summary: 'Run' } },
    '/api/folders': { get: { summary: 'Folders' } },
    '/api/health': { get: {} },
  },
  components: {
    schemas: {
      CreateScenario: { type: 'object', properties: { name: { type: 'string' }, folderId: { type: 'string' }, steps: { type: 'array', items: { $ref: '#/components/schemas/Step' } } } },
      Step: { type: 'object', properties: { typeId: { type: 'string' }, settings: { $ref: '#/components/schemas/Settings' } } },
      Settings: { type: 'object', additionalProperties: true },
      Created: { type: 'object', properties: { scenarioId: { type: 'string' } } },
      Unused: { type: 'object' },
    },
  },
};

test('the create operation from an OpenAPI description: its schemas followed through $ref, the related operations listed', () => {
  const op = createOperation(openapi3, 'api/scenarios')!;
  assert.equal(op.path, '/api/Scenarios');
  assert.equal(op.summary, 'Create a scenario');
  assert.deepEqual(Object.keys(op.schemas).sort(), ['CreateScenario', 'Created', 'Settings', 'Step']);
  assert.ok(op.related.includes('POST /api/Scenarios: Create a scenario'));
  assert.ok(op.related.includes('GET /api/folders: Folders'));
  assert.ok(!op.related.some((r) => r.includes('health')));
});

test('a Swagger 2 description works too; no POST at the address, or no description, gives nothing', () => {
  const swagger2 = { swagger: '2.0', paths: { '/api/scenarios': { post: { parameters: [{ in: 'body', schema: { $ref: '#/definitions/New' } }], responses: { 200: { schema: { type: 'object' } } } } } }, definitions: { New: { type: 'object' } } };
  assert.deepEqual(Object.keys(createOperation(swagger2)!.schemas), ['New']);
  assert.equal(createOperation(openapi3, 'api/other'), undefined);
  assert.equal(createOperation('not a doc'), undefined);
});

test('long values are cut to fit, and say so', () => {
  assert.deepEqual(fit({ a: 1 }, 100), { a: 1 });
  assert.match(String(fit({ a: 'x'.repeat(500) }, 100)), /cut at 100 characters/);
});

test('the ask copied for Claude: the session, the folder, the template, the env and the notes', () => {
  const a = scenarioAsk({ key: 'SHOP-160', folder: 'Fees/Waivers', like: 'Late fee due', env: 'uat', notes: 'a loan in repayment' });
  assert.match(a, /for SHOP-160/);
  assert.match(a, /scenario_guide with like: "Late fee due"/);
  assert.match(a, /folder "Fees\/Waivers"/);
  assert.match(a, /run it in UAT \(run_env: "uat"\)/);
  assert.match(a, /Also: a loan in repayment/);
});
