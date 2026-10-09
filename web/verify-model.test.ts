import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AFTER_EVERY_MS, AFTER_FOR_MS, afterMark, afterPhase, ARM_MS, armed, fieldLines, sameValue, shortId, stageEdit, POLL_MAX_ERRORS, POLL_MAX_MS, POLL_MS, pushRecent, RECENT_MAX, runPhase, SECTIONS, sectionName, sectionShown, stepSection, visibleFields, visibleScenarios } from './verify-model.ts';

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

test('a run is polled while it runs, stops when it ends, after 15 minutes, or three failed polls in a row', () => {
  const t0 = 1_000_000;
  assert.equal(runPhase('running', 0, t0, t0 + POLL_MS), 'poll');
  assert.equal(runPhase(undefined, 2, t0, t0 + POLL_MS), 'poll', 'two failed polls: still asking');
  assert.equal(runPhase('succeeded', 0, t0, t0 + 6000), 'succeeded');
  assert.equal(runPhase('failed', 0, t0, t0 + 6000), 'failed');
  assert.equal(runPhase('running', 0, t0, t0 + POLL_MAX_MS), 'timeout');
  assert.equal(runPhase(undefined, POLL_MAX_ERRORS, t0, t0 + 6000), 'error');
  assert.equal(runPhase('succeeded', POLL_MAX_ERRORS, t0, t0 + POLL_MAX_MS), 'succeeded', 'an ended run wins');
});

test('scenarios filter by name, version or tag; a two-step key fires only on the same thing within four seconds', () => {
  const list = [{ name: 'Sample purchase', version: 3, tags: ['fha'] }, { name: 'Sample refinance', version: 1, tags: ['va', 'smoke'] }];
  assert.equal(visibleScenarios(list, '').length, 2);
  assert.deepEqual(visibleScenarios(list, 'refi').map((s) => s.version), [1]);
  assert.deepEqual(visibleScenarios(list, 'v3').map((s) => s.name), ['Sample purchase']);
  assert.deepEqual(visibleScenarios(list, 'SMOKE').map((s) => s.name), ['Sample refinance']);
  assert.ok(armed({ key: 'a', at: 0 }, 'a', ARM_MS - 1));
  assert.ok(!armed({ key: 'a', at: 0 }, 'a', ARM_MS), 'too late');
  assert.ok(!armed({ key: 'a', at: 0 }, 'b', 10), 'another scenario');
  assert.ok(!armed(null, 'a', 0));
});

test('staging: a value, a select’s option, a clear; an empty edit, the same value or a value outside the options is no change', () => {
  const text = { id: '1000', value: '1,250.00' };
  const sel = { id: 'CX.SAMPLE.ONE', value: 'Yes', options: ['Yes', 'No'] };
  let s = stageEdit({}, text, '2000').staged;
  assert.deepEqual(s, { 1000: { old: '1,250.00', value: '2000' } });
  s = stageEdit(s, sel, 'No').staged;
  assert.deepEqual(Object.keys(s), ['1000', 'CX.SAMPLE.ONE']);
  assert.deepEqual(stageEdit(s, sel, 'Maybe'), { staged: s, note: 'Maybe isn’t one of CX.SAMPLE.ONE’s options' });
  const empty = stageEdit(s, text, '  ');
  assert.deepEqual(Object.keys(empty.staged), ['CX.SAMPLE.ONE'], 'an empty edit unstages, it isn’t a change');
  assert.match(empty.note!, /Backspace clears/);
  assert.equal(stageEdit({}, text, '1250').note, '1000 has that value already', 'commas aside');
  assert.deepEqual(stageEdit({}, text, '', true).staged, { 1000: { old: '1,250.00', value: '', clear: true } }, 'a clear');
  assert.equal(stageEdit({}, { id: 'X', value: '' }, '', true).note, 'X is empty already');
});

test('after an update: pending, applied (trimmed, commas aside), differs; stop when all applied or after three minutes', () => {
  assert.equal(afterMark({ old: '1,250.00', value: '2500' }, '2,500'), 'applied');
  assert.equal(afterMark({ old: '1,250.00', value: '2500' }, ' 2500.00 '), 'applied');
  assert.equal(afterMark({ old: '1,250.00', value: '2500' }, '1250'), 'pending');
  assert.equal(afterMark({ old: '1,250.00', value: '2500' }, '99'), 'differs');
  assert.equal(afterMark({ old: 'Yes', value: '', clear: true }, ''), 'applied');
  assert.equal(afterMark({ old: 'Yes', value: '', clear: true }, 'Yes'), 'pending');
  assert.equal(afterMark({ old: 'Tom', value: 'Jerry' }, 'jerry'), 'differs', 'text compares exactly');
  assert.ok(sameValue('-1,000.5', '-1000.50') && !sameValue('1,000', '1.000') && !sameValue('A1', 'A1 '.repeat(2)));
  const t0 = 5_000;
  assert.equal(afterPhase(['pending', 'applied'], t0, t0 + AFTER_EVERY_MS), 'poll');
  assert.equal(afterPhase(['applied', 'applied'], t0, t0 + AFTER_EVERY_MS), 'applied');
  assert.equal(afterPhase(['differs'], t0, t0 + AFTER_FOR_MS), 'timeout');
  assert.equal(afterPhase(['applied'], t0, t0 + AFTER_FOR_MS), 'applied', 'applied at the last check still counts');
  assert.equal(shortId('{00000000-0000-4000-8000-000000000001}'), '00000000…');
  assert.equal(shortId('5001'), '5001');
});
