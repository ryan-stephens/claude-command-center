// A card's worktrees and their JavaScript packages (PLAN §110). A new worktree has no node_modules,
// so a UI started there can't find its tools and Claude's tests can't run. The worktree gets a
// junction to the main checkout's node_modules (scripts/link-deps.ts): when the card makes it, and
// as Try it's first step in any folder still without. Every removal of a worktree here unlinks it
// first, since git worktree remove would follow the junction into the main checkout.

import { depsState, linkDeps, LINK_DEPS, unlinkDeps, type DepsState } from '../scripts/link-deps.ts';
import type { StepSpec } from '../shared/recipes.ts';

export { depsState, linkDeps, unlinkDeps };

/** The Try it step that links a folder's packages, or says plainly why it can't. */
export function depsStep(repo?: string): StepSpec {
  const cmd = `node "${LINK_DEPS}"`;
  return { line: cmd, cmd, ...(repo ? { repo } : {}), env: {}, stop: false, note: false };
}

/**
 * The run's steps with a packages step first for each folder it runs in that has a package.json
 * naming packages and no node_modules. `where` resolves a step's folder.
 */
export function withDeps(specs: StepSpec[], where: (s: StepSpec) => string | { error: string }, state: (dir: string) => DepsState['state'] = (d) => depsState(d).state): StepSpec[] {
  const seen = new Set<string>();
  const first: StepSpec[] = [];
  for (const s of specs) {
    if (s.note || s.stop) continue;
    const dir = where(s);
    if (typeof dir !== 'string' || seen.has(dir.toLowerCase())) continue;
    seen.add(dir.toLowerCase());
    if (state(dir) !== 'none') first.push(depsStep(s.repo));
  }
  return [...first, ...specs];
}
