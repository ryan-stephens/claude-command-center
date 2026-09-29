// Workspace ↔ path logic shared by the server (boards, validation) and the web app (grouping).
// Pure and erasable TS, so Node runs it directly.

import type { Workspace } from './protocol.ts';

/** Accent colours a workspace can take; the web app maps each name to a swatch. */
export const WORKSPACE_COLORS = ['orange', 'green', 'blue', 'violet', 'pink', 'teal', 'amber', 'slate'] as const;

/** Paths compare the way the OS does: either slash, no trailing slash, and case-insensitive on Windows drives. */
export function normPath(p: string): string {
  const s = p.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-zA-Z]:/.test(s) ? s.toLowerCase() : s;
}

export function samePath(a: string, b: string): boolean {
  return normPath(a) === normPath(b);
}

/** True when `child` is `parent` or somewhere under it. */
export function isInside(child: string, parent: string): boolean {
  const c = normPath(child);
  const p = normPath(parent);
  return c === p || c.startsWith(`${p}/`);
}

/** The folder name, e.g. "web-app" for "C:\\repos\\web-app". */
export function repoName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Workspaces that hold `cwd`: one of their repos is it, or contains it. */
export function workspacesFor(cwd: string, workspaces: Workspace[]): Workspace[] {
  if (!cwd) return [];
  return workspaces.filter((w) => w.repos.some((r) => isInside(cwd, r)));
}

/** Where new sessions in a workspace start. */
export function homeRepo(w: Workspace): string | undefined {
  return w.home && w.repos.some((r) => samePath(r, w.home!)) ? w.home : w.repos[0];
}

/** Add a path to a list unless it is already there (by OS comparison). */
export function addPath(list: string[], path: string): string[] {
  return list.some((p) => samePath(p, path)) ? list : [...list, path];
}

export function removePath(list: string[], path: string): string[] {
  return list.filter((p) => !samePath(p, path));
}

/**
 * Likely repo source folders, from the folders past sessions ran in: parents that hold at least
 * two of them, most-used first (e.g. D:\\repos for D:\\repos\\a and D:\\repos\\b).
 */
export function suggestSources(cwds: string[], max = 3): string[] {
  const counts = new Map<string, { path: string; n: number }>();
  for (const cwd of cwds) {
    const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/);
    if (parts.length < 3) continue; // skip drive roots and top-level folders
    const sep = cwd.includes('\\') ? '\\' : '/';
    const parent = parts.slice(0, -1).join(sep);
    const key = normPath(parent);
    const entry = counts.get(key) ?? { path: parent, n: 0 };
    entry.n += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].filter((e) => e.n >= 2).sort((a, b) => b.n - a.n).slice(0, max).map((e) => e.path);
}
