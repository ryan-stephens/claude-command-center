import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, TOOL_DEFS } from './protocol.ts';

test('the toolbelt answers initialize, lists its tools, calls one, and reports a tool error as isError', async () => {
  const calls: string[] = [];
  const call = async (name: string, args: Record<string, unknown>) => {
    calls.push(`${name} ${JSON.stringify(args)}`);
    return name === 'make_test_loan' ? { error: 'Test loans are for Dev or UAT only, never Prod.' } : { result: { ok: true } };
  };
  const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, call);
  assert.equal((init!.result as { protocolVersion: string }).protocolVersion, '2025-06-18');
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, call), null);
  const list = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, call);
  assert.equal((list!.result as { tools: unknown[] }).tools.length, TOOL_DEFS.length);
  const ok = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'stack_status', arguments: {} } }, call);
  assert.match(JSON.stringify(ok), /\\"ok\\": true/);
  const bad = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'make_test_loan', arguments: { env: 'prod', scenario: 'x' } } }, call);
  assert.equal((bad!.result as { isError: boolean }).isError, true);
  const none = await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'rm_rf' } }, call);
  assert.equal((none!.result as { isError: boolean }).isError, true);
  assert.equal(calls.length, 2);
  const unknown = await handle({ jsonrpc: '2.0', id: 6, method: 'resources/list' }, call);
  assert.equal((unknown!.error as { code: number }).code, -32601);
});
