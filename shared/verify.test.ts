import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, drift, idsInText, splitIds, setUrl } from './verify.ts';

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
