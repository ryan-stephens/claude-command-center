// Stand-ins for Verify's tools (PLAN §105, §132, §133), with made-up data: the field set tool (dev on
// PORT, uat on PORT+1), the record lookup (PORT+2) and the scenario runner (PORT+3). Every request is
// appended to the log file named (method, path, form field or body names, user agent), so a
// walkthrough can check what the app sent. Dev's set has 1000 and CX.SAMPLE.ONE; UAT's only 1000.
// Record 5001 exists, and so does any GUID-shaped one (the loans the scenario runner makes); any
// other doesn't. The scenario runner's runs succeed on the third poll with a random loan guid,
// except "Sample failing", which fails at its second step on the second poll.
const http = require('node:http');
const fs = require('node:fs');
const port = Number(process.argv[2] || 18900);
const LOG = process.argv[3];
const log = (o) => { if (LOG) fs.appendFileSync(LOG, `${JSON.stringify(o)}\n`); };
const SETS = {
  dev: [{ Id: 1, FieldName: 'Sample amount', SampleKey: '1000', IsPII: false, RdbType: 'decimal', RdbFieldSize: 10, Format: 'DECIMAL_2', Options: null },
    { Id: 2, FieldName: 'Sample one', SampleKey: 'CX.SAMPLE.ONE', IsPII: false, RdbType: 'varchar', RdbFieldSize: 20, Format: 'STRING', Options: ['Yes', 'No'] }],
  uat: [{ Id: 1, FieldName: 'Sample amount', SampleKey: '1000', IsPII: false, RdbType: 'decimal', RdbFieldSize: 10, Format: 'DECIMAL_2', Options: null }],
};
const KNOWN = { '1000': { FieldName: 'Sample amount', Format: 'DECIMAL_2', Options: [] }, 'CX.SAMPLE.ONE': { FieldName: 'Sample one', Format: 'STRING', Options: ['Yes', 'No'] } };
const json = (res, o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };

function setTool(env) {
  return (req, res) => {
    const u = new URL(req.url, 'http://x');
    log({ tool: `set-${env}`, method: req.method, path: u.pathname, agent: req.headers['user-agent'] ?? '' });
    if (req.method === 'GET' && u.pathname === '/Home/SetVersion') return json(res, { Successful: true, Payload: { Id: 9, Description: `Sample ${env} set`, Number: env === 'dev' ? 42 : 41, Fields: SETS[env] } });
    if (req.method === 'GET' && u.pathname === '/Home/ValidateField') {
      const id = (u.searchParams.get('encompassId') ?? '').toUpperCase();
      const k = KNOWN[id];
      if (!k) return json(res, { Successful: false, Payload: `Field ${id} was not found` });
      return json(res, { Successful: true, Payload: { Exists: true, FieldName: k.FieldName, Format: k.Format, Options: k.Options, ExistsInSampleSet: SETS[env].some((f) => f.SampleKey === id), FieldId: id, Message: null } });
    }
    res.setHeader('content-type', 'text/html');
    res.end(`<h1>stand-in field set (${env})</h1><p>${u.pathname}</p>`);
  };
}

