// The toolbelt's MCP side, without a dependency: newline-delimited JSON-RPC over stdio, the four
// methods Claude Code uses (initialize, tools/list, tools/call, ping). Each tool call goes to the
// v2 server as the session, by its token. Pure: `handle` takes a message and a way to call a tool.

export interface ToolDef { name: string; description: string; inputSchema: Record<string, unknown> }

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });
const env = { type: 'string', enum: ['dev', 'uat'], description: 'Dev or UAT. Never Prod.' };

export const TOOL_DEFS: ToolDef[] = [
  { name: 'session_info', description: 'This Command Center session: its ticket, repos (worktrees), branch, where the run logs are, and the stack if it runs.', inputSchema: obj({}) },
  { name: 'stack_status', description: 'The stack for this session: which APIs and the UI run, their health and ports, and which APIs the workspace can run. APIs not running here come from Dev through the UI proxy file.', inputSchema: obj({}) },
  { name: 'stack_up', description: 'Bring up the UI and APIs for this session\'s worktrees. With no apis, runs the APIs this session has worktrees of. Already up: adds the APIs not running yet.', inputSchema: obj({ apis: { type: 'array', items: { type: 'string' }, description: 'API repo names, from stack_status' }, env: { type: 'string', description: 'The stack\'s env choice (dev or uat), when it asks for one' } }) },
  { name: 'stack_add_api', description: 'Run one more API locally for this session. Rebuilds the UI\'s proxy file to point at it and restarts the UI.', inputSchema: obj({ api: { type: 'string' } }, ['api']) },
  { name: 'stack_restart', description: 'Restart one service of the stack: an API by repo name, or "ui".', inputSchema: obj({ service: { type: 'string' } }, ['service']) },
  { name: 'stack_logs', description: 'The last lines a service printed: an API by repo name, or "ui".', inputSchema: obj({ service: { type: 'string' }, lines: { type: 'number' } }, ['service']) },
  { name: 'test_data_tool', description: 'The test-data tool (it makes test loans from saved scenarios). status: is it running. start: start it from its installed folder (as this machine\'s verify.json says) and wait until it answers. stop: stop what was started here.', inputSchema: obj({ action: { type: 'string', enum: ['status', 'start', 'stop'] }, wait_seconds: { type: 'number' } }) },
  { name: 'list_loan_scenarios', description: 'The saved scenarios the test-data tool can make loans from: name, id, version, tags.', inputSchema: obj({}) },
  { name: 'make_test_loan', description: 'Make a test loan in Dev or UAT from a saved scenario. The run goes on in Command Center (the user sees its steps); this waits up to wait_seconds (default 240, at most 270) and returns the loan ids, or the run so far: then call data_status with its id.', inputSchema: obj({ env, scenario: { type: 'string', description: 'A scenario name (or id) from list_loan_scenarios' }, wait_seconds: { type: 'number' } }, ['env', 'scenario']) },
  { name: 'lookup_fields', description: 'Read a loan\'s fields through the record lookup, in Dev or UAT: the ids you name and/or a saved field list. details: true adds which fields are read-only, which can be changed, and each field\'s options. expect: field id → value compares (and records the check as evidence).', inputSchema: obj({ env, loan: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } }, list: { type: 'string', description: 'A saved field list name' }, details: { type: 'boolean' }, expect: { type: 'object', additionalProperties: { type: 'string' }, description: 'Field id → the value it should have' } }, ['env', 'loan']) },
  { name: 'update_fields', description: 'Change a loan\'s fields through the record lookup, in Dev or UAT (only where this machine allows updates; read-only fields can\'t be changed; a field with options takes one of them; "" clears a field). Then reads them again every 10 s until the change shows (up to wait_seconds, default and at most 180) and says which applied.', inputSchema: obj({ env, loan: { type: 'string' }, set: { type: 'object', additionalProperties: { type: 'string' }, description: 'Field id → the value to put in it' }, wait_seconds: { type: 'number' } }, ['env', 'loan', 'set']) },
  { name: 'scenario_guide', description: 'Before making a test-data scenario for this work: how the tool wants a scenario (the create operation and its schemas from the tool’s own API description), an existing scenario as a template (like: a name), the folders in use, the tool’s installed folder (read its source when the shape is unclear), and this session’s side: the ticket, the changed files, the fields to check, the loans made, and the folder the user chose. Its howTo lists the steps.', inputSchema: obj({ like: { type: 'string', description: 'A saved scenario to use as the template' } }) },
  { name: 'make_scenario', description: 'Make a new test-data scenario from a body shaped as the tool wants it (scenario_guide says how), filed under the user’s folder. With run_env, a loan is made from it right away and this waits for it (up to wait_seconds, default 240).', inputSchema: obj({ body: { type: 'object', description: 'The scenario, as the tool’s create operation takes it' }, run_env: { type: 'string', enum: ['dev', 'uat'] }, wait_seconds: { type: 'number' } }, ['body']) },
  { name: 'fields_to_check', description: 'The fields worth checking for this session, and the loans made so far (newest first): the ones you or the user picked (with why and the value each should have), field ids the ticket names, and field ids in the lines this session added. The user sees the same list in the Data panel\'s lookup.', inputSchema: obj({}) },
  { name: 'set_fields_to_check', description: 'Pick the fields that prove this change, each with why and (when you know it) the value it should have; they are added to the picks (replace: true starts over; remove: ids to drop). The user sees them in the Data panel, and the lookup there fills itself with them.', inputSchema: obj({ fields: { type: 'array', items: obj({ id: { type: 'string' }, why: { type: 'string' }, expect: { type: 'string' } }, ['id']) }, replace: { type: 'boolean' }, remove: { type: 'array', items: { type: 'string' } } }, ['fields']) },
  { name: 'data_status', description: 'A loan, lookup or change from this session, by id (the latest without one); waits up to wait_seconds (default 120) for one still running.', inputSchema: obj({ id: { type: 'string' }, wait_seconds: { type: 'number' } }) },
  { name: 'add_evidence', description: 'Record something that proves the change works, for the PR: tests run, what you checked.', inputSchema: obj({ kind: { type: 'string', enum: ['tests', 'note'] }, text: { type: 'string' }, ok: { type: 'boolean' } }, ['text']) },
  { name: 'ship', description: 'Push the session\'s branch in each repo with commits, open the PRs with the evidence, and post the review request to the team channel. Commit first, and ask the user before shipping.', inputSchema: obj({ title: { type: 'string', description: 'A conventional-commit PR title' }, summary: { type: 'string', description: 'What changed and why, for the PR body' }, post: { type: 'boolean', description: 'Post to the team channel (default true)' } }) },
];

export const SERVER_INFO = { name: 'command-center', version: '2.0.0' };

interface Msg { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

export type CallTool = (name: string, args: Record<string, unknown>) => Promise<{ result?: unknown; error?: string }>;

/** One message in, the reply out (null for a notification). */
export async function handle(msg: Msg, call: CallTool): Promise<Record<string, unknown> | null> {
  const id = msg.id;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  if (id === undefined || id === null) return null;
  switch (msg.method) {
    case 'initialize': {
      const asked = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18';
      return reply({ protocolVersion: asked, capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: 'Command Center\'s tools for this session: its stack (UI + APIs), test loans and the record lookup (read and change fields) in Dev/UAT, evidence, and shipping. CLAUDE.local.md says more.' });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOL_DEFS });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      if (!TOOL_DEFS.some((t) => t.name === name)) return reply({ content: [{ type: 'text', text: `No tool called ${name}.` }], isError: true });
      const args = (msg.params?.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {}) as Record<string, unknown>;
      const r: { result?: unknown; error?: string } = await call(name, args).catch((e: Error) => ({ error: e.message }));
      if (r.error) return reply({ content: [{ type: 'text', text: r.error }], isError: true });
      return reply({ content: [{ type: 'text', text: typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2) }] });
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}
