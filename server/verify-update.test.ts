import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeUpdate, MAX_SESSIONS, parseUpdateForm, readUpdateAnswer, SESSION_TTL_MS, UpdateSessions, type UpdateSession } from './verify-update.ts';
import { guard, LookupTool, Requester, type Transport, type VerifyRequest } from './verify.ts';
import { FIELDS_TO_FETCH, lookupPage, RECORD } from './verify.fixture.ts';
import type { VerifyConfig } from '../shared/verify.ts';

// A made-up record lookup: nothing here is a real host, record, field or value.
const LOOKUP = 'https://lookup.example.invalid/App/Home/FetchFields';
const UPDATE = 'https://lookup.example.invalid/App/Home/UpdateFields';
const CFG: VerifyConfig = { lookup: { name: 'Sample lookup', url: LOOKUP, recordField: 'RecordGuid', updateUrl: UPDATE, allowUpdate: true, updateFields: ['RecordNumber', 'RecordFolder'] } };
const OFF: VerifyConfig = { lookup: { ...CFG.lookup!, allowUpdate: undefined } };

const session = (env: 'dev' | 'uat' | 'prod' = 'dev', page = lookupPage(), cfg = CFG): UpdateSession => ({ env, recordId: RECORD, form: parseUpdateForm(page, cfg)!, at: 0 });

test('parseUpdateForm: only the update form; its controls in page order, the editable rows, options, Environment', () => {
  const f = parseUpdateForm(lookupPage(), CFG)!;
  assert.equal(f.problem, undefined, 'the role and move forms (with their own selects) are never read');
  assert.deepEqual(f.editable, ['1000', 'CX.SAMPLE.ONE', 'Group.Name.Role Name'], 'a read-only row and a missing one have no checkbox');
  assert.deepEqual(f.options, { 'CX.SAMPLE.ONE': ['', 'Yes', 'No'] });
  assert.equal(f.envValue, 'Dev');
  assert.deepEqual(f.parts.slice(0, 3), [{ kind: 'value', id: '1000' }, { kind: 'check', id: '1000' }, { kind: 'hidden', name: 'FieldsToUpdate[1000].ShouldUpdate', value: 'false' }]);
  assert.deepEqual(f.parts.find((p) => p.kind === 'hidden' && p.name === 'FieldsToFetch'), { kind: 'hidden', name: 'FieldsToFetch', value: FIELDS_TO_FETCH }, 'line breaks kept as CRLF');
  assert.deepEqual(f.parts.find((p) => p.kind === 'hidden' && p.name === 'Fields[Group.Name.Role Name].Value'), { kind: 'hidden', name: 'Fields[Group.Name.Role Name].Value', value: 'Tom & Jerry' }, 'an id with dots and a space, a value decoded');
  assert.equal(parseUpdateForm(lookupPage(), { lookup: { ...CFG.lookup!, updateUrl: 'https://lookup.example.invalid/App/Home/Other' } }), undefined, 'no form at that address');
  assert.match(parseUpdateForm(lookupPage(), { lookup: { ...CFG.lookup!, updateFields: undefined } })!.problem ?? '', /RecordNumber[\s\S]*updateFields/, 'a hidden field it isn’t told of: not sent, and said why');
  assert.match(parseUpdateForm(lookupPage().replace('<button type="submit">Update</button>', '<input type="hidden" name="__RequestVerificationToken" value="x" />'), CFG)!.problem ?? '', /__RequestVerificationToken/);
});

