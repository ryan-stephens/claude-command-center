// A card's worktrees and their JavaScript packages (PLAN §110, §111). A new worktree has no
// node_modules, so a UI started there can't find its tools and Claude's tests can't run. The
// worktree gets the main checkout's packages as a folder of hard links (scripts/link-deps.ts):
// in the background when the card makes it, and as Try it's first step in any folder still without
// (which waits for a clone still going). Removing such a worktree, in any way, leaves the main
// checkout's install whole; a §110 junction still around is unlinked before every removal here.

import { spawn } from 'node:child_process';
import { depsState, LINK_DEPS, unlinkDeps, type DepsState } from '../scripts/link-deps.ts';
import type { StepSpec } from '../shared/recipes.ts';
import { withoutSecrets } from './config.ts';

export { depsState, unlinkDeps };

/** The Try it step that puts a folder's packages in (or waits for the card's clone), or says plainly why it can't. */
export function depsStep(repo?: string): StepSpec {
  const cmd = `node "${LINK_DEPS}"`;
  return { line: cmd, cmd, ...(repo ? { repo } : {}), env: {}, stop: false, note: false };
}

/**
 * The run's steps with a packages step first for each folder it runs in that needs one (no
 * node_modules, a §110 link, or a clone still going). `where` resolves a step's folder.
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

/** Put a folder's packages in, in the background; `done` gets the exit code and the last line it printed. */
export function linkInBackground(dir: string, done: (code: number, last: string) => void): void {
  let last = '';
  const p = spawn(process.execPath, [LINK_DEPS, dir], { cwd: dir, env: withoutSecrets(process.env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const keep = (d: Buffer) => { const lines = d.toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean); if (lines.length) last = lines.at(-1)!.slice(0, 400); };
  p.stdout.on('data', keep);
  p.stderr.on('data', keep);
  p.on('error', (e) => done(1, e.message));
  p.on('close', (code) => done(code ?? 1, last));
}