// The record lookup (§105, §134), shaped like the real page: a fetch form; for a record, a role form,
// a move form and the update form around table#FieldResults, each repeating the record's hidden
// values; hidden Fields[<id>].* inputs after each row; a text box or a select of options and a
// ShouldUpdate checkbox (with its hidden "false" twin) per editable row; 1000 read-only (salmon
// cells, no inputs); an unknown id all salmon. An update is logged by field ids and count only, is
// answered with the success paragraph and a progress link, and shows after two later fetches.
const enc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const START = { '1000': '12.50', 'CX.SAMPLE.ONE': 'Yes & no', 'GROUP.NAME.ROLE NAME': 'Sample role', 'CX.EMPTY': '', 'CX.AMOUNT': '1,250.00' };
const OPTIONS = { 'CX.SAMPLE.ONE': ['', 'Yes & no', 'No'] };
const RECORDS = new Map();
const recordOf = (id) => { if (!RECORDS.has(id)) RECORDS.set(id, { values: { ...START }, pending: [] }); return RECORDS.get(id); };
// "1,250.00"-style for amounts, as the tool shows them.
const shown = (id, v) => (id === 'CX.AMOUNT' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v);
const isRecord = (id) => /^(5001|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(id ?? '');

function lookupPage({ record, env, ids, advanced, success, info }) {
  const hiddenRecord = `<input type="hidden" name="RecordId" value="${enc(record)}" /><input type="hidden" name="RecordNumber" value="SAMPLE-0001" /><input type="hidden" name="RecordFolder" value="Sample Folder" />`;
  const roles = '<input type="hidden" name="AssignedRoles[Sample Role].Id" value="7" /><input type="hidden" name="AssignedRoles[Sample Role].Name" value="Sample Person" />';
  const r = recordOf(record);
  const rows = ids.map((id) => {
    const key = id.toUpperCase();
    const v = r.values[key];
    if (v === undefined) return `<tr style="background-color: salmon"><td>${enc(id)}</td><td>(Field does not exist)</td><td></td><td></td></tr><input type="hidden" name="Fields[${enc(id)}].Value" value="" /><input type="hidden" name="Fields[${enc(id)}].Exists" value="False" />`;
    const ro = key === '1000';
    const opts = OPTIONS[key];
    const box = opts ? `<select name="FieldsToUpdate[${enc(id)}].Value" disabled>${opts.map((o) => `<option value="${enc(o)}">${enc(o)}</option>`).join('')}</select>` : `<input type="text" name="FieldsToUpdate[${enc(id)}].Value" value="" disabled />`;
    const cells = ro ? '<td style="background-color: salmon"></td><td style="background-color: salmon"></td>' : `<td>${box}</td><td><input type="checkbox" name="FieldsToUpdate[${enc(id)}].ShouldUpdate" value="true" /><input type="hidden" name="FieldsToUpdate[${enc(id)}].ShouldUpdate" value="false" /></td>`;
    return `<tr><td>${enc(id)}</td><td>${enc(v)}</td>${cells}</tr><input type="hidden" name="Fields[${enc(id)}].Value" value="${enc(v)}" /><input type="hidden" name="Fields[${enc(id)}].Exists" value="True" /><input type="hidden" name="Fields[${enc(id)}].ReadOnly" value="${ro ? 'True' : 'False'}" />${advanced && opts ? opts.map((o, i) => `<input type="hidden" name="Fields[${enc(id)}].Options[${i}]" value="${enc(o)}" />`).join('') : ''}`;
  }).join('\n');
  return `<html><body>
<form action="/Lookup" method="post"><select name="Environment"><option>Dev</option><option>Uat</option><option>Prod</option></select><input name="RecordId" /><textarea name="FieldsToFetch"></textarea><button>Fetch</button></form>
${success ? `<p id="SuccessMessage">${success}</p>` : ''}${info ? `<div id="InfoMessage">${info}</div>` : ''}
<form action="/AssignRole" method="post"><input type="hidden" name="Environment" value="${enc(env)}" />${hiddenRecord}${roles}<select name="RoleToAssign"><option>Sample Role</option></select><button>Assign</button></form>
<form action="/MoveRecord" method="post"><input type="hidden" name="Environment" value="${enc(env)}" />${hiddenRecord}<select name="TargetFolder"><option>Other Folder</option></select><button>Move</button></form>
<form action="/LookupUpdate" method="post"><p>Leave the update value empty to clear a field.</p>
<table id="FieldResults"><tr><th>Field ID</th><th>Field Value</th><th>Update Field Value</th><th>Update Field?</th></tr>
${rows}
</table>
${hiddenRecord}<input type="hidden" name="Environment" value="${enc(env)}" /><input type="hidden" name="FieldsToFetch" value="${enc(ids.join('\r\n'))}" />${roles}
<button type="submit">Update</button></form>
</body></html>`;
}

function lookup(req, res) {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const form = new URLSearchParams(body);
    const path = new URL(req.url, 'http://x').pathname;
    res.setHeader('content-type', 'text/html');
    // The walk's fresh start: every record back to its first values (not a tool's endpoint; not logged).
    if (path === '/__reset') { RECORDS.clear(); return res.end('reset'); }
    // Writes: the update form logs only field ids and a count; the role and move forms are flagged.
    if (path === '/AssignRole' || path === '/MoveRecord') { log({ tool: 'lookup-other', flagged: true, method: req.method, path, agent: req.headers['user-agent'] ?? '' }); return res.end('<p>never meant to be reached</p>'); }
    if (path === '/LookupUpdate') {
      const ticked = [...new Set([...form.entries()].filter(([k, v]) => /^FieldsToUpdate\[.+\]\.ShouldUpdate$/.test(k) && v === 'true').map(([k]) => k.slice(15, k.lastIndexOf(']'))))];
      log({ tool: 'lookup-update', method: req.method, path, ids: ticked, count: ticked.length, names: [...new Set([...form.keys()].map((k) => k.replace(/\[.*\]/, '[]')))], env: form.get('Environment'), agent: req.headers['user-agent'] ?? '' });
      const record = form.get('RecordId');
      if (req.method !== 'POST' || !isRecord(record) || !['Dev', 'Uat'].includes(form.get('Environment'))) return res.end('<p>Not sent.</p>');
      const r = recordOf(record);
      for (const id of ticked) r.pending.push({ id: id.toUpperCase(), value: shown(id.toUpperCase(), form.get(`FieldsToUpdate[${id}].Value`) ?? ''), after: 2 });
      const ids = (form.get('FieldsToFetch') ?? '').split('\r\n').filter(Boolean);
      return res.end(lookupPage({ record, env: form.get('Environment'), ids, advanced: false, success: `Update request was successfully sent to the sample writer. ${ticked.length} field(s) to update were sent. Please allow a couple minutes for the update to apply.`, info: `Follow it on <a href="/Watch/${encodeURIComponent(record)}">its progress page</a>.` }));
    }
    log({ tool: 'lookup', method: req.method, path, fields: [...form.keys()], advanced: form.get('AdvancedFetch'), env: form.get('Environment'), ids: (form.get('FieldsToFetch') ?? '').split('\r\n').filter(Boolean), agent: req.headers['user-agent'] ?? '' });
    if (path.startsWith('/Watch/')) return res.end('<h1>stand-in progress page</h1>');
    const record = form.get('RecordId');
    if (req.method !== 'POST' || !isRecord(record)) return res.end('<html><body><form action="/Lookup" method="post"><input name="RecordId" /><p>Enter a record.</p></form></body></html>');
    // A change sent shows after two later fetches.
    const r = recordOf(record);
    for (const p of r.pending) { p.after -= 1; if (p.after === 0) r.values[p.id] = p.value; }
    r.pending = r.pending.filter((p) => p.after > 0);
    res.end(lookupPage({ record, env: form.get('Environment'), ids: (form.get('FieldsToFetch') ?? '').split('\r\n').filter(Boolean), advanced: form.get('AdvancedFetch') === 'true' }));
  });
}

