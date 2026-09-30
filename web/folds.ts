// Collapsible sections: what the viewer folded away. A per-browser convenience, so localStorage
// (and it must work without it). Pure parts tested in folds.test.ts.

export interface Folds {
  /** Session: the number pad is folded away (it opens while you are on it). */
  pad: boolean;
  /** Session: Claude's to-do list shows only its summary line. */
  todos: boolean;
}

export type FoldKey = keyof Folds;

export const NO_FOLDS: Folds = { pad: false, todos: false };
const KEY = 'cc-control.folds';

/** Whatever was saved, keeping only known keys with the right types. */
export function parseFolds(raw: string | null): Folds {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<Folds> | null;
    if (!v || typeof v !== 'object') return NO_FOLDS;
    return { pad: v.pad === true, todos: v.todos === true };
  } catch {
    return NO_FOLDS;
  }
}

export function loadFolds(): Folds {
  try { return parseFolds(localStorage.getItem(KEY)); } catch { return NO_FOLDS; }
}

export function saveFolds(f: Folds): void {
  try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* private window: still works this session */ }
}

export function toggled(f: Folds, key: FoldKey): Folds {
  return { ...f, [key]: !f[key] };
}
