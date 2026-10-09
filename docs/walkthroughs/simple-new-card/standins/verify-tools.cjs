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

function lookup(req, res) {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const form = new URLSearchParams(body);
    log({ tool: 'lookup', method: req.method, path: new URL(req.url, 'http://x').pathname, fields: [...form.keys()], advanced: form.get('AdvancedFetch'), env: form.get('Environment'), ids: (form.get('FieldsToFetch') ?? '').split('\r\n').filter(Boolean), agent: req.headers['user-agent'] ?? '' });
    res.setHeader('content-type', 'text/html');
    const page = (table) => `<html><body><form method="post"><select name="Environment"><option>Dev</option><option>Uat</option><option>Prod</option></select><input name="RecordId" />${table}</form></body></html>`;
    if (req.method !== 'POST' || !/^(5001|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(form.get('RecordId') ?? '')) return res.end(page('<p>Enter a record.</p>'));
    const ids = (form.get('FieldsToFetch') ?? '').split('\r\n').filter(Boolean);
    const rows = ids.map((id) => {
      const v = { '1000': '12.50', 'CX.SAMPLE.ONE': 'Yes & no', 'GROUP.NAME.ROLE NAME': 'Sample role', 'CX.EMPTY': '' }[id.toUpperCase()];
      if (v === undefined) return `<tr style="background-color: salmon"><td>${id}</td><td>(Field does not exist)</td><td></td></tr>`;
      const e = v.replace(/&/g, '&amp;');
      return `<tr><td>${id}</td><td>${e}</td><td><input type="hidden" name="Fields[${id}].Value" value="${e}" /><input type="hidden" name="Fields[${id}].Exists" value="True" /><input type="hidden" name="Fields[${id}].ReadOnly" value="${id === '1000' ? 'True' : 'False'}" /><input type="checkbox" name="Fields[${id}].Update" /><input name="Fields[${id}].NewValue" /></td></tr>`;
    }).join('');
    res.end(page(`<table id="FieldResults"><tr><th>Field</th><th>Value</th><th>Update</th></tr>${rows}</table>`));
  });
}

// The scenario runner (§133): loopback, JSON, camelCase, enums as strings.
const SCENARIOS = [
  { scenarioId: 'sc-purchase', versionNumber: 3, name: 'Sample purchase', createdAtUtc: '2026-01-02T03:04:05Z', isLocked: false, tags: ['fha', 'smoke'] },
  { scenarioId: 'sc-refi', versionNumber: 1, name: 'Sample refinance', createdAtUtc: '2026-01-03T03:04:05Z', isLocked: false, tags: ['va'] },
  { scenarioId: 'sc-failing', versionNumber: 2, name: 'Sample failing', createdAtUtc: '2026-01-04T03:04:05Z', isLocked: true, tags: ['broken'] },
];
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
    // Anything else (create, versions, copy, lock, delete, resume, tokens) is never meant to be reached: logged above, flagged here.
    log({ tool: 'builder', flagged: true, method: req.method, path: p, agent: req.headers['user-agent'] ?? '' });
    return json_(res, 404, { title: 'Not a stand-in endpoint' });
  });
}
const json_ = (res, status, o) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };

http.createServer(setTool('dev')).listen(port, '127.0.0.1');
http.createServer(setTool('uat')).listen(port + 1, '127.0.0.1');
http.createServer(builder).listen(port + 3, '127.0.0.1');
http.createServer(lookup).listen(port + 2, '127.0.0.1', () => console.log(`verify stand-ins on ${port}, ${port + 1}, ${port + 2}, ${port + 3}`));
