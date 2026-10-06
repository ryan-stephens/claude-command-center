import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guard, LookupTool, parseLookup, readSet, readValidate, readVerifyFile, Requester, SET_TTL_MS, SetTool, unwrap, htmlText, VerifyFileWatch, type Transport, type VerifyRequest } from './verify.ts';
import type { VerifyConfig } from '../shared/verify.ts';

// Made-up tools: nothing here is a real host, field or value.
const CFG: VerifyConfig = {
  set: { urls: { dev: 'https://set-dev.example.invalid', uat: 'https://set-uat.example.invalid/' } },
  lookup: { url: 'https://lookup.example.invalid/Lookup', recordField: 'RecordId' },
};

const ok = (payload: unknown) => JSON.stringify({ Successful: true, Payload: payload });
const SET = { Id: 7, Description: 'Sample set', Number: 42, Fields: [
  { Id: 1, FieldName: 'Sample one', SampleKey: 'CX.SAMPLE.ONE', IsPII: false, RdbType: 'varchar', RdbFieldSize: 20, Format: 'STRING', Options: null },
  { Id: 2, FieldName: 'Amount', SampleKey: '1000', IsPII: false, RdbType: 'decimal', RdbFieldSize: 10, Format: 'DECIMAL_2', Options: ['A', 'B'] },
] };

/** A fake transport that answers like the tools and records every request it was handed. */
function fake(answer: (r: VerifyRequest) => { status: number; body: string; auth?: string }) {
  const seen: VerifyRequest[] = [];
  const t: Transport = async (r) => { seen.push(r); return answer(r); };
  return { t, seen };
}

function tools(answer: (r: VerifyRequest) => { status: number; body: string; auth?: string }, cfg: VerifyConfig = CFG, now = () => 1_000) {
  const f = fake(answer);
  const w = fake(answer);
  const req = new Requester(() => cfg, { fetch: f.t, windows: w.t }, 'win32');
  return { set: new SetTool(() => cfg, req, now), lookup: new LookupTool(() => cfg, req), seen: f.seen, windows: w.seen };
}

const PAGE = (rows: string) => `<html><body><form method="post"><select name="Environment"><option>Dev</option></select>
<table class="grid" id="FieldResults"><thead><tr><th>Field</th><th>Value</th><th>Update</th></tr></thead><tbody>${rows}</tbody></table>
<input type="checkbox" name="UpdateAll" /></form></body></html>`;
const FOUND = `<tr><td>1000</td><td>12.50</td><td><input type="hidden" name="Fields[1000].Value" value="12.50" /><input type="hidden" name="Fields[1000].Exists" value="True" /><input type="hidden" name="Fields[1000].ReadOnly" value="False" /><input type="checkbox" name="Fields[1000].Update" /><input name="Fields[1000].NewValue" /></td></tr>
<tr><td>CX.SAMPLE.ONE</td><td>Tom &amp; Jerry</td><td><input value="Tom &amp; Jerry" type="hidden" name="Fields[CX.SAMPLE.ONE].Value"><input type="hidden" name="Fields[CX.SAMPLE.ONE].ReadOnly" value="True"></td></tr>
<tr style="background-color: salmon"><td>CX.MADE.UP</td><td>(Field does not exist)</td><td></td></tr>`;

test('the machine’s Verify file: missing says nothing, a BOM is fine, junk is cleaned out, bad JSON and UTF-16 say why', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-verify-'));
  const f = join(dir, 'verify.json');
  assert.deepEqual(readVerifyFile(f), { file: f, config: {} });
  writeFileSync(f, '\uFEFF' + JSON.stringify({ set: { name: 'Sample set', urls: { dev: 'https://set-dev.example.invalid/', qa: 'https://x.example.invalid' }, addPage: '/addtoset' }, lookup: { name: 'Sample lookup', url: 'ftp://no', recordField: 'RecordId' }, extra: 1 }));
  assert.deepEqual(readVerifyFile(f).config, { set: { name: 'Sample set', urls: { dev: 'https://set-dev.example.invalid' }, addPage: 'addtoset' }, lookup: { name: 'Sample lookup', recordField: 'RecordId' } });
  writeFileSync(f, '{ not json');
  assert.match(readVerifyFile(f).problem ?? '', /isn’t JSON/);
  writeFileSync(f, Buffer.from('{}', 'utf16le'));
  assert.match(readVerifyFile(f).problem ?? '', /UTF-16/);
});

