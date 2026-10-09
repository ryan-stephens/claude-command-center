import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fieldLines, pushRecent, RECENT_MAX, SECTIONS, sectionName, sectionShown, stepSection, visibleFields } from './verify-model.ts';

test('sections: the first set up opens; Alt+← → go round all three; the file’s names win', () => {
  assert.deepEqual(SECTIONS.map((s) => s.id), ['builder', 'lookup', 'set']);
  assert.equal(sectionShown(null, {}), null, 'nothing set up: no section (the file note shows)');
  assert.equal(sectionShown(null, { set: { urls: { dev: 'https://s.example.invalid' } } }), 'set');
  assert.equal(sectionShown(null, { lookup: { url: 'https://l.example.invalid/F' }, set: { urls: { dev: 'https://s.example.invalid' } } }), 'lookup');
  assert.equal(sectionShown('set', { builder: { url: 'http://localhost:5100' } }), 'set', 'a section chosen stays chosen');
  assert.equal(stepSection('builder', 1), 'lookup');
  assert.equal(stepSection('set', 1), 'builder');
  assert.equal(stepSection('builder', -1), 'set');
  assert.equal(sectionName('builder', {}), 'Test data');
  assert.equal(sectionName('lookup', { lookup: { name: 'Sample lookup' } }), 'Sample lookup');
  assert.equal(sectionName('set', {}), 'Field set');
});

const F = [
  { id: '1000', value: '1,250.00', exists: true },
  { id: 'CX.SAMPLE.ONE', value: '', exists: true },
  { id: 'Group.Name.Role Name', value: 'Tom', exists: true },
  { id: 'CX.MADE.UP', value: '', exists: false },
];

test('the lookup’s filter (field or value) and only empty or missing', () => {
  assert.deepEqual(visibleFields(F, '', false).length, 4);
  assert.deepEqual(visibleFields(F, 'role', false).map((f) => f.id), ['Group.Name.Role Name']);
  assert.deepEqual(visibleFields(F, 'tom', false).map((f) => f.id), ['Group.Name.Role Name'], 'by value too');
  assert.deepEqual(visibleFields(F, '', true).map((f) => f.id), ['CX.SAMPLE.ONE', 'CX.MADE.UP']);
  assert.deepEqual(visibleFields(F, 'made', true).map((f) => f.id), ['CX.MADE.UP']);
  assert.equal(fieldLines(F), '1000=1,250.00\nCX.SAMPLE.ONE=\nGroup.Name.Role Name=Tom\nCX.MADE.UP=');
});

test('recent records: newest first, one per record and environment, at most eight, a label kept', () => {
  let r = pushRecent([], { record: 'A', env: 'dev', label: 'Sample scenario' });
  r = pushRecent(r, { record: 'B', env: 'uat' });
  r = pushRecent(r, { record: 'A', env: 'dev' });
  assert.deepEqual(r, [{ record: 'A', env: 'dev', label: 'Sample scenario' }, { record: 'B', env: 'uat' }]);
  assert.equal(pushRecent(r, { record: 'A', env: 'uat' }).length, 3, 'another environment is another chip');
  for (let i = 0; i < 12; i++) r = pushRecent(r, { record: `R${i}`, env: 'dev' });
  assert.equal(r.length, RECENT_MAX);
  assert.equal(r[0].record, 'R11');
});