test('composeUpdate: a text field and a select, exactly as the browser sends them, in page order', () => {
  const form = composeUpdate(session(), [{ id: 'CX.SAMPLE.ONE', value: 'No' }, { id: 'Group.Name.Role Name', value: 'Jerry' }], CFG);
  assert.deepEqual(form, [
    ['FieldsToUpdate[1000].ShouldUpdate', 'false'],
    ['Fields[1000].Value', '1,250.00'], ['Fields[1000].Exists', 'True'], ['Fields[1000].ReadOnly', 'False'],
    ['FieldsToUpdate[CX.SAMPLE.ONE].Value', 'No'], ['FieldsToUpdate[CX.SAMPLE.ONE].ShouldUpdate', 'true'], ['FieldsToUpdate[CX.SAMPLE.ONE].ShouldUpdate', 'false'],
    ['Fields[CX.SAMPLE.ONE].Value', 'Yes'], ['Fields[CX.SAMPLE.ONE].Exists', 'True'], ['Fields[CX.SAMPLE.ONE].ReadOnly', 'False'],
    ['Fields[CX.SAMPLE.ONE].Options[0]', ''], ['Fields[CX.SAMPLE.ONE].Options[1]', 'Yes'], ['Fields[CX.SAMPLE.ONE].Options[2]', 'No'],
    ['FieldsToUpdate[Group.Name.Role Name].Value', 'Jerry'], ['FieldsToUpdate[Group.Name.Role Name].ShouldUpdate', 'true'], ['FieldsToUpdate[Group.Name.Role Name].ShouldUpdate', 'false'],
    ['Fields[Group.Name.Role Name].Value', 'Tom & Jerry'], ['Fields[Group.Name.Role Name].Exists', 'True'], ['Fields[Group.Name.Role Name].ReadOnly', 'False'],
    ['Fields[2000].Value', 'Locked'], ['Fields[2000].Exists', 'True'], ['Fields[2000].ReadOnly', 'True'],
    ['Fields[CX.MADE.UP].Value', ''], ['Fields[CX.MADE.UP].Exists', 'False'],
    ['RecordGuid', RECORD], ['RecordNumber', 'SAMPLE-0001'], ['RecordFolder', 'Sample Folder'],
    ['Environment', 'Dev'], ['FieldsToFetch', FIELDS_TO_FETCH],
    ['AssignedRoles[Sample Role].Id', '7'], ['AssignedRoles[Sample Role].Name', 'Sample Person'],
  ]);
  assert.ok(!form.some(([k]) => k.startsWith('FieldsToUpdate[2000]') || k.startsWith('FieldsToUpdate[CX.MADE.UP]')), 'a read-only or missing row sends no FieldsToUpdate');
  const body = new URLSearchParams(form).toString();
  assert.ok(body.includes('FieldsToUpdate%5BGroup.Name.Role+Name%5D.Value=Jerry'), 'url-encoded as a form, the space a +');
  assert.ok(body.includes('FieldsToFetch=1000%0D%0ACX.SAMPLE.ONE'));
  // A clear sends an empty value; on a select only when the empty choice is one of its options.
  const cleared = composeUpdate(session(), [{ id: '1000', value: '', clear: true }, { id: 'CX.SAMPLE.ONE', value: '', clear: true }], CFG);
  assert.deepEqual(cleared.slice(0, 3), [['FieldsToUpdate[1000].Value', ''], ['FieldsToUpdate[1000].ShouldUpdate', 'true'], ['FieldsToUpdate[1000].ShouldUpdate', 'false']]);
});

test('composeUpdate refuses, in plain words: Prod, a Prod form, an unknown, read-only or missing field, a value not in its options, an empty edit, twice, too many', () => {
  const ok = { id: 'Group.Name.Role Name', value: 'Jerry' };
  const cases: [string, () => unknown, RegExp][] = [
    ['a Prod session', () => composeUpdate(session('prod'), [ok], CFG), /Dev and UAT only/],
    ['a Prod Environment value on the form', () => composeUpdate(session('dev', lookupPage({ env: 'Prod' })), [ok], CFG), /isn’t for Dev or UAT/],
    ['a UAT form on a Dev session', () => composeUpdate(session('dev', lookupPage({ env: 'Uat' })), [ok], CFG), /isn’t for Dev or UAT/],
    ['an unknown id', () => composeUpdate(session(), [{ id: 'CX.NOPE', value: '1' }], CFG), /can’t be changed here/],
    ['a read-only id', () => composeUpdate(session(), [{ id: '2000', value: '1' }], CFG), /2000 can’t be changed here/],
    ['a missing id', () => composeUpdate(session(), [{ id: 'CX.MADE.UP', value: '1' }], CFG), /can’t be changed here/],
    ['a value not in the options', () => composeUpdate(session(), [{ id: 'CX.SAMPLE.ONE', value: 'Maybe' }], CFG), /isn’t one of its options/],
    ['an empty value without clear', () => composeUpdate(session(), [{ id: '1000', value: '' }], CFG), /isn’t a change/],
    ['a clear with a value', () => composeUpdate(session(), [{ id: '1000', value: 'x', clear: true }], CFG), /a clear has no value/],
    ['twice', () => composeUpdate(session(), [ok, ok], CFG), /staged twice/],
    ['nothing', () => composeUpdate(session(), [], CFG), /Nothing is staged/],
    ['more than fifty', () => composeUpdate(session(), Array.from({ length: 51 }, () => ok), CFG), /At most 50/],
    ['a form with a field it isn’t told of', () => composeUpdate(session('dev', lookupPage(), { lookup: { ...CFG.lookup!, updateFields: undefined } }), [ok], CFG), /RecordNumber/],
  ];
  for (const [why, f, re] of cases) assert.throws(f, re, why);
});

