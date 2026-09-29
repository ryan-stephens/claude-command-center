import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { RepoInfo } from '../shared/protocol.ts';
import { normPath } from '../shared/workspaces.ts';

// The repo library: git repos found directly under the folders the user picks as sources
// (e.g. D:\repos). One level deep, no watching and no reading of the code itself.

const MAX_REPOS = 400;
const SKIP = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);

/** Where a repo's git metadata lives: `.git` is a folder, or a file pointing elsewhere (worktrees, submodules). */
function gitDir(repo: string): string | null {
  const dotGit = join(repo, '.git');
  try {
    const st = statSync(dotGit);
    if (st.isDirectory()) return dotGit;
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
    if (m) return isAbsolute(m[1].trim()) ? m[1].trim() : resolve(repo, m[1].trim());
  } catch { /* not a repo */ }
  return null;
}

/** Branch name from HEAD, or a short commit id when detached. */
export function branchFromHead(head: string): string | undefined {
  const ref = /^ref:\s*refs\/heads\/(.+)$/m.exec(head);
  if (ref) return ref[1].trim();
  const sha = /^[0-9a-f]{7,40}$/m.exec(head.trim());
  return sha ? sha[0].slice(0, 7) : undefined;
}

export function repoInfo(path: string): RepoInfo | null {
  const git = gitDir(path);
  if (!git) return null;
  let branch: string | undefined;
  let lastModified: number | undefined;
  try { branch = branchFromHead(readFileSync(join(git, 'HEAD'), 'utf8')); } catch { /* unreadable HEAD */ }
  for (const f of ['index', 'HEAD', 'FETCH_HEAD']) {
    try { lastModified = Math.max(lastModified ?? 0, statSync(join(git, f)).mtimeMs); } catch { /* missing */ }
  }
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  return { path, name, branch, lastModified };
}

/** Every repo that is a source folder or sits directly inside one, most recently touched first. */
export function scanSources(sources: string[]): RepoInfo[] {
  const found = new Map<string, RepoInfo>();
  const add = (p: string) => {
    const key = normPath(p);
    if (found.has(key) || found.size >= MAX_REPOS) return;
    const info = repoInfo(p);
    if (info) found.set(key, info);
  };
  for (const src of sources) {
    if (!existsSync(src)) continue;
    add(src);
    let entries: import('node:fs').Dirent[] = [];
    try { entries = readdirSync(src, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)) add(join(src, e.name));
    }
  }
  return [...found.values()].sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
}

/** Source folders must be real, absolute directories. */
export function cleanSources(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const s of raw) {
    if (typeof s !== 'string' || !isAbsolute(s.trim())) continue;
    const p = s.trim().replace(/[\\/]+$/, '') || s.trim();
    try { if (!statSync(p).isDirectory()) continue; } catch { continue; }
    if (!out.some((o) => normPath(o) === normPath(p))) out.push(p);
  }
  return out.slice(0, 10);
}
