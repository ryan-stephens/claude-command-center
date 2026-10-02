import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plan, spotOf, type Spot } from './history.ts';

const board: Spot = { kind: 'board' };
const card = (id: string): Spot => ({ kind: 'card', id });
const session = (id: string): Spot => ({ kind: 'session', id });

test('where the app is: a session full screen, else the open card, else the board', () => {
  assert.deepEqual(spotOf({ screen: 'line', openId: null, line: { drawer: null } }), board);
  assert.deepEqual(spotOf({ screen: 'line', openId: null, line: { drawer: 'c1' } }), card('c1'));
  assert.deepEqual(spotOf({ screen: 'session', openId: 's1', line: { drawer: 'c1' } }), session('s1'));
  assert.deepEqual(spotOf({ screen: 'session', openId: null, line: { drawer: null } }), board, 'no session id: not a session');
});

test('opening a card pushes; Esc goes back one; the next card replaces instead of piling up', () => {
  assert.deepEqual(plan([board], card('a')), { op: 'push', stack: [board, card('a')] });
  assert.deepEqual(plan([board, card('a')], card('b')), { op: 'replace', stack: [board, card('b')] });
  assert.deepEqual(plan([board, card('b')], board), { op: 'back', by: 1, stack: [board] });
  assert.deepEqual(plan([board, card('b')], card('b')), { op: 'none' });
});

test('a session from a card is a level deeper; home from it goes back two; back to the card goes back one', () => {
  assert.deepEqual(plan([board, card('a')], session('s')), { op: 'push', stack: [board, card('a'), session('s')] });
  assert.deepEqual(plan([board, card('a'), session('s')], board), { op: 'back', by: 2, stack: [board] });
  assert.deepEqual(plan([board, card('a'), session('s')], card('a')), { op: 'back', by: 1, stack: [board, card('a')] });
  assert.deepEqual(plan([board, card('a'), session('s')], session('t')), { op: 'replace', stack: [board, card('a'), session('t')] });
});

test('a session straight from the board, then a card: the card replaces it (no deeper entry to go back to)', () => {
  assert.deepEqual(plan([board], session('s')), { op: 'push', stack: [board, session('s')] });
  assert.deepEqual(plan([board, session('s')], card('a')), { op: 'replace', stack: [board, card('a')] });
});
