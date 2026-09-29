import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { FileHit } from '../shared/protocol.ts';
import { normPath } from '../shared/workspaces.ts';

// "@" file suggestions in the message box, like Claude Code. Names only, from the repos a session
// can use: `git ls-files` (tracked and untracked, minus ignored) or, outside git, a capped walk.

const MAX_FILES = 20_000;
const CACHE_MS = 20_000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'target', 'coverage', '__pycache__', '.venv', 'venv']);

const cache = new Map<string, { at: number; files: Promise<string[]> }>();

function gitFiles(root: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, out) => {
      resolve(err ? null : out.split('\n').filter(Boolean).slice(0, MAX_FILES));
    });
  });
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [''];
  while (queue.length && out.length < MAX_FILES) {
    const rel = queue.shift()!;
    let entries: import('node:fs').Dirent[];
    try { entries = await readdir(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && p.split('/').length < 8) queue.push(p); }
      else if (e.isFile()) out.push(p);
    }
  }
  return out;
}

/** Every file under `root`, relative with forward slashes; cached briefly so typing stays quick. */
export function filesIn(root: string): Promise<string[]> {
  const key = normPath(root);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.files;
  const files = gitFiles(root).then((g) => g ?? walk(root));
  cache.set(key, { at: Date.now(), files });
  return files;
}

/**
 * How well `rel` matches the query: file names starting with it best, then names containing it,
 * then paths containing it, then the query's characters in order. -1 for no match.
 */
export function fileScore(query: string, rel: string): number {
  const q = query.toLowerCase().replace(/\\/g, '/');
  const p = rel.toLowerCase();
  const name = p.slice(p.lastIndexOf('/') + 1);
  if (!q) return 1 - p.length / 1000;
  if (name.startsWith(q)) return 400 - name.length;
  if (name.includes(q)) return 300 - name.length;
  if (p.includes(q)) return 200 - p.length / 10;
  let i = 0;
  for (const ch of p) if (ch === q[i]) i++;
  return i === q.length ? 100 - p.length / 10 : -1;
}

/**
 * The best matches across the session's repos. Files in its own repo read relative to it
 * ("src/app.ts"); files in the other repos it can use carry their full path.
 */
export async function searchFiles(cwd: string, others: string[], query: string, max = 20): Promise<FileHit[]> {
  const roots = [cwd, ...others];
  const lists = await Promise.all(roots.map((r) => filesIn(r).catch(() => [] as string[])));
  const hits: (FileHit & { score: number })[] = [];
  lists.forEach((files, ri) => {
    const root = roots[ri];
    const repo = path.basename(root);
    for (const rel of files) {
      const raw = fileScore(query, ri === 0 ? rel : `${repo}/${rel}`);
      if (raw < 0) continue;
      const score = raw + (ri === 0 ? 0.5 : 0); // the session's own repo wins a tie
      hits.push({ path: ri === 0 ? rel : path.join(root, rel), label: rel, repo: ri === 0 ? undefined : repo, score });
    }
  });
  return hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, max).map(({ score: _, ...h }) => h);
}
