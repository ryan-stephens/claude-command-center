import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Question } from '../shared/protocol.ts';
import { answered, answersFor, asMode, enterOnRow, firstOpen, freshQa, modeAfter, nextMode, pick, typeOther } from './questions.ts';

const lib: Question = { question: 'Which date library?', header: 'Library', multiSelect: false, options: [{ label: 'date-fns', description: '' }, { label: 'dayjs', description: '' }] };
const feats: Question = { question: 'Which features?', header: 'Features', multiSelect: true, options: [{ label: 'Dark mode', description: '' }, { label: 'Search', description: '' }] };

test('a single choice replaces the pick; a multi-select toggles', () => {
  let s = freshQa('r', 2);
  s = pick(s, lib, 0, 'date-fns');
  s = pick(s, lib, 0, 'dayjs');
  assert.deepEqual(s.picks[0], ['dayjs']);
  s = pick(s, feats, 1, 'Dark mode');
  s = pick(s, feats, 1, 'Search');
  s = pick(s, feats, 1, 'Dark mode');
  assert.deepEqual(s.picks[1], ['Search']);
});

test('"Other" replaces a single choice, and adds to a multi-select', () => {
  let s = freshQa('r', 2);
  s = pick(s, lib, 0, 'dayjs');
  s = typeOther(s, lib, 0, 'luxon');
  assert.deepEqual(answersFor(s, [lib, feats]), { 'Which date library?': 'luxon' });
  s = pick(s, feats, 1, 'Search');
  s = typeOther(s, feats, 1, 'Export');
  assert.equal(answersFor(s, [lib, feats])['Which features?'], 'Search, Export');
});

test('firstOpen finds what still needs an answer', () => {
  let s = freshQa('r', 2);
  assert.equal(firstOpen(s, [lib, feats]), 0);
  s = pick(s, lib, 0, 'dayjs');
  assert.equal(firstOpen(s, [lib, feats]), 1);
  assert.equal(answered(s, 1), false);
  s = typeOther(s, feats, 1, '  ');
  assert.equal(firstOpen(s, [lib, feats]), 1, 'blank "Other" is not an answer');
  s = pick(s, feats, 1, 'Search');
  assert.equal(firstOpen(s, [lib, feats]), -1);
});

test('nextMode cycles like Shift+Tab in Claude Code', () => {
  assert.equal(nextMode(undefined), 'acceptEdits');
  assert.equal(nextMode('default'), 'acceptEdits');
  assert.equal(nextMode('acceptEdits'), 'plan');
  assert.equal(nextMode('plan'), 'auto');
  assert.equal(nextMode('auto'), 'default');
  assert.equal(nextMode('bypassPermissions'), 'default');
});

test('modeAfter goes past Auto on Haiku and says so (§129); asMode reads a reported mode', () => {
  assert.deepEqual(modeAfter('plan', 'claude-sonnet-5-5'), { mode: 'auto', skipped: false });
  assert.deepEqual(modeAfter('plan', 'haiku'), { mode: 'default', skipped: true });
  assert.deepEqual(modeAfter('plan', 'claude-haiku-4-5-20251001'), { mode: 'default', skipped: true });
  assert.deepEqual(modeAfter('default', 'haiku'), { mode: 'acceptEdits', skipped: false });
  assert.deepEqual(modeAfter(undefined), { mode: 'acceptEdits', skipped: false });
  assert.equal(asMode('plan'), 'plan');
  assert.equal(asMode('nonsense'), 'default');
  assert.equal(asMode(undefined), 'default');
});

test('Enter on a row: a single choice picks and moves on, then sends after the last', () => {
  let s = freshQa('r', 2);
  let r = enterOnRow({ ...s, hl: 1 }, [lib, feats]);
  assert.equal(r.then, 'stay');
  assert.deepEqual(r.state.picks[0], ['dayjs']);
  assert.equal(r.state.at, 1, 'moved to the next question');
  s = r.state;
  r = enterOnRow(s, [lib, feats]);
  assert.deepEqual(r.state.picks[1], ['Dark mode'], 'multi-select: Enter turns the row on');
  assert.equal(r.then, 'stay');
  r = enterOnRow(r.state, [lib, feats]);
  assert.equal(r.then, 'send', 'Enter again on a picked row, with everything answered, sends');
  assert.equal(enterOnRow({ ...freshQa('r', 1), hl: 2 }, [lib]).then, 'other', 'the last row is "type your own"');
});