test('guard, writes: one POST to updateUrl, only with updates on and marked a write, only the update form’s names', () => {
  const good = composeUpdate(session(), [{ id: 'CX.SAMPLE.ONE', value: 'No' }], CFG);
  assert.doesNotThrow(() => guard({ kind: 'write', method: 'POST', url: UPDATE, form: good }, CFG));
  const refused: [string, VerifyRequest, VerifyConfig?][] = [
    ['updates off', { kind: 'write', method: 'POST', url: UPDATE, form: good }, OFF],
    ['no updateUrl', { kind: 'write', method: 'POST', url: UPDATE, form: good }, { lookup: { ...CFG.lookup!, updateUrl: undefined } }],
    ['not marked a write', { method: 'POST', url: UPDATE, form: good }],
    ['the role form', { kind: 'write', method: 'POST', url: 'https://lookup.example.invalid/App/Home/AssignRole', form: [['Environment', 'Dev']] }],
    ['the move form', { kind: 'write', method: 'POST', url: 'https://lookup.example.invalid/App/Home/MoveRecord', form: [['Environment', 'Dev']] }],
    ['the fetch address', { kind: 'write', method: 'POST', url: LOOKUP, form: good }],
    ['a query on it', { kind: 'write', method: 'POST', url: `${UPDATE}?x=1`, form: good }],
    ['a name outside the list', { kind: 'write', method: 'POST', url: UPDATE, form: [...good, ['RoleToAssign', 'Sample Role']] }],
    ['a target folder', { kind: 'write', method: 'POST', url: UPDATE, form: [['TargetFolder', 'Other Folder']] }],
    ['an anti-forgery token it wasn’t told of', { kind: 'write', method: 'POST', url: UPDATE, form: [['__RequestVerificationToken', 'x']] }],
    ['a GET to updateUrl', { method: 'GET', url: UPDATE }],
    ['a write as a GET', { kind: 'write', method: 'GET', url: UPDATE }],
  ];
  for (const [why, r, cfg] of refused) assert.throws(() => guard(r, cfg ?? CFG), /refused/, why);
});

test('sessions: ten minutes, at most five, one per record, gone once used', () => {
  let now = 0;
  const s = new UpdateSessions(() => now);
  const form = parseUpdateForm(lookupPage(), CFG)!;
  const a = s.add({ env: 'dev', recordId: 'A', form });
  assert.ok(s.get(a));
  const a2 = s.add({ env: 'dev', recordId: 'a', form });
  assert.equal(s.get(a), undefined, 'the same record fetched again replaces it');
  assert.ok(s.get(a2));
  assert.ok(s.get(s.add({ env: 'uat', recordId: 'A', form })), 'another environment is another session');
  for (let i = 0; i < 6; i++) s.add({ env: 'dev', recordId: `R${i}`, form });
  assert.equal(s.size, MAX_SESSIONS);
  now += SESSION_TTL_MS;
  assert.equal(s.size, 0, 'ten minutes on: all gone');
});

function lookup(answer: (r: VerifyRequest) => { status: number; body: string }, cfg: VerifyConfig = CFG, sessions = new UpdateSessions()) {
  const seen: VerifyRequest[] = [];
  const t: Transport = async (r) => { seen.push(r); return answer(r); };
  return { tool: new LookupTool(() => cfg, new Requester(() => cfg, { fetch: t, windows: t }, 'linux'), sessions), seen, sessions };
}

const SUCCESS = (n: number, link = `/App/Home/Watch/${encodeURIComponent(RECORD)}`) => lookupPage({ success: `Update request was successfully sent to the sample writer. ${n} field(s) to update were sent. Please allow a couple minutes for the update.`, info: `Watch it <a href="${link}">here</a>.` });

test('LookupTool: a Dev fetch with updates on keeps a session; Prod, updates off, a check-after fetch and a page without the form don’t', async () => {
  const t = lookup(() => ({ status: 200, body: lookupPage() }));
  const r = await t.tool.fetch('dev', RECORD, ['1000', 'CX.SAMPLE.ONE'], true);
  assert.equal(r.updatable, true);
  assert.equal(typeof r.token, 'string');
  assert.deepEqual(r.editable, ['1000', 'CX.SAMPLE.ONE', 'Group.Name.Role Name']);
  assert.equal(t.sessions.size, 1);
  const again = await t.tool.fetch('dev', RECORD, ['1000'], false, { session: false });
  assert.deepEqual([again.updatable, again.token, t.sessions.size], [false, undefined, 1], 'a check after an update neither makes nor replaces a session');
  assert.ok(t.sessions.get(r.token!), 'the first is still there');
  assert.equal((await t.tool.fetch('prod', RECORD, ['1000'])).updatable, false);
  assert.equal((await lookup(() => ({ status: 200, body: lookupPage() }), OFF).tool.fetch('dev', RECORD, ['1000'])).updatable, false);
  const none = await lookup(() => ({ status: 200, body: lookupPage().replace('/App/Home/UpdateFields', '/App/Home/Elsewhere') })).tool.fetch('uat', RECORD, ['1000']);
  assert.deepEqual([none.updatable, /no update form/.test(none.updateNote ?? '')], [false, true]);
});