// The scenario runner (§133): loopback, JSON, camelCase, enums as strings.
const SCENARIOS = [
  { scenarioId: 'sc-purchase', versionNumber: 3, name: 'Sample purchase', createdAtUtc: '2026-01-02T03:04:05Z', isLocked: false, tags: ['fha', 'smoke'] },
  { scenarioId: 'sc-refi', versionNumber: 1, name: 'Sample refinance', createdAtUtc: '2026-01-03T03:04:05Z', isLocked: false, tags: ['va'] },
  { scenarioId: 'sc-failing', versionNumber: 2, name: 'Sample failing', createdAtUtc: '2026-01-04T03:04:05Z', isLocked: true, tags: ['broken'] },
];
// A made-up API description (OpenAPI 3) for v2's scenario guide (§143).
const SAMPLE_OPENAPI = {
  openapi: '3.0.1',
  info: { title: 'Sample scenario runner', version: '1' },
  paths: {
    '/api/scenarios': {
      get: { summary: 'List the scenarios' },
      post: {
        summary: 'Create a scenario',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateScenario' } } } },
        responses: { 201: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Created' } } } } },
      },
    },
    '/api/scenarios/{scenarioId}/versions/{versionNumber}/runs': { post: { summary: 'Run a version' } },
  },
  components: {
    schemas: {
      CreateScenario: { type: 'object', required: ['name', 'steps'], properties: { name: { type: 'string' }, folder: { type: 'string', description: 'The folder it is filed under' }, tags: { type: 'array', items: { type: 'string' } }, steps: { type: 'array', items: { $ref: '#/components/schemas/Step' } } } },
      Step: { type: 'object', properties: { order: { type: 'integer' }, typeId: { type: 'string', enum: ['SampleCreateLoan', 'SampleSetField', 'SampleSubmit', 'SampleOrderCredit'] }, settings: { type: 'object', additionalProperties: true } } },
      Created: { type: 'object', properties: { scenarioId: { type: 'string' }, versionNumber: { type: 'integer' } } },
    },
  },
};
const RUNS = new Map();
const guid = () => require('node:crypto').randomUUID();
function builder(req, res) {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const p = new URL(req.url, 'http://x').pathname;
    let json; try { json = body ? JSON.parse(body) : undefined; } catch { json = 'not json'; }
    log({ tool: 'builder', method: req.method, path: p, query: new URL(req.url, 'http://x').search, body: json && typeof json === 'object' ? Object.keys(json) : json, env: json?.environment, agent: req.headers['user-agent'] ?? '' });
    if (req.method === 'GET' && p === '/api/scenarios') return json_(res, 200, SCENARIOS);
    if (req.method === 'GET' && p.startsWith('/ui')) { res.setHeader('content-type', 'text/html'); return res.end('<h1>stand-in scenario runner</h1>'); }
    const start = /^\/api\/scenarios\/([\w-]+)\/versions\/(\d+)\/runs$/.exec(p);
    if (req.method === 'POST' && start) {
      if (!['dev', 'uat'].includes(json?.environment)) return json_(res, 400, { title: 'Environment must be dev or uat' });
      const sc = SCENARIOS.find((s) => s.scenarioId === start[1]);
      const runId = guid();
      RUNS.set(runId, { sc, env: json.environment, polls: 0, loan: guid() });
      return json_(res, 202, { runId });
    }
    const runAt = /^\/api\/runs\/([\w-]+)$/.exec(p);
    if (req.method === 'GET' && runAt && RUNS.has(runAt[1])) {
      const r = RUNS.get(runAt[1]);
      r.polls += 1;
      const failing = r.sc?.scenarioId === 'sc-failing';
      const done = failing ? r.polls >= 2 : r.polls >= 3;
      const step = (order, typeId, status, error) => ({ order, typeId, status, ...(error ? { error } : {}) });
      const steps = failing
        ? [step(1, 'SampleCreateLoan', 'Succeeded'), step(2, 'SampleSubmit', done ? 'Failed' : 'Running', done ? { message: 'Sample step failed: the made-up service said no', exceptionType: 'SampleException', stackTrace: 'at Sample.Secret.Stack()' } : undefined), step(3, 'SampleOrderCredit', done ? 'Skipped' : 'Pending')]
        : [step(1, 'SampleCreateLoan', 'Succeeded'), step(2, 'SampleSubmit', r.polls >= 2 ? 'Succeeded' : 'Running'), step(3, 'SampleOrderCredit', done ? 'Succeeded' : 'Pending')];
      return json_(res, 200, {
        runId: runAt[1], scenarioId: r.sc?.scenarioId, versionNumber: r.sc?.versionNumber, environment: r.env,
        status: done ? (failing ? 'Failed' : 'Succeeded') : 'Running', startedAtUtc: '2026-01-05T00:00:00Z', ...(done ? { finishedAtUtc: '2026-01-05T00:01:00Z' } : {}),
        stepRuns: steps,
        ...(done && !failing ? { finalArtifacts: { loanGuids: [r.loan], documentGuids: [], creditReportGuids: [] } } : {}),
        ...(done && failing ? { runError: { message: 'Sample run failed at step 2', stackTrace: 'at Sample.Secret.Stack()' } } : {}),
      });
    }
    // v2 §143: its API description, a scenario as a template, and a new scenario (logged by name, folder and step count).
    if (req.method === 'GET' && p === '/swagger/v1/swagger.json') return json_(res, 200, SAMPLE_OPENAPI);
    const one = /^\/api\/scenarios\/([\w-]+)(?:\/versions\/(\d+))?$/.exec(p);
    if (req.method === 'GET' && one) {
      const sc = SCENARIOS.find((s) => s.scenarioId === one[1]);
      if (!sc) return json_(res, 404, { title: 'No such scenario' });
      return json_(res, 200, { ...sc, steps: sc.steps ?? [{ order: 1, typeId: 'SampleCreateLoan', settings: { loanType: 'Sample' } }, { order: 2, typeId: 'SampleSubmit', settings: {} }, { order: 3, typeId: 'SampleOrderCredit', settings: { bureau: 'Sample' } }] });
    }
    if (req.method === 'POST' && p === '/api/scenarios') {
      if (!json || typeof json !== 'object' || typeof json.name !== 'string' || !Array.isArray(json.steps) || !json.steps.length) return json_(res, 400, { title: 'A scenario needs a name and at least one step' });
      const sc = { scenarioId: `sc-${guid().slice(0, 8)}`, versionNumber: 1, name: json.name, createdAtUtc: '2026-01-06T00:00:00Z', isLocked: false, tags: Array.isArray(json.tags) ? json.tags : [], ...(json.folder ? { folder: json.folder } : {}), steps: json.steps };
      SCENARIOS.push(sc);
      log({ tool: 'builder-create', name: json.name, folder: json.folder ?? null, steps: json.steps.length });
      return json_(res, 201, { scenarioId: sc.scenarioId, versionNumber: 1 });
    }
    // Anything else (versions, copy, lock, delete, resume, tokens) is never meant to be reached: logged above, flagged here.
    log({ tool: 'builder', flagged: true, method: req.method, path: p, agent: req.headers['user-agent'] ?? '' });
    return json_(res, 404, { title: 'Not a stand-in endpoint' });
  });
}
const json_ = (res, status, o) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };

http.createServer(setTool('dev')).listen(port, '127.0.0.1');
http.createServer(setTool('uat')).listen(port + 1, '127.0.0.1');
http.createServer(builder).listen(port + 3, '127.0.0.1');
http.createServer(lookup).listen(port + 2, '127.0.0.1', () => console.log(`verify stand-ins on ${port}, ${port + 1}, ${port + 2}, ${port + 3}`));
