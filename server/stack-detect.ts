// The stack found in a workspace's repos (shared/stack-detect.ts does the reading of what the
// files say): this side walks each repo for the files the detector looks at (server/repo-files.ts)
// and keeps the result per workspace.

import { addRepoToStack, detectStack, type Detected } from '../shared/stack-detect.ts';
import { repoName } from '../shared/workspaces.ts';
import { repoFiles } from './repo-files.ts';
export { repoFiles } from './repo-files.ts';
import { plainStack, saveStack, stackOf } from './stack.ts';
import type { Store } from './store.ts';

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