test('the file is read again only when it changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-verify-'));
  const f = join(dir, 'verify.json');
  const w = new VerifyFileWatch(f);
  assert.equal(w.now().changed, false, 'no file, and still none');
  writeFileSync(f, JSON.stringify({ set: { name: 'A' } }));
  const a = w.now();
  assert.equal(a.changed, true);
  assert.equal(a.config.set?.name, 'A');
  assert.equal(w.now().changed, false);
  writeFileSync(f, JSON.stringify({ set: { name: 'Bee' } }));
  assert.equal(w.now().config.set?.name, 'Bee');
});

test('unwrap: the payload when Successful, what the tool said when not, and non-JSON', () => {
  assert.deepEqual(unwrap(ok({ a: 1 })), { ok: true, payload: { a: 1 } });
  assert.deepEqual(unwrap(JSON.stringify({ Successful: false, Payload: 'Field XYZ not found' })), { ok: false, message: 'Field XYZ not found' });
  assert.equal(unwrap('<html>sign in</html>').ok, false);
  assert.equal(unwrap('null').ok, false);
});

test('readValidate: the in-set flag is whichever ExistsIn… key the tool sends', () => {
  const r = readValidate('1000', { Exists: true, FieldName: 'Amount', Format: 'DECIMAL_2', Options: [], ExistsInSampleSet: false, FieldId: '1000', Message: null });
  assert.deepEqual(r, { id: '1000', known: true, exists: true, inSet: false, fieldName: 'Amount', format: 'DECIMAL_2' });
  assert.deepEqual(readValidate('X', { Exists: 'True', ExistsInOther: 'true', Options: [{ Value: 'Y' }, 'N'] }).options, ['Y', 'N']);
});

test('readSet: entries by the field id key, found as the one unknown string key, or named', () => {
  const v = readSet(SET, undefined, 5);
  assert.deepEqual(v.info, { number: '42', description: 'Sample set', fields: 2, fetchedAt: 5 });
  assert.equal(v.byId.get('CX.SAMPLE.ONE')?.format, 'STRING');
  assert.deepEqual(v.byId.get('1000')?.options, ['A', 'B']);
  assert.equal(readSet(SET, 'FieldName').byId.has('AMOUNT'), true, 'a named key wins');
  assert.equal(readSet({}).info.fields, 0);
});

test('validate: a known id, an unknown one (Successful false), and the id parameter', async () => {
  const t = tools((r) => ({ status: 200, body: r.url.includes('MADEUP') ? JSON.stringify({ Successful: false, Payload: 'Not a field' }) : ok({ Exists: true, ExistsInX: true, FieldName: 'Amount' }) }));
  assert.deepEqual(await t.set.validate('dev', '1000'), { id: '1000', known: true, exists: true, inSet: true, fieldName: 'Amount' });
  assert.deepEqual(await t.set.validate('uat', 'MADEUP'), { id: 'MADEUP', known: false, message: 'Not a field' });
  assert.equal(t.seen[0].url, 'https://set-dev.example.invalid/Home/ValidateField?encompassId=1000');
  assert.equal(t.seen[1].url, 'https://set-uat.example.invalid/Home/ValidateField?encompassId=MADEUP', 'a trailing slash on the base is dropped');
  await assert.rejects(t.set.validate('prod', '1000'), /no prod address/);
});

