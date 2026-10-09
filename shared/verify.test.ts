import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLists, cleanUrl, cleanVerify, drift, idsInText, isLoopback, LOOKUP_MAX_IDS, MAX_LISTS, splitFieldLines, splitIds, setUrl } from './verify.ts';

test('splitIds: one per line or split by commas, spaces, semicolons; duplicates and junk go', () => {
  assert.deepEqual(splitIds('1000\nCX.SAMPLE.ONE, cx.sample.one; 4002  "LE1.X2".\n--\n'), ['1000', 'CX.SAMPLE.ONE', '4002', 'LE1.X2']);
  assert.equal(splitIds(Array.from({ length: 60 }, (_, i) => `F${i}`).join(' ')).length, 40, 'capped');
});

test('idsInText: dotted upper-case ids and numbers after "field"; not file names or every number', () => {
  const t = 'Map CX.SAMPLE.ONE into the loan. Also field 1000 and fields 4002, 4003. See CardView.tsx and PR 123 from 2026.';
  assert.deepEqual(idsInText(t), ['CX.SAMPLE.ONE', '1000', '4002', '4003']);
  assert.deepEqual(idsInText('Fields: LE1.X2 & 3000'), ['LE1.X2', '3000']);
  assert.deepEqual(idsInText('README.MD changed'), []);
});

test('drift: known, exists or in the set differ between two environments', () => {
  const a = { id: '1', known: true, exists: true, inSet: true };
  assert.equal(drift(a, { ...a }), undefined);
  assert.equal(drift(a, { ...a, inSet: false }), 'in the set in one only');
  assert.equal(drift(a, { id: '1', known: false }), 'unknown in the second');
  assert.equal(drift(a, undefined), undefined);
});

test('setUrl and cleanUrl: http(s) only, no trailing slash', () => {
  assert.equal(setUrl({ set: { urls: { dev: ' https://x.example.invalid/ ' } } }, 'dev'), 'https://x.example.invalid');
  assert.equal(setUrl({}, 'dev'), undefined);
  assert.equal(cleanUrl('ftp://x'), undefined);
  assert.equal(cleanUrl('javascript:alert(1)'), undefined);
});

test('splitFieldLines: one id per line as it is (inner spaces kept), CRLF, duplicates in any case, a comma-only paste', () => {
  assert.deepEqual(splitFieldLines(' Group.Name.Role Name \r\n1000\r\ncx.sample.one\r\nCX.SAMPLE.ONE\r\n\r\n--\n'), ['Group.Name.Role Name', '1000', 'cx.sample.one']);
  assert.deepEqual(splitFieldLines('1000, CX.SAMPLE.ONE;4002'), ['1000', 'CX.SAMPLE.ONE', '4002'], 'no line break: commas and semicolons');
  assert.deepEqual(splitFieldLines('1000'), ['1000']);
  const many = Array.from({ length: 296 }, (_, i) => (i % 10 === 0 ? `Group.Sample ${i}` : `CX.F${i}`));
  assert.equal(splitFieldLines(many.join('\n')).length, 296, 'the tool’s ~296-id default list passes whole');
  assert.equal(splitFieldLines(Array.from({ length: 401 }, (_, i) => `F${i}`).join('\n')).length, LOOKUP_MAX_IDS, 'a 401st is dropped');
  assert.equal(splitFieldLines(Array.from({ length: 401 }, (_, i) => `F${i}`).join('\n')).at(-1), 'F399');
  assert.deepEqual(splitIds('Group.Name.Role Name'), ['Group.Name.Role', 'Name'], 'the set check still splits on spaces (its ids have none)');
});

test('cleanVerify: the lookup’s page and update address (same host only), allowUpdate only when true, the builder on this machine only', () => {
  const c = cleanVerify({
    lookup: { url: 'https://l.example.invalid/App/Fetch', page: 'https://l.example.invalid/App/', updateUrl: 'https://l.example.invalid/App/Update', allowUpdate: true },
    builder: { name: 'Sample data', url: 'http://localhost:5100/', ui: 'http://localhost:5173', start: 'dotnet run in the tool’s folder' },
  });
  assert.deepEqual(c, {
    lookup: { url: 'https://l.example.invalid/App/Fetch', page: 'https://l.example.invalid/App', updateUrl: 'https://l.example.invalid/App/Update', allowUpdate: true },
    builder: { name: 'Sample data', url: 'http://localhost:5100', ui: 'http://localhost:5173', start: 'dotnet run in the tool’s folder' },
  });
  assert.equal(cleanVerify({ lookup: { url: 'https://l.example.invalid/F', updateUrl: 'https://other.example.invalid/Update' } })?.lookup?.updateUrl, undefined, 'another host is dropped');
  assert.equal(cleanVerify({ lookup: { url: 'https://l.example.invalid/F', allowUpdate: 'true' } })?.lookup?.allowUpdate, undefined, 'only the literal true');
  assert.equal(cleanVerify({ builder: { url: 'http://builder.example.invalid:5100' } })?.builder, undefined, 'a builder off this machine is dropped');
  assert.equal(cleanVerify({ builder: { url: 'http://127.0.0.1:5100' } })?.builder?.url, 'http://127.0.0.1:5100');
  assert.equal(cleanVerify({ builder: { url: 'http://[::1]:5100' } })?.builder?.url, 'http://[::1]:5100');
});

test('isLoopback: localhost, 127.0.0.1, [::1]; not a lookalike', () => {
  assert.ok(isLoopback('http://localhost:5100') && isLoopback('http://127.0.0.1') && isLoopback('http://[::1]:1'));
  assert.ok(!isLoopback('http://localhost.example.invalid') && !isLoopback('http://127.0.0.1.example.invalid') && !isLoopback('http://10.0.0.1') && !isLoopback(undefined) && !isLoopback('nope'));
});

test('cleanLists: names trimmed and unique, ids through splitFieldLines, empty lists dropped, at most fifty', () => {
  assert.deepEqual(cleanLists([{ name: '  Basics ', ids: ['1000', 'Group.Name.Role Name', 'bad id!'] }, { name: 'basics', ids: ['2'] }, { name: 'Empty', ids: [] }, { ids: ['1'] }, 'junk']), [{ name: 'Basics', ids: ['1000', 'Group.Name.Role Name'] }]);
  assert.equal(cleanLists(Array.from({ length: 60 }, (_, i) => ({ name: `L${i}`, ids: ['1'] }))).length, MAX_LISTS);
  assert.equal(cleanLists([{ name: 'x'.repeat(80), ids: ['1'] }])[0].name.length, 60);
  assert.deepEqual(cleanLists(undefined), []);
});
