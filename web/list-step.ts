// Holding Ctrl (or Cmd) while arrowing through a list moves several rows at a time. Pure, tested
// in list-step.test.ts; every vertical list (home columns, pickers, the palette) uses it.

/** Rows Ctrl+↑ ↓ move at once. */
export const FAST_STEP = 5;

type Mods = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>;

/** How far one ↑ or ↓ moves: FAST_STEP with Ctrl or Cmd held, otherwise one row. */
export function listStep(e: Mods): number {
  return e.ctrlKey || e.metaKey ? FAST_STEP : 1;
}

/** The row after moving `dir` (1 down, -1 up) from `index` in a list of `length`, kept inside it. */
export function stepped(index: number, length: number, dir: 1 | -1, e: Mods): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index + dir * listStep(e)));
}
