// Collapsible sections: what the viewer folded away. A per-browser convenience, so localStorage
// (and it must work without it). Pure parts tested in folds.test.ts.

import type { Bucket } from './home-model.ts';

export interface Folds {
  /** Home: the workspace column is a slim rail of badges. */
  workspaces: boolean;
  /** Home: the repo library is a one-line bar (it opens while you are in it). */
  library: boolean;
  /** Home: the docked session is a slim rail (it opens while you are in it). */
  dock: boolean;
  /** Session: the number pad is folded away (it opens while you are on it). */
  pad: boolean;
  /** Session: Claude's to-do list shows only its summary line. */
  todos: boolean;
  /** Home: session groups showing only their header. */
  buckets: Partial<Record<Bucket, boolean>>;
}

export type FoldKey = 'workspaces' | 'library' | 'dock' | 'pad' | 'todos';

export const NO_FOLDS: Folds = { workspaces: false, library: false, dock: false, pad: false, todos: false, buckets: {} };
const KEY = 'cc-control.folds';

/** Whatever was saved, keeping only known keys with the right types. */
export function parseFolds(raw: string | null): Folds {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<Folds> | null;
    if (!v || typeof v !== 'object') return NO_FOLDS;
    const buckets: Folds['buckets'] = {};
    for (const b of ['needs', 'working', 'done', 'earlier'] as const) if (v.buckets?.[b] === true) buckets[b] = true;
    return { workspaces: v.workspaces === true, library: v.library === true, dock: v.dock === true, pad: v.pad === true, todos: v.todos === true, buckets };
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

export function bucketToggled(f: Folds, b: Bucket): Folds {
  const buckets = { ...f.buckets };
  if (buckets[b]) delete buckets[b];
  else buckets[b] = true;
  return { ...f, buckets };
}

/** The sessions ↑ ↓ can reach: everything outside folded groups. */
export function unfolded<T>(groups: { bucket: Bucket; sessions: T[] }[], f: Folds): T[] {
  return groups.filter((g) => !f.buckets[g.bucket]).flatMap((g) => g.sessions);
}