test('the set is cached for ten minutes, read once when asked twice at once, and read again on refresh', async () => {
  let now = 1_000;
  const t = tools(() => ({ status: 200, body: ok(SET) }), CFG, () => now);
  await Promise.all([t.set.set('dev'), t.set.set('dev')]);
  assert.equal(t.seen.length, 1, 'two at once: one read');
  now += SET_TTL_MS - 1;
  assert.deepEqual((await t.set.has('dev', ['cx.sample.one', 'NOPE'])).map((x) => x.inSet), [true, false]);
  assert.equal(t.seen.length, 1, 'still cached');
  now += 2;
  await t.set.set('dev');
  assert.equal(t.seen.length, 2, 'expired: read again');
  await t.set.set('dev', true);
  assert.equal(t.seen.length, 3, 'refresh reads again');
  const bad = tools(() => ({ status: 200, body: JSON.stringify({ Successful: false, Payload: 'Down' }) }));
  await assert.rejects(bad.set.set('dev'), /Down/);
});

test('parseLookup: hidden inputs win, entities decode, a salmon row is missing, update fields are ignored', () => {
  const r = parseLookup(PAGE(FOUND));
  assert.equal(r.found, true);
  assert.deepEqual(r.fields, [
    { id: '1000', value: '12.50', exists: true, readOnly: false },
    { id: 'CX.SAMPLE.ONE', value: 'Tom & Jerry', exists: true, readOnly: true },
    { id: 'CX.MADE.UP', value: '', exists: false },
  ]);
  assert.deepEqual(parseLookup('<html><form>Record not found</form></html>'), { found: false, fields: [] }, 'no table: no record');
  assert.deepEqual(parseLookup(PAGE('')).fields, [], 'a table with only its header');
  assert.equal(parseLookup(PAGE('<tr><td>2000</td><td>(Field does not exist)</td></tr>')).fields[0].exists, false, 'the words alone mark it missing');
  assert.equal(htmlText(' a&nbsp;&#x41;&#66; <b>c</b> '), 'a AB c');
});

test('lookup: one POST of the form fields, CRLF between ids, Advanced off by default; never the raw page', async () => {
  const t = tools(() => ({ status: 200, body: PAGE(FOUND) }));
  const r = await t.lookup.fetch('dev', ' 5001 ', ['1000', 'CX.SAMPLE.ONE', 'CX.MADE.UP']);
  assert.deepEqual(Object.keys(r).sort(), ['env', 'fields', 'found', 'recordId']);
  assert.equal(r.recordId, '5001');
  assert.equal(t.seen.length, 1);
  assert.deepEqual(t.seen[0], { method: 'POST', url: 'https://lookup.example.invalid/Lookup', form: [['Environment', 'Dev'], ['RecordId', '5001'], ['AdvancedFetch', 'false'], ['FieldsToFetch', '1000\r\nCX.SAMPLE.ONE\r\nCX.MADE.UP']] });
  await t.lookup.fetch('prod', '5001', ['1000'], true);
  assert.deepEqual(t.seen[1].form?.[0], ['Environment', 'Prod']);
  assert.deepEqual(t.seen[1].form?.[2], ['AdvancedFetch', 'true']);
  const none = tools(() => ({ status: 200, body: '<html>nothing</html>' }));
  assert.equal((await none.lookup.fetch('dev', '9', ['1000'])).found, false);
  await assert.rejects(tools(() => ({ status: 302, body: '' })).lookup.fetch('dev', '9', ['1']), /redirect/);
  await assert.rejects(t.lookup.fetch('dev', 'x y', ['1']), /doesn’t look like/);
  await assert.rejects(new LookupTool(() => ({}), new Requester(() => ({}))).fetch('dev', '1', ['1']), /has no address/);
  await assert.rejects(new LookupTool(() => ({ lookup: { name: 'Sample lookup', url: 'https://l.example.invalid/F' } }), new Requester(() => ({}))).fetch('dev', '1', ['1']), /Sample lookup needs "recordField"/, 'named in the error');
});

