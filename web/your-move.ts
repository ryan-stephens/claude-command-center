// The home page as Your Move (PLAN §126): the cards in three bands by whose turn it is, never by
// stage. Your move: a card waiting on you (an approval, a question, a plan, a failure, a turn that
// finished while you were elsewhere, a change ready to try), the longest wait first. Claude's move: working on its own.
// Parked: nobody is waiting on it, idle the longest first. Done cards fold away at the end. A card changes band only when
// the turn changes hands. Pure; tested in your-move.test.ts.

import { askOf, type Card } from '../shared/cards.ts';
import { mainRun, type CardRun } from '../shared/recipes.ts';
import { matches, type LineFilter } from './line-model.ts';

/** What a card needs from you. */
export type Need = 'tool' | 'plan' | 'question' | 'reply' | 'tab' | 'failed' | 'tryFailed' | 'unread' | 'try';

export const NEED_LABEL: Record<Need, string> = {
  tool: 'Approve',
  plan: 'Plan to approve',
  question: 'Question',
  reply: 'Asks you',
  tab: 'In its terminal',
  failed: 'Failed',
  tryFailed: 'Try it failed',
  unread: 'Finished · unread',
  try: 'Ready to try',
};

/** The card ids you have seen, with when: a turn that ended after it is unread. */
export type Seen = Record<string, number>;

/** When you last tried each card's change, and how it went (Looks good, or Found a problem). */
export type Tried = Record<string, { at: number; ok: boolean }>;

/** What else the bands need to know: your tries, and which cards have an app to try. */
export interface HomeOpts { tried?: Tried; canTry?: (c: Card) => boolean }

/** The change is ready to try: its turn ended in Try it, there is an app to start, and you haven't tried it since. */
export function readyToTry(c: Card, tried: Tried, canTry: (c: Card) => boolean): boolean {
  if (c.stage !== 'try' || c.live?.phase !== 'waiting' || !canTry(c)) return false;
  const t = tried[c.id];
  return !t || t.at < c.live.at;
}

/** Tried before, and Claude changed it since (after a problem you found, or another round). */
export function triedBefore(c: Card, tried: Tried): boolean {
  return Boolean(tried[c.id] && c.live && tried[c.id].at < c.live.at);
}

export interface Waiting { card: Card; need: Need; since: number }
export interface Home { you: Waiting[]; claude: Card[]; parked: Card[]; done: Card[] }

/** Has the card's last finished turn been seen? */
export function unread(c: Card, seen: Seen): boolean {
  return c.live?.phase === 'waiting' && c.live.at > (seen[c.id] ?? 0);
}

/** What the card needs from you, and since when; undefined when it needs nothing. */
export function needOf(c: Card, run: CardRun | undefined, seen: Seen, opts: HomeOpts = {}): { need: Need; since: number } | undefined {
  if (c.stage === 'done') return undefined;
  const bad = c.boot.filter((b) => b.state === 'bad');
  if (!c.sessionId && bad.length) return { need: 'failed', since: bad[bad.length - 1].at };
  if (c.live?.phase === 'needs') {
    const ask = askOf(c);
    const need: Need = !ask ? 'tab' : ask.kind === 'plan' ? 'plan' : ask.kind === 'question' ? (ask.questions?.length ? 'question' : 'reply') : 'tool';
    return { need, since: c.live.at };
  }
  if (run?.state === 'failed') return { need: 'tryFailed', since: run.startedAt };
  if (unread(c, seen)) return { need: 'unread', since: c.live!.at };
  if (readyToTry(c, opts.tried ?? {}, opts.canTry ?? (() => false))) return { need: 'try', since: c.live!.at };
  return undefined;
}

/** Working on its own: its turn is running, or its session is still starting. */
export function claudesMove(c: Card): boolean {
  if (c.stage === 'done') return false;
  if (!c.sessionId) return !c.boot.some((b) => b.state === 'bad');
  return c.live?.phase === 'working';
}

