// The stack found in a workspace's repos (shared/stack-detect.ts does the reading of what the
// files say): this side walks each repo for the files the detector looks at, a bounded walk that
// skips what is never interesting (node_modules, .git, build output), and reads files on demand.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { addRepoToStack, detectStack, type Detected, type RepoFiles } from '../shared/stack-detect.ts';
import { repoName } from '../shared/workspaces.ts';
import { plainStack, saveStack, stackOf } from './stack.ts';
import type { Store } from './store.ts';

const SKIP = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'build', '.angular', '.nx', 'coverage', 'packages', 'wwwroot', '.vs', '.idea']);
const MAX_FILES = 600;
const MAX_DEPTH = 4;
const MAX_READ = 300_000;

/** A repo's files, relative with forward slashes, to a depth and count that keep this quick. */
export function repoFiles(dir: string): RepoFiles {
  const files: string[] = [];
  const walk = (rel: string, depth: number) => {
    if (files.length >= MAX_FILES || depth > MAX_DEPTH) return;
    let names: string[];
    try { names = readdirSync(join(dir, rel)); } catch { return; }
    for (const n of names.sort()) {
      if (files.length >= MAX_FILES) return;
      if (SKIP.has(n) || n.startsWith('.')) continue;
      const r = rel ? `${rel}/${n}` : n;
      let isDir = false;
      try { isDir = statSync(join(dir, r)).isDirectory(); } catch { continue; }
      if (isDir) walk(r, depth + 1);
      else files.push(r);
    }
  };
  walk('', 0);
  return {
    name: repoName(dir),
    files,
    read: (rel) => {
      try {
        const p = join(dir, rel);
        if (statSync(p).size > MAX_READ) return undefined;
        return readFileSync(p, 'utf8');
      } catch { return undefined; }
    },
  };
}

/** The stack a workspace's repos describe. */
export function detectWorkspaceStack(repos: string[]): Detected {
  return detectStack(repos.map(repoFiles));
}

/**
 * A repo a card added later: put it in the workspace's stack when its files say it belongs there
 * (an API the stack lacks, or the UI). Returns the line to put on the card, or nothing.
 */
export function joinStack(store: Store, workspaceId: string, repoDir: string, name = repoName(repoDir)): string | undefined {
  const stack = stackOf(store, workspaceId);
  if (!stack) return undefined;
  // Read from the card's worktree of the repo, but name it after the repo (the stack and the picker go by that name).
  const next = addRepoToStack(plainStack(stack), { ...repoFiles(repoDir), name });
  if (!next) return undefined;
  saveStack(store, workspaceId, next.stack);
  return next.said;
}
