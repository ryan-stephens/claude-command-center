import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Card, CardLive } from '../shared/cards.ts';
import type { CardRun } from '../shared/recipes.ts';
import { bandsOf, homeCards, homeOf, needOf, nextNeeding, problemText, pruneSeen, seenNow, stepBox, triedBefore, unread, type Box } from './your-move.ts';

const card = (id: string, o: Partial<Card> = {}): Card => ({
  id, key: id, title: id, workspaceId: 'w1', stage: 'build', createdAt: 0, boot: [], sessionId: `s-${id}`,
  packet: { workspace: [], ticket: [], card: [], note: '' }, launch: { home: '', branch: 'new', mode: 'plan', message: '' }, ...o,
});
const live = (phase: CardLive['phase'], at: number, o: Partial<CardLive> = {}): CardLive => ({ phase, text: '', at, ...o });

test('what a card needs: an ask by kind, a failed start, a failed Try it, an unread turn', () => {
  assert.equal(needOf(card('a', { live: live('needs', 5, { ask: { kind: 'tool', tool: 'Bash', detail: 'pnpm test' } }) }), undefined, {})?.need, 'tool');
  assert.equal(needOf(card('a', { live: live('needs', 5, { ask: { kind: 'plan', tool: 'ExitPlanMode' } }) }), undefined, {})?.need, 'plan');
  assert.equal(needOf(card('a', { live: live('needs', 5, { ask: { kind: 'question', tool: 'AskUserQuestion', questions: [{ question: 'Q', header: 'h', options: [] }] } }) }), undefined, {})?.need, 'question');
  assert.equal(needOf(card('a', { live: live('needs', 5, { ask: { kind: 'question', tool: 'reply', detail: 'Which one?' } }) }), undefined, {})?.need, 'reply', 'a turn that ended on a question is answered in a message');
  assert.equal(needOf(card('a', { live: live('needs', 5) }), undefined, {})?.need, 'tab', 'waiting in its terminal with nothing the page can answer');
  assert.deepEqual(needOf(card('a', { sessionId: undefined, boot: [{ at: 3, text: 'git failed', state: 'bad' }] }), undefined, {}), { need: 'failed', since: 3 });
  const failed = { cardId: 'a', repo: '', cwd: '', steps: [], state: 'failed', startedAt: 9, text: '' } as CardRun;
  assert.deepEqual(needOf(card('a', { live: live('waiting', 5) }), failed, { a: 6 }), { need: 'tryFailed', since: 9 });
  assert.deepEqual(needOf(card('a', { live: live('waiting', 5) }), undefined, {}), { need: 'unread', since: 5 });
  assert.equal(needOf(card('a', { live: live('waiting', 5) }), undefined, { a: 5 }), undefined, 'seen at the time it finished');
  assert.equal(needOf(card('a', { stage: 'done', live: live('needs', 5) }), undefined, {}), undefined, 'a Done card needs nothing');
});

test('a turn is unread only once it finished after you last saw the card', () => {
  assert.equal(unread(card('a', { live: live('waiting', 10) }), { a: 9 }), true);
  assert.equal(unread(card('a', { live: live('waiting', 10) }), { a: 10 }), false);
  assert.equal(unread(card('a', { live: live('working', 10) }), {}), false, 'a working card has nothing to read yet');
});

test('the bands: your move oldest wait first, Claude’s and parked newest first, done apart', () => {
  const cards = [
    card('ask-late', { createdAt: 1, live: live('needs', 50, { ask: { kind: 'tool', tool: 'Bash' } }) }),
    card('ask-early', { createdAt: 2, live: live('needs', 20, { ask: { kind: 'tool', tool: 'Bash' } }) }),
    card('work-old', { createdAt: 3, live: live('working', 5) }),
    card('work-new', { createdAt: 4, live: live('working', 5) }),
    card('booting', { createdAt: 5, sessionId: undefined }),
    card('parked', { createdAt: 6, live: live('waiting', 5) }),
    card('ended', { createdAt: 7, live: live('ended', 5) }),
    card('done', { createdAt: 8, stage: 'done', live: live('waiting', 5) }),
  ];
  const h = homeOf(cards, {}, { parked: 5, ended: 5, done: 5 });
  assert.deepEqual(h.you.map((w) => w.card.id), ['ask-early', 'ask-late']);
  assert.deepEqual(h.claude.map((c) => c.id), ['booting', 'work-new', 'work-old']);
  assert.deepEqual(h.parked.map((c) => c.id), ['ended', 'parked']);
  assert.deepEqual(h.done.map((c) => c.id), ['done']);
  assert.deepEqual(homeCards(h).map((c) => c.id), ['ask-early', 'ask-late', 'booting', 'work-new', 'work-old', 'ended', 'parked']);
  assert.equal(homeCards(h, true).at(-1)?.id, 'done');
});

