import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { FolderEntry, FolderListing } from '../shared/protocol.ts';
import { normPath } from '../shared/workspaces.ts';

// The folder picker's server half. Browsers can't hand a page absolute paths, so the server lists
// folders for it. Read-only: folder names and whether they hold git repos, never file contents.

/** Folders listed per request; a bigger folder is cut off (and says so). */
export const MAX_ENTRIES = 300;
/** Subfolders checked per entry when counting the repos inside it. */
const MAX_PEEK = 150;

/** Hidden and system folders nobody keeps repos in (compared in lower case). */
const SKIP = new Set([
  'node_modules', '$recycle.bin', 'system volume information', 'recovery', 'config.msi', 'perflogs',
  'documents and settings', 'msocache', 'appdata', 'windowsapps',
]);

/** Folders worth showing: not hidden (`.git`, `.cache`), not system (`$Recycle.Bin`), not node_modules. */
export function showFolder(name: string): boolean {
  return !/^[.$~]/.test(name) && !SKIP.has(name.toLowerCase());
}

/**
 * A folder path as a person types or pastes it, made canonical: quotes from "Copy as path"
 * dropped, `~` expanded, either slash, `D:` meaning the root of D (not "the current folder on D"),
 * `..` resolved, no trailing separator except on a root. Null when it is not an absolute path.
 */
export function normalizeFolder(raw: unknown, platform: string = process.platform, home: string = homedir()): string | null {
  if (typeof raw !== 'string') return null;
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  let s = raw.trim().replace(/^["'\u201C\u201D\u2018\u2019]+|["'\u201C\u201D\u2018\u2019]+$/g, '').trim();
  if (!s || s.length > 1024 || s.includes('\0')) return null;
  if (s === '~' || /^~[\\/]/.test(s)) s = home + s.slice(1);
  if (win) {
    s = s.replace(/\//g, '\\');
    if (/^[a-zA-Z]:$/.test(s)) s += '\\';
    // `\foo` is relative to the current drive, and `C:foo` to C's current folder: neither is a full path.
    if (!/^([a-zA-Z]:\\|\\\\[^\\]+\\[^\\]+)/.test(s)) return null;
  } else if (!s.startsWith('/')) {
    return null;
  }
  s = p.normalize(s);
  const root = p.parse(s).root;
  if (s.length > root.length) s = s.replace(/[\\/]+$/, '');
  if (win && /^[a-z]:/.test(s)) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

export function notAFullPath(raw: string, platform: string = process.platform): string {
  return `“${raw.trim()}” is not a full folder path. Try one like ${platform === 'win32' ? 'D:\\repos' : '/home/you/repos'}.`;
}

/** Breadcrumb for a folder: `D:\repos\x` → D:, repos, x (each with the path to jump to). */
export function crumbsOf(folder: string, platform: string = process.platform): { name: string; path: string }[] {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const root = p.parse(folder).root;
  const out = [{ name: platform === 'win32' ? root.replace(/\\+$/, '') : '/', path: root }];
  let at = root;
  for (const part of folder.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    at = p.join(at, part);
    out.push({ name: part, path: at });
  }
  return out;
}

async function isDir(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

/** A `.git` folder, or a `.git` file (worktrees, submodules). */
async function isRepo(p: string): Promise<boolean> {
  try { await stat(path.join(p, '.git')); return true; } catch { return false; }
}

/** Visible subfolder names, sorted the way Explorer sorts them. Symlinks and junctions to folders count. */
async function subfolders(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const names: string[] = [];
  for (const e of entries) {
    if (!showFolder(e.name)) continue;
    if (e.isDirectory() || (e.isSymbolicLink() && await isDir(path.join(dir, e.name)))) names.push(e.name);
  }
  return names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** Git repos directly inside `dir` (the same depth the repo library scans). */
async function countRepos(dir: string): Promise<number> {
  let names: string[];
  try { names = await subfolders(dir); } catch { return 0; }
  const hits = await Promise.all(names.slice(0, MAX_PEEK).map((n) => isRepo(path.join(dir, n))));
  return hits.filter(Boolean).length;
}

async function describe(p: string, name: string, note?: string): Promise<FolderEntry> {
  const repo = await isRepo(p);
  // Nobody wants a repo's subfolders counted; that also keeps a folder of 50 repos quick.
  return { name, path: p, repo, repos: repo ? 0 : await countRepos(p), ...(note ? { note } : {}) };
}

function unreadable(folder: string, e: NodeJS.ErrnoException): Error {
  if (e.code === 'ENOENT') return new Error(`There is no folder at ${folder}.`);
  if (e.code === 'ENOTDIR') return new Error(`${folder} is a file, not a folder.`);
  if (e.code === 'EPERM' || e.code === 'EACCES') return new Error(`cc-control isn't allowed to open ${folder}.`);
  return new Error(`Can't open ${folder}: ${e.message}`);
}

/** The subfolders of one folder, each marked as a repo or with the number of repos directly inside. */
export async function listFolder(raw: string, platform: string = process.platform): Promise<FolderListing> {
  const folder = normalizeFolder(raw, platform);
  if (!folder) throw new Error(notAFullPath(raw, platform));
  let names: string[];
  try { names = await subfolders(folder); } catch (e) { throw unreadable(folder, e as NodeJS.ErrnoException); }
  const p = platform === 'win32' ? path.win32 : path.posix;
  const isRoot = p.parse(folder).root === folder;
  const entries = await Promise.all(names.slice(0, MAX_ENTRIES).map((n) => describe(p.join(folder, n), n)));
  return {
    path: folder,
    parent: isRoot ? null : p.dirname(folder),
    crumbs: crumbsOf(folder, platform),
    repo: await isRepo(folder),
    repos: entries.filter((e) => e.repo).length,
    entries,
    truncated: names.length > MAX_ENTRIES,
  };
}

/** Where to start: the drives (Windows) or `/`, your home folder, then likely repo folders. */
export async function listRoots(places: { path: string; note: string }[]): Promise<FolderListing> {
  const found: { path: string; name: string; note?: string }[] = [];
  if (process.platform === 'win32') {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const present = await Promise.all(letters.map((l) => isDir(`${l}:\\`)));
    letters.forEach((l, i) => { if (present[i]) found.push({ path: `${l}:\\`, name: `${l}:`, note: 'drive' }); });
  } else {
    found.push({ path: '/', name: '/', note: 'the whole disk' });
  }
  found.push({ path: homedir(), name: path.basename(homedir()), note: 'your home folder' });
  for (const pl of places) {
    const p = normalizeFolder(pl.path);
    if (p && !found.some((f) => normPath(f.path) === normPath(p)) && await isDir(p)) found.push({ path: p, name: path.basename(p) || p, note: pl.note });
  }
  const entries = await Promise.all(found.map((f) => describe(f.path, f.name, f.note)));
  return { path: null, parent: null, crumbs: [], repo: false, repos: 0, entries, truncated: false };
}
