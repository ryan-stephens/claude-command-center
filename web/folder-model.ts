// The folder picker's pure logic (tested in folder-model.test.ts). The server does the real path
// work (server/fs-browse.ts); the page only needs to tell a path from a filter.

import type { FolderEntry } from '../shared/protocol.ts';

const QUOTES = /^["'\u201C\u201D\u2018\u2019]+|["'\u201C\u201D\u2018\u2019]+$/g;

/** Typed text that is a path to jump to (`D:\repos`, `"C:\x"`, `/home`, `~/code`, `\\nas\share`), not a filter. */
export function looksLikePath(text: string): boolean {
  return /^([a-zA-Z]:|[\\/]|~([\\/]|$))/.test(text.trim().replace(QUOTES, ''));
}

/**
 * A half-typed path split into the folder to list and the name being typed in it:
 * `D:\repos\we` → D:\repos\ and "we", so the picker can show D:\repos filtered to "we".
 */
export function splitTyped(text: string): { dir: string; partial: string } {
  const t = text.trim().replace(QUOTES, '');
  const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/'));
  if (i < 0) return { dir: t, partial: '' };
  return { dir: t.slice(0, i + 1), partial: t.slice(i + 1) };
}

/** Folders whose name contains the text (any case); names starting with it come first. */
export function filterEntries(entries: FolderEntry[], text: string): FolderEntry[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return entries;
  const hits = entries.filter((e) => e.name.toLowerCase().includes(needle));
  return [...hits.filter((e) => e.name.toLowerCase().startsWith(needle)), ...hits.filter((e) => !e.name.toLowerCase().startsWith(needle))];
}

/** "12 repos inside", "git repo", or nothing, for a row or the current folder. */
export function repoSummary(x: { repo: boolean; repos: number }): string {
  if (x.repo) return 'git repo';
  return x.repos ? `${x.repos} repo${x.repos === 1 ? '' : 's'} inside` : '';
}
