// Key hints: whether the keycaps drawn on buttons, chips and headers show always, only while you
// hover, or never. The keys work the same whatever the setting; ? always lists them. Saved on the
// server with the other settings, so it follows you across browsers. Pure, apart from applyHints.

import { KEY_HINTS, type KeyHints } from '../shared/protocol.ts';
import type { LegendItem } from './legend.ts';

export const HINTS_LABEL: Record<KeyHints, string> = { always: 'always', hover: 'on hover', never: 'off' };

/** always → on hover → off → always. */
export function nextHints(h: KeyHints): KeyHints {
  return KEY_HINTS[(KEY_HINTS.indexOf(h) + 1) % KEY_HINTS.length];
}

/**
 * The legend bar under each setting: everything; only the keys that matter right now (the ones
 * with a tone); or no bar at all (? is the one way to see keys).
 */
export function trimLegend(items: LegendItem[], hints: KeyHints): LegendItem[] | null {
  if (hints === 'never') return null;
  if (hints === 'hover') return items.filter((i) => i.tone);
  return items;
}

/** The page's root carries the setting; styles.css hides or shows the keycaps from it. */
export function applyHints(h: KeyHints): void {
  if (typeof document === 'undefined') return; // tests run the store under Node
  if (h === 'always') delete document.documentElement.dataset.hints;
  else document.documentElement.dataset.hints = h;
}
