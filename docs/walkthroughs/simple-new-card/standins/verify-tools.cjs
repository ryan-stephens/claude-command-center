// Stand-ins for Verify's two tools (PLAN §105), with made-up data: the field set tool (dev on PORT,
// uat on PORT+1) and the record lookup (PORT+2). Every request is appended to the log file named
// (method, path, form field names, user agent), so a walkthrough can check what the app sent.
// Dev's set has 1000 and CX.SAMPLE.ONE; UAT's only 1000. Record 5001 exists; any other doesn't.
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
    if (req.method !== 'POST' || form.get('RecordId') !== '5001') return res.end(page('<p>Enter a record.</p>'));
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

http.createServer(setTool('dev')).listen(port, '127.0.0.1');
http.createServer(setTool('uat')).listen(port + 1, '127.0.0.1');
http.createServer(lookup).listen(port + 2, '127.0.0.1', () => console.log(`verify stand-ins on ${port}, ${port + 1}, ${port + 2}`));
