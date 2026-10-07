// node scripts/link-deps.ts [folder]: give a worktree the main checkout's node_modules (PLAN §110).
//
// A card's new worktree has no node_modules, so a UI started there fails ("The system cannot find
// the path specified."), and so do Claude's tests. A big repo can't take a fresh install per card,
// so the worktree gets a junction to the main checkout's node_modules, made at once. cc-control does
// this when it makes a card's worktrees, and Try it does it again first in any folder still without.
//
// - No package.json naming packages, or node_modules already there: nothing to do.
// - The main checkout has node_modules: a junction to it, kept out of git through .git/info/exclude.
//   When the worktree's lockfile differs from the main checkout's, it says so: the packages are the
//   main checkout's, and nothing is installed into the shared folder.
// - The main checkout has none either: it says to install there once, and fails.
//
// Removing a worktree that holds the junction: unlink it first. `git worktree remove` follows a
// junction and deletes what it points at (checked with Git for Windows 2.53), which would empty the
// main checkout's node_modules; cc-control unlinks before every removal it does (`unlinkDeps`).

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This script, for a Try it step to call. */
export const LINK_DEPS = fileURLToPath(import.meta.url);

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'];

/** A package.json that names packages (one with none never gets a node_modules, so it isn't missing one). */
export function hasPackages(dir: string): boolean {
  try {
    const p = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
    return ['dependencies', 'devDependencies', 'optionalDependencies'].some((k) => Object.keys((p[k] as object | undefined) ?? {}).length > 0);
  } catch { return false; }
}

/** The repo's main checkout (the folder its .git is in), when `dir` is another worktree of it. */
export function mainCheckout(dir: string): string | undefined {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  if (r.status !== 0) return undefined;
  const common = r.stdout.trim();
  const main = resolve(dirname(isAbsolute(common) ? common : resolve(dir, common)));
  return main.toLowerCase() === resolve(dir).toLowerCase() ? undefined : main;
}

/** Is this path a link (a junction or a symlink) rather than a real folder? */
export function isLink(p: string): boolean {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

export type DepsState =
  | { state: 'none' }
  | { state: 'link'; main: string }
  | { state: 'missing'; main?: string };

/** What the folder needs: nothing, a junction to the main checkout's node_modules, or an install there first. */
export function depsState(dir: string, main = mainCheckout(dir)): DepsState {
  if (!hasPackages(dir) || existsSync(join(dir, 'node_modules'))) return { state: 'none' };
  if (main && existsSync(join(main, 'node_modules')) && !isLink(join(main, 'node_modules'))) return { state: 'link', main };
  return { state: 'missing', ...(main ? { main } : {}) };
}

/** The lockfile the folder has, and whether the main checkout's says the same. */
export function lockDiffers(dir: string, main: string): string | undefined {
  for (const f of LOCKFILES) {
    if (!existsSync(join(dir, f))) continue;
    const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : undefined);
    return read(join(dir, f)) === read(join(main, f)) ? undefined : f;
  }
  return undefined;
}

/** Keep the link out of `git status` without touching the repo's .gitignore (a .gitignore of `node_modules/` doesn't match a link). */
function excludeLink(dir: string): void {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  if (r.status !== 0) return;
  const common = r.stdout.trim();
  const file = join(isAbsolute(common) ? common : resolve(dir, common), 'info', 'exclude');
  try {
    const have = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (!have.split(/\r?\n/).includes('/node_modules')) appendFileSync(file, `${have && !have.endsWith('\n') ? '\n' : ''}/node_modules\n`);
  } catch { /* the link still works; it may show in git status */ }
}

/** Link the folder to the main checkout's node_modules when it needs one. What happened, in a line; `ok` false when it couldn't. */
export function linkDeps(dir: string): { ok: boolean; did: 'none' | 'linked' | 'missing'; text: string; lock?: string } {
  const s = depsState(dir);
  if (s.state === 'none') return { ok: true, did: 'none', text: 'The packages are here.' };
  if (s.state === 'missing') {
    return { ok: false, did: 'missing', text: s.main
      ? `No node_modules here or in the main checkout (${s.main}): install the packages there once (npm ci), then try again.`
      : 'No node_modules here, and this folder isn’t a worktree of a checkout that has them: install the packages here once.' };
  }
  symlinkSync(join(s.main, 'node_modules'), join(dir, 'node_modules'), 'junction');
  excludeLink(dir);
  const lock = lockDiffers(dir, s.main);
  return { ok: true, did: 'linked', text: `Linked node_modules from the main checkout (${s.main})${lock ? `; this branch’s ${lock} differs from it, so a package it changed may be missing or older` : ''}.`, ...(lock ? { lock } : {}) };
}

/** Before a worktree is removed: take its node_modules link away, so the removal can't follow it into the main checkout. */
export function unlinkDeps(dir: string): boolean {
  const p = join(dir, 'node_modules');
  if (!isLink(p)) return false;
  unlinkSync(p);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === LINK_DEPS) {
  const r = linkDeps(resolve(process.argv[2] ?? '.'));
  console.log(r.text);
  process.exit(r.ok ? 0 : 1);
}
