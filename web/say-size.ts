// The card chat's message box size (PLAN §118). It grows with what you type, up to most of the
// chat; its smallest size is yours to set by dragging its top edge or with Ctrl+Shift+↑ / ↓, and is
// remembered in this browser. Pure sizing first, so it is tested on its own.
import { useSyncExternalStore } from 'react';

const KEY = 'cc-control.sayHeight';
/** Two lines of text and the box's padding: the box as it was before it could be resized. */
export const SAY_DEFAULT = 60;
export const SAY_MIN = 44;
/** One Ctrl+Shift+↑ / ↓: about two lines. */
export const SAY_STEP = 48;
/** The most of the window the box may take, so the chat above it stays in view. */
export const SAY_MAX_SHARE = 0.6;

/** A chosen height kept between its smallest and its share of the window. */
export function clampSay(px: number, viewport: number): number {
  return Math.round(Math.max(SAY_MIN, Math.min(Math.max(SAY_MIN, viewport * SAY_MAX_SHARE), px)));
}

/** How tall the box is: its chosen height, or taller for what is typed, never past its share. */
export function fitHeight(chosen: number, content: number, viewport: number): number {
  return clampSay(Math.max(chosen, content), viewport);
}

function load(): number {
  try { const v = Number(localStorage.getItem(KEY)); return v >= SAY_MIN ? v : SAY_DEFAULT; } catch { return SAY_DEFAULT; }
}

let chosen = typeof window === 'undefined' ? SAY_DEFAULT : load();
const listeners = new Set<() => void>();

export function sayHeight(): number { return chosen; }

/** Set the box's chosen height (kept in this browser), and fit the box to it. */
export function setSayHeight(px: number): void {
  chosen = clampSay(px, typeof window === 'undefined' ? 1000 : window.innerHeight);
  try { localStorage.setItem(KEY, String(chosen)); } catch { /* kept for this page only */ }
  for (const l of listeners) l();
  fitSay();
}

/** Ctrl+Shift+↑ / ↓: two lines taller or shorter. */
export function nudgeSay(dir: 1 | -1): void {
  setSayHeight(chosen + dir * SAY_STEP);
}

/** Fit the card's box to its text now (after typing, or after a send emptied it). */
export function fitSay(): void {
  const el = typeof document === 'undefined' ? null : document.getElementById('card-say') as HTMLTextAreaElement | null;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${fitHeight(chosen, el.scrollHeight + 2, window.innerHeight)}px`;
}

export function useSayHeight(): number {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => chosen, () => SAY_DEFAULT);
}