test('the workspace chip and the filter narrow every band', () => {
  const cards = [card('a', { title: 'Size guide', live: live('working', 1) }), card('b', { workspaceId: 'w2', live: live('working', 1) })];
  assert.deepEqual(homeOf(cards, {}, {}, 'w2').claude.map((c) => c.id), ['b']);
  assert.deepEqual(homeOf(cards, {}, {}, 'all', 'size').claude.map((c) => c.id), ['a']);
});

test('a goes round the cards that need you', () => {
  const h = homeOf([card('x', { live: live('needs', 1) }), card('y', { live: live('needs', 2) })], {}, {});
  assert.equal(nextNeeding(h, null), 'x');
  assert.equal(nextNeeding(h, 'x'), 'y');
  assert.equal(nextNeeding(h, 'y'), 'x');
  assert.equal(nextNeeding(h, 'not-there'), 'x');
  assert.equal(nextNeeding(homeOf([], {}, {}), null), null);
});

test('a first record marks every card seen; gone cards drop out of it', () => {
  assert.deepEqual(seenNow([card('a', { live: live('waiting', 7) }), card('b')]), { a: 7 });
  assert.deepEqual(pruneSeen({ a: 1, gone: 2 }, [card('a')]), { a: 1 });
});

test('arrows: ← → in reading order, ↑ ↓ to the nearest box of the row above or below', () => {
  // Row 1: three wide cards; row 2: four narrow ones (another band).
  const boxes: Box[] = [
    { id: 'a', x: 0, y: 0, w: 300, h: 100 }, { id: 'b', x: 310, y: 0, w: 300, h: 100 }, { id: 'c', x: 620, y: 0, w: 300, h: 100 },
    { id: 'd', x: 0, y: 150, w: 200, h: 60 }, { id: 'e', x: 210, y: 150, w: 200, h: 60 }, { id: 'f', x: 420, y: 150, w: 200, h: 60 }, { id: 'g', x: 630, y: 150, w: 200, h: 60 },
  ];
  assert.equal(stepBox(boxes, 'c', 1, 0), 'd', '→ from the end of a row goes on to the next');
  assert.equal(stepBox(boxes, 'a', -1, 0), 'a', 'the first stays first');
  assert.equal(stepBox(boxes, 'b', 0, 1), 'f', 'below b (centre 460): f (520) is nearer than e (310)');
  assert.equal(stepBox(boxes, 'g', 0, -1), 'c');
  assert.equal(stepBox(boxes, 'e', 0, 1), 'e', 'no row below: stays');
  assert.equal(stepBox(boxes, null, 0, 1), 'a', 'nothing focused: the first');
  assert.equal(stepBox([], 'a', 1, 0), null);
});

test('ready to try: a turn ended in Try it with an app to start, until you try it; again once Claude changes it', () => {
  const can = () => true;
  const c = card('t', { stage: 'try', live: live('waiting', 10) });
  assert.deepEqual(needOf(c, undefined, { t: 10 }, { canTry: can }), { need: 'try', since: 10 }, 'seen, so ready to try');
  assert.equal(needOf(c, undefined, {}, { canTry: can })?.need, 'unread', 'an unread turn comes first');
  assert.equal(needOf(c, undefined, { t: 10 }, { canTry: () => false }), undefined, 'nothing to start: nothing to try');
  assert.equal(needOf(c, undefined, { t: 10 }, { canTry: can, tried: { t: { at: 11, ok: true } } }), undefined, 'tried since it finished');
  assert.equal(needOf({ ...c, live: live('waiting', 20) }, undefined, { t: 20 }, { canTry: can, tried: { t: { at: 11, ok: false } } })?.need, 'try', 'changed since: ready again');
  assert.equal(triedBefore({ ...c, live: live('waiting', 20) }, { t: { at: 11, ok: false } }), true);
  assert.equal(triedBefore(c, {}), false);
  assert.equal(needOf({ ...c, stage: 'build' }, undefined, { t: 10 }, { canTry: can }), undefined, 'only a turn that ended in Try it');
  assert.equal(needOf({ ...c, live: live('working', 10) }, undefined, {}, { canTry: can }), undefined, 'not while Claude is on it');
});

test('Parked is idle the longest first; bandsOf says where each card is', () => {
  const h = homeOf([card('new-idle', { createdAt: 9, live: live('waiting', 50) }), card('old-idle', { createdAt: 1, live: live('waiting', 5) }), card('w', { live: live('working', 1) })], {}, { 'new-idle': 50, 'old-idle': 5 });
  assert.deepEqual(h.parked.map((c) => c.id), ['old-idle', 'new-idle']);
  assert.deepEqual([...bandsOf(h)], [['w', 'claude'], ['old-idle', 'parked'], ['new-idle', 'parked']]);
});

test('Found a problem says what you saw, as a reply', () => {
  assert.equal(problemText('  the button overlaps the header \n'), 'I tried it and found a problem: the button overlaps the header');
});
