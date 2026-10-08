// A chat that follows its newest line while you are at the bottom, and stays where you put it when
// you scroll up, even while Claude writes (PLAN §130). Shared by the card chat and the full-screen
// session.
//
// Why the old way yanked: "pinned" was "within 80 px of the bottom" after each scroll event, so a
// trackpad or Chrome's smooth wheel, which scroll a few pixels at a time, never got past 80 px before
// the next token scrolled back down (and setting scrollTop cancels a smooth scroll mid-way).
// Now any move up lets go at once, and only reaching the bottom yourself pins it again. The browser's
// scroll anchoring is off on the chat: when a turn ends, the streamed text is swapped for the message
// and anchoring moved the chat up to keep some line in place, which read as you scrolling up.
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** At most this far from the bottom counts as at it (fractional pixels, a rounding zoom). */
const AT_BOTTOM = 4;
/** After a wheel, touch or key up, how long the chat doesn't follow, so a smooth scroll can start. */
const HOLD_MS = 300;
const UP_KEYS = new Set(['PageUp', 'ArrowUp', 'Home']);

/** The chat on screen's "to the newest" (End, and the ↓ button), for the keys. */
export const chatJump: { current: (() => void) | null } = { current: null };

/**
 * `count`: how many items the chat has (a change follows them while pinned). `said`: how many of them
 * are Claude's messages, counted as new while you are away. `resetKey`: a different chat starts at
 * its newest line.
 */
export function useStickToBottom(count: number, said: number, resetKey: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // Where we last left it: a scrollTop below this, not at the bottom, is someone else's move.
  const lastTop = useRef(0);
  const hold = useRef(0);
  const counted = useRef(said);
  counted.current = said;
  // What the page shows: away from the bottom, and how many messages there were when you left it.
  const [away, setAway] = useState<number | null>(null);

  const setPinned = useCallback((p: boolean) => {
    if (pinned.current === p) return;
    pinned.current = p;
    setAway(p ? null : counted.current);
  }, []);
  const note = (el: HTMLElement) => {
    lastTop.current = el.scrollTop;
  };
  const movedUp = (el: HTMLElement) => el.scrollTop < lastTop.current - 1 && el.scrollHeight - el.scrollTop - el.clientHeight > AT_BOTTOM;

  /** Follow the newest line, unless you have moved away (checked here too: a scroll event comes a frame late). */
  const toBottom = useCallback(() => {
    const el = ref.current;
    if (!el || !pinned.current) return;
    if (movedUp(el)) { setPinned(false); note(el); return; }
    if (performance.now() < hold.current) return;
    el.scrollTop = el.scrollHeight;
    note(el);
  }, [setPinned]);

  const jump = useCallback(() => {
    const el = ref.current;
    hold.current = 0;
    setPinned(true);
    if (el) { el.scrollTop = el.scrollHeight; note(el); }
  }, [setPinned]);

  useLayoutEffect(() => {
    pinned.current = true;
    hold.current = 0;
    setAway(null);
    const el = ref.current;
    if (el) { el.scrollTop = el.scrollHeight; note(el); }
  }, [resetKey]);
  useLayoutEffect(toBottom, [count, toBottom]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const g = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (g <= AT_BOTTOM) setPinned(true);
      else if (movedUp(el)) setPinned(false);
      note(el);
    };
    const holdUp = () => { hold.current = performance.now() + HOLD_MS; };
    const onWheel = (e: WheelEvent) => { if (e.deltaY < 0) holdUp(); };
    const onKey = (e: KeyboardEvent) => { if (UP_KEYS.has(e.key)) holdUp(); };
    // The chat's own height changing (the message box grew or shrank, §118): the same distance from
    // the bottom as before, so what you were reading stays above the box. Its content growing: follow it.
    let h = el.clientHeight;
    el.style.overflowAnchor = 'none';
    const ro = new ResizeObserver(() => {
      if (el.clientHeight !== h) {
        // Shorter by d: d further down, so the line that was at the bottom still is.
        const d = h - el.clientHeight;
        h = el.clientHeight;
        el.scrollTop = pinned.current ? el.scrollHeight : el.scrollTop + d;
        note(el);
      } else toBottom();
    });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchmove', holdUp, { passive: true });
    el.addEventListener('keydown', onKey);
    chatJump.current = jump;
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchmove', holdUp);
      el.removeEventListener('keydown', onKey);
      if (chatJump.current === jump) chatJump.current = null;
    };
  }, [toBottom, jump, setPinned]);

  return { ref, toBottom, jump, away: away !== null, fresh: away === null ? 0 : Math.max(0, said - away) };
}