/** The cards the line shows (the workspace chip and the / filter), in their bands. */
export function homeOf(cards: Card[], runs: Record<string, CardRun>, seen: Seen, filter: LineFilter = 'all', q = '', opts: HomeOpts = {}): Home {
  const shown = cards.filter((c) => (filter === 'all' || c.workspaceId === filter) && matches(q, `${c.key} ${c.title} ${c.branchName ?? ''}`));
  // Newest first, so a card keeps its place in Claude's move while others come and go.
  const newest = [...shown].sort((a, b) => b.createdAt - a.createdAt);
  const home: Home = { you: [], claude: [], parked: [], done: [] };
  for (const c of newest) {
    const n = needOf(c, mainRun(runs, c.id), seen, opts);
    if (n) home.you.push({ card: c, ...n });
    else if (c.stage === 'done') home.done.push(c);
    else if (claudesMove(c)) home.claude.push(c);
    else home.parked.push(c);
  }
  // A queue: what has waited longest first, and a newcomer joins at the end.
  home.you.sort((a, b) => a.since - b.since);
  // Idle the longest first: a card joins at the end when it is parked, and stays put after.
  const idleSince = (c: Card) => c.live?.at ?? c.createdAt;
  home.parked.sort((a, b) => idleSince(a) - idleSince(b));
  return home;
}

/** The cards in reading order: your move, Claude's, parked, then Done when it is open. */
export function homeCards(h: Home, doneOpen = false): Card[] {
  return [...h.you.map((w) => w.card), ...h.claude, ...h.parked, ...(doneOpen ? h.done : [])];
}

/** a: the next card that needs you after `from`, round to the first; null when none does. */
export function nextNeeding(h: Home, from: string | null): string | null {
  const ids = h.you.map((w) => w.card.id);
  if (!ids.length) return null;
  const at = from ? ids.indexOf(from) : -1;
  return ids[(at + 1) % ids.length];
}

/**
 * Marks every finished turn as seen: for a browser that has never kept a record, so cards that
 * finished before this page existed don't all arrive as unread.
 */
export function seenNow(cards: Card[]): Seen {
  const out: Seen = {};
  for (const c of cards) if (c.live) out[c.id] = c.live.at;
  return out;
}

/** Forget cards that are gone, so a record doesn't grow forever. */
export function pruneSeen<T>(seen: Record<string, T>, cards: Card[]): Record<string, T> {
  const ids = new Set(cards.map((c) => c.id));
  return Object.fromEntries(Object.entries(seen).filter(([id]) => ids.has(id)));
}

/** Which band each card is in, for noticing one that moved (it glows, §126). */
export function bandsOf(h: Home): Map<string, 'you' | 'claude' | 'parked' | 'done'> {
  const out = new Map<string, 'you' | 'claude' | 'parked' | 'done'>();
  for (const w of h.you) out.set(w.card.id, 'you');
  for (const c of h.claude) out.set(c.id, 'claude');
  for (const c of h.parked) out.set(c.id, 'parked');
  for (const c of h.done) out.set(c.id, 'done');
  return out;
}

/** The message Found a problem sends: what you saw, as a reply in the card's session. */
export function problemText(what: string): string {
  return `I tried it and found a problem: ${what.trim()}`;
}

/** A box on the page: what the arrows move between. */
export interface Box { id: string; x: number; y: number; w: number; h: number }

/**
 * Arrows across bands that wrap: ← → step through reading order; ↑ ↓ go to the nearest box in the
 * nearest row above or below (a row is boxes whose tops line up), keeping the column as near as it can.
 */
export function stepBox(boxes: Box[], from: string | null, dx: number, dy: number): string | null {
  if (!boxes.length) return null;
  const at = boxes.findIndex((b) => b.id === from);
  if (at < 0) return boxes[0].id;
  if (dx) return boxes[Math.max(0, Math.min(boxes.length - 1, at + dx))].id;
  const me = boxes[at];
  const cx = me.x + me.w / 2;
  const rows = [...new Set(boxes.map((b) => Math.round(b.y)))].sort((a, b) => a - b);
  const row = rows.indexOf(Math.round(me.y)) + dy;
  if (row < 0 || row >= rows.length) return me.id;
  let best: Box | null = null;
  for (const b of boxes) {
    if (Math.round(b.y) !== rows[row]) continue;
    if (!best || Math.abs(b.x + b.w / 2 - cx) < Math.abs(best.x + best.w / 2 - cx)) best = b;
  }
  return best?.id ?? me.id;
}