test('a Windows sign-in (401 Negotiate) is answered as you through the other transport, when auth allows', async () => {
  const t = tools((r) => ({ status: 401, body: '', auth: 'Negotiate, NTLM', ...(r.method === 'POST' ? {} : {}) }));
  await assert.rejects(t.lookup.fetch('dev', '1', ['1000']), /sign-in/);
  assert.equal(t.windows.length, 1, 'auto: tried as you once');
  const off = tools(() => ({ status: 401, body: '', auth: 'Negotiate' }), { ...CFG, lookup: { ...CFG.lookup, auth: 'none' } });
  await assert.rejects(off.lookup.fetch('dev', '1', ['1000']), /sign-in/);
  assert.equal(off.windows.length, 0, 'none: never');
});

test('guard: only SetVersion, ValidateField and the lookup form POST; never a Save, an update or another host', () => {
  const allowed: VerifyRequest[] = [
    { method: 'GET', url: 'https://set-dev.example.invalid/Home/SetVersion' },
    { method: 'GET', url: 'https://set-uat.example.invalid/Home/ValidateField?encompassId=1000' },
    { method: 'POST', url: 'https://lookup.example.invalid/Lookup', form: [['Environment', 'Dev'], ['RecordId', '1'], ['AdvancedFetch', 'false'], ['FieldsToFetch', '1']] },
  ];
  for (const r of allowed) assert.doesNotThrow(() => guard(r, CFG), r.url);
  const refused: VerifyRequest[] = [
    { method: 'POST', url: 'https://set-dev.example.invalid/Home/Save', form: [] },
    { method: 'GET', url: 'https://set-dev.example.invalid/Home/Save' },
    { method: 'GET', url: 'https://set-dev.example.invalid/Home/AddToSet' },
    { method: 'GET', url: 'https://set-dev.example.invalid/Home/ValidateField/../Save' },
    { method: 'GET', url: 'https://set-dev.example.invalid/Home/SetVersionSave' },
    { method: 'GET', url: 'https://elsewhere.example.invalid/Home/SetVersion' },
    { method: 'GET', url: 'https://lookup.example.invalid/Lookup' },
    { method: 'POST', url: 'https://lookup.example.invalid/Lookup', form: [['Fields[1000].NewValue', '9'], ['Fields[1000].Update', 'true']] },
    { method: 'POST', url: 'https://lookup.example.invalid/Lookup/Update', form: [['Environment', 'Dev']] },
    { method: 'POST', url: 'https://set-dev.example.invalid/Home/SetVersion', form: [] },
    { method: 'PUT' as 'GET', url: 'https://set-dev.example.invalid/Home/SetVersion' },
  ];
  for (const r of refused) assert.throws(() => guard(r, CFG), /refused/, `${r.method} ${r.url}`);
});

test('every request the tools make passes the guard: nothing but reads and the lookup form', async () => {
  const t = tools((r) => ({ status: 200, body: r.method === 'POST' ? PAGE(FOUND) : r.url.includes('SetVersion') ? ok(SET) : ok({ Exists: true }) }));
  await t.set.validate('dev', '1000');
  await t.set.set('uat', true);
  await t.set.has('dev', ['1000']);
  await t.lookup.fetch('uat', '1', ['1000', 'CX.SAMPLE.ONE'], true);
  assert.equal(t.seen.length, 4);
  for (const r of t.seen) {
    assert.doesNotThrow(() => guard(r, CFG));
    assert.ok(r.method === 'GET' ? /\/Home\/(SetVersion|ValidateField)/.test(r.url) : r.url === CFG.lookup!.url, `${r.method} ${r.url}`);
    assert.ok(!/save|update|add/i.test(r.url), r.url);
    for (const [k] of r.form ?? []) assert.ok(!/update|new/i.test(k), k);
  }
});
