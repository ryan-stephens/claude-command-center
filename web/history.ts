// The browser's back and forward follow the app (PLAN §63): the board, a card open on it, and a
// session full screen are places, and moving between them in the app pushes or pops history
// entries, so Alt+←, a mouse's back button and the browser's own arrow leave a card the way Esc
// does, and forward reopens it. Nothing else (dialogs, tabs, the new-card screen) is in history.
// The pure part (what to do with the stack for a move) is `plan`, tested in history.test.ts.

import { openSession } from './keys.ts';
import { goHome } from './line-keys.ts';
import { get, set, useStore } from './store.ts';

export type Spot = { kind: 'board' } | { kind: 'card'; id: string } | { kind: 'session'; id: string };

/** Where the app is, from its state. A session full screen counts even with a card behind it. */
export function spotOf(s: { screen: 'line' | 'session'; openId: string | null; line: { drawer: string | null } }): Spot {
  if (s.screen === 'session' && s.openId) return { kind: 'session', id: s.openId };
  if (s.line.drawer) return { kind: 'card', id: s.line.drawer };
  return { kind: 'board' };
}

export const sameSpot = (a: Spot, b: Spot): boolean => a.kind === b.kind && (a.kind === 'board' || a.id === (b as { id: string }).id);

const DEPTH: Record<Spot['kind'], number> = { board: 0, card: 1, session: 2 };

/** What one move does to the history: go back some entries, push a new one, or replace the top. */
export type Move = { op: 'none' } | { op: 'back'; by: number; stack: Spot[] } | { op: 'push'; stack: Spot[] } | { op: 'replace'; stack: Spot[] };

/**
 * `stack` is the path of entries the app made, the board first; `to` is where the app is now.
 * Going to a place already in the path goes back to it; somewhere deeper is pushed; a sibling
 * (the next card, another session) replaces the top, so ← → through cards don't pile up.
 */
export function plan(stack: Spot[], to: Spot): Move {
  const top = stack[stack.length - 1];
  if (top && sameSpot(top, to)) return { op: 'none' };
  const at = stack.findIndex((s) => sameSpot(s, to));
  if (at >= 0) return { op: 'back', by: stack.length - 1 - at, stack: stack.slice(0, at + 1) };
  if (!top || DEPTH[to.kind] > DEPTH[top.kind]) return { op: 'push', stack: [...stack, to] };
  return { op: 'replace', stack: [...stack.slice(0, -1), to] };
}

interface Entry { cc: Spot[] }

const stackNow = (): Spot[] => {
  const st = (history.state as Entry | null)?.cc;
  return Array.isArray(st) && st.length ? st : [{ kind: 'board' }];
};

let applying = false;

/** Put the app where a history entry says, without writing history for it. */
function apply(spot: Spot): void {
  applying = true;
  try {
    const s = get();
    if (spot.kind === 'session') { if (s.openId !== spot.id || s.screen !== 'session') openSession(spot.id); return; }
    if (spot.kind === 'card') {
      if (!s.cards.some((c) => c.id === spot.id)) { goHome(); return; }
      if (s.screen === 'session') goHome();
      set({ line: { ...get().line, focus: spot.id, drawer: spot.id } });
      return;
    }
    if (s.screen === 'session' || s.line.drawer) goHome();
  } finally {
    applying = false;
  }
}

/** Call once at start: marks the first entry as the board and starts following the store. */
export function followHistory(): void {
  if (typeof history === 'undefined') return;
  const first = stackNow();
  history.replaceState({ cc: first } as Entry, '');
  let last = spotOf(get());
  useStore.subscribe((s) => {
    const to = spotOf(s);
    if (sameSpot(to, last)) return;
    last = to;
    if (applying) return;
    const m = plan(stackNow(), to);
    if (m.op === 'back') { applying = true; history.go(-m.by); setTimeout(() => { applying = false; }, 0); }
    else if (m.op === 'push') history.pushState({ cc: m.stack } as Entry, '');
    else if (m.op === 'replace') history.replaceState({ cc: m.stack } as Entry, '');
  });
  window.addEventListener('popstate', (e) => {
    const stack = (e.state as Entry | null)?.cc;
    const spot = Array.isArray(stack) && stack.length ? stack[stack.length - 1] : { kind: 'board' as const };
    last = spot;
    apply(spot);
  });
}