test('LookupTool.update: one write to updateUrl, then the session is gone; the answer read for its count and progress link only', async () => {
  const t = lookup((r) => ({ status: 200, body: r.kind === 'write' ? SUCCESS(2) : lookupPage() }));
  const { token } = await t.tool.fetch('dev', RECORD, ['1000'], true);
  const out = await t.tool.update(token!, [{ id: 'CX.SAMPLE.ONE', value: 'No' }, { id: 'Group.Name.Role Name', value: 'Jerry' }]);
  assert.deepEqual(out, { sent: 2, watchUrl: `https://lookup.example.invalid/App/Home/Watch/${encodeURIComponent(RECORD)}` });
  const writes = t.seen.filter((r) => r.kind === 'write');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, UPDATE);
  assert.doesNotThrow(() => guard(writes[0], CFG));
  assert.ok(!t.seen.some((r) => /AssignRole|MoveRecord/.test(r.url)), 'never the role or move forms');
  await assert.rejects(t.tool.update(token!, [{ id: '1000', value: '1' }]), /fetch the record again/, 'one use');
  assert.equal(t.seen.filter((r) => r.kind === 'write').length, 1);
  // Refused before anything is sent: updates off, a read-only field.
  const off = lookup(() => ({ status: 200, body: lookupPage() }), OFF);
  await assert.rejects(off.tool.update('x', [{ id: '1000', value: '1' }]), /off on this machine/);
  const ro = lookup(() => ({ status: 200, body: lookupPage() }));
  const tk = (await ro.tool.fetch('dev', RECORD, ['2000'], true)).token!;
  await assert.rejects(ro.tool.update(tk, [{ id: '2000', value: '1' }]), /can’t be changed here/);
  assert.ok(ro.sessions.get(tk), 'a refused change leaves the session for a corrected one');
  assert.equal(ro.seen.filter((r) => r.kind === 'write').length, 0);
  // An answer without the confirmation, or another count, or a redirect: not confirmed, and none of the page is passed on.
  for (const body of [lookupPage(), SUCCESS(1)]) {
    const x = lookup((r) => ({ status: 200, body: r.kind === 'write' ? body : lookupPage() }));
    const k = (await x.tool.fetch('dev', RECORD, ['1000'], true)).token!;
    await assert.rejects(x.tool.update(k, [{ id: 'CX.SAMPLE.ONE', value: 'No' }, { id: '1000', value: '2' }]), (e: Error) => e.message === 'The tool didn’t confirm the update.');
  }
  const redirect = lookup((r) => ({ status: r.kind === 'write' ? 302 : 200, body: lookupPage() }));
  const k3 = (await redirect.tool.fetch('dev', RECORD, ['1000'], true)).token!;
  await assert.rejects(redirect.tool.update(k3, [{ id: '1000', value: '2' }]), /didn’t confirm/);
});

test('readUpdateAnswer: the count must match; the progress link only on the lookup’s host and ending in the record', () => {
  assert.deepEqual(readUpdateAnswer(SUCCESS(1), 1, CFG, RECORD).sent, 1);
  assert.equal(readUpdateAnswer(SUCCESS(1, 'https://elsewhere.example.invalid/Watch/' + RECORD), 1, CFG, RECORD).watchUrl, undefined, 'another host');
  assert.equal(readUpdateAnswer(SUCCESS(1, '/App/Home/Watch/someone-else'), 1, CFG, RECORD).watchUrl, undefined, 'another record');
  assert.equal(readUpdateAnswer(SUCCESS(1, 'javascript:alert(1)'), 1, CFG, RECORD).watchUrl, undefined);
  assert.equal(readUpdateAnswer(SUCCESS(1, '/App/Home/Watch/00000000-0000-4000-8000-000000000001'), 1, CFG, RECORD).watchUrl, 'https://lookup.example.invalid/App/Home/Watch/00000000-0000-4000-8000-000000000001', 'braces and case aside');
  assert.throws(() => readUpdateAnswer(lookupPage(), 1, CFG, RECORD), /didn’t confirm/);
  assert.throws(() => readUpdateAnswer(SUCCESS(3), 2, CFG, RECORD), /didn’t confirm/);
});
