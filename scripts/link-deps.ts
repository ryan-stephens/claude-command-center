// node scripts/link-deps.ts [folder]: give a worktree the main checkout's node_modules (PLAN §110, §111).
//
// A card's new worktree has no node_modules, so a UI started there fails ("The system cannot find
// the path specified."), and so do Claude's tests. A big repo can't take a fresh install per card,
// so the worktree gets the main checkout's packages without downloading anything.
//
// How (§111): node_modules in the worktree is a real folder whose files are hard links to the main
// checkout's (each file's data on disk once, two names). Removing the worktree in any way, `git
// worktree remove` by hand included, only takes the worktree's names away; the main checkout's
// install stays whole. A junction (§110) could not promise that: git follows a junction and
// deletes what it points at (Git for Windows 2.53, checked). Details:
// - package.json files are copied, not linked, so a tool that edits one in place edits only this one.
// - A file that can't be linked (NTFS allows 1023 names per file; another drive) is copied.
// - Links inside node_modules (npm workspaces, pnpm) are made again pointing inside the worktree;
//   one pointing outside the main checkout is cloned the same way rather than linked to.
// - Built under node_modules.cc-control-tmp and renamed when whole, so half a clone never passes
//   for a finished one. One clone per folder at a time (a lock outside the repo): Try it waits for
//   the clone the card started in the background, saying so.
// - When the worktree's lockfile differs from the main checkout's, it says so: the packages are
//   the main checkout's, and nothing is installed.
// - The main checkout has no node_modules: it says to install there once, and fails.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync,
  realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This script, for a Try it step or a background run to call. */
export const LINK_DEPS = fileURLToPath(import.meta.url);

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'];
const TMP_NAME = 'node_modules.cc-control-tmp';

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

/** Where the folder's clone lock lives: outside the repo, one per folder. */
export function lockFor(dir: string, base = tmpdir()): string {
  const key = createHash('sha1').update(resolve(dir).toLowerCase()).digest('hex').slice(0, 16);
  return join(base, 'cc-control-deps', key);
}

function alive(lock: string): boolean {
  try { process.kill(Number(readFileSync(join(lock, 'pid'), 'utf8')), 0); return true; } catch { return false; }
}

export type DepsState =
  | { state: 'none' }
  | { state: 'busy' }
  | { state: 'clone'; main: string }
  | { state: 'missing'; main?: string };

/**
 * What the folder needs: nothing, the main checkout's packages cloned in, a wait for the clone
 * going, or an install there first. A node_modules that is a link (§110's junction) needs the clone
 * too: it is what a removal could follow into the main checkout. `ownLock`: the caller holds the lock.
 */
export function depsState(dir: string, main = mainCheckout(dir), base = tmpdir(), ownLock = false): DepsState {
  if (!hasPackages(dir)) return { state: 'none' };
  const lock = lockFor(dir, base);
  if (!ownLock && existsSync(lock) && alive(lock)) return { state: 'busy' };
  const nm = join(dir, 'node_modules');
  if (existsSync(nm) && !isLink(nm)) return { state: 'none' };
  if (main && existsSync(join(main, 'node_modules'))) return { state: 'clone', main };
  return { state: 'missing', ...(main ? { main } : {}) };
}

/** The lockfile the folder has, when the main checkout's says something else. */
export function lockDiffers(dir: string, main: string): string | undefined {
  for (const f of LOCKFILES) {
    if (!existsSync(join(dir, f))) continue;
    const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : undefined);
    return read(join(dir, f)) === read(join(main, f)) ? undefined : f;
  }
  return undefined;
}

/** Keep names out of `git status` without touching the repo's .gitignore. */
function exclude(dir: string, names: string[]): void {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  if (r.status !== 0) return;
  const common = r.stdout.trim();
  const file = join(isAbsolute(common) ? common : resolve(dir, common), 'info', 'exclude');
  try {
    let have = existsSync(file) ? readFileSync(file, 'utf8') : '';
    for (const n of names) {
      if (have.split(/\r?\n/).includes(n)) continue;
      appendFileSync(file, `${have && !have.endsWith('\n') ? '\n' : ''}${n}\n`);
      have = readFileSync(file, 'utf8');
    }
  } catch { /* the clone still works; it may show in git status */ }
}

const inside = (p: string, root: string) => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

export interface CloneCount { files: number; copied: number; links: number; dirs: number }

/**
 * `from` cloned to `to`: folders made, files hard-linked (package.json, and any file that can't be
 * linked, copied), links made again. A link into the main checkout's node_modules points into the
 * clone, one into the main checkout points into the worktree, and one elsewhere is cloned too.
 */
export function cloneTree(from: string, to: string, map: { srcModules: string; destModules: string; main: string; worktree: string }, count: CloneCount = { files: 0, copied: 0, links: 0, dirs: 0 }, seen = new Set<string>(), onProgress?: (c: CloneCount) => void): CloneCount {
  mkdirSync(to, { recursive: true });
  count.dirs++;
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const a = join(from, e.name);
    const b = join(to, e.name);
    if (e.isSymbolicLink()) {
      let target: string;
      try { const t = readlinkSync(a); target = isAbsolute(t) ? resolve(t) : resolve(from, t); } catch { continue; }
      if (inside(target, map.srcModules)) target = join(map.destModules, relative(map.srcModules, target));
      else if (inside(target, map.main)) target = join(map.worktree, relative(map.main, target));
      else {
        // Outside the repo: a copy of its own, never a link a removal could follow.
        let real: string;
        try { real = realpathSync(target); } catch { continue; }
        if (seen.has(real.toLowerCase())) continue;
        seen.add(real.toLowerCase());
        try { if (lstatSync(real).isDirectory()) cloneTree(real, b, map, count, seen, onProgress); else { copyFileSync(real, b); count.copied++; } } catch { /* left out */ }
        continue;
      }
      try { symlinkSync(target, b, 'junction'); count.links++; } catch { /* left out */ }
    } else if (e.isDirectory()) {
      cloneTree(a, b, map, count, seen, onProgress);
    } else {
      if (e.name === 'package.json') { copyFileSync(a, b); count.copied++; }
      else {
        try { linkSync(a, b); count.files++; } catch { copyFileSync(a, b); count.copied++; }
      }
      if (onProgress && (count.files + count.copied) % 20_000 === 0) onProgress(count);
    }
  }
  return count;
}

export interface LinkResult { ok: boolean; did: 'none' | 'cloned' | 'waited' | 'missing'; text: string; lock?: string }

/** Give the folder the main checkout's packages when it needs them (or wait for the clone going). Prints progress. */
export async function linkDeps(dir: string, base = tmpdir(), log: (s: string) => void = () => {}): Promise<LinkResult> {
  const lock = lockFor(dir, base);
  mkdirSync(dirname(lock), { recursive: true });
  for (let waited = 0; ; waited++) {
    try { mkdirSync(lock); break; } catch {
      if (!alive(lock)) { rmSync(lock, { recursive: true, force: true }); continue; }
      if (waited % 15 === 0) log(waited ? `Still copying the packages in (${waited} s)…` : 'The card is still putting the packages in: waiting for it.');
      await new Promise((r) => setTimeout(r, 1000));
      if (!existsSync(lock) && existsSync(join(dir, 'node_modules'))) return { ok: true, did: 'waited', text: 'The packages are here.' };
    }
  }
  writeFileSync(join(lock, 'pid'), String(process.pid));
  try {
    const s = depsState(dir, undefined, base, true);
    if (s.state === 'none' || s.state === 'busy') return { ok: true, did: 'none', text: 'The packages are here.' };
    // §110's junction: unlinked first (a link a removal could follow), then the clone takes its place.
    if (unlinkDeps(dir)) log('Took away the old node_modules link to the main checkout; a copy of hard links takes its place.');
    if (s.state === 'missing') {
      return { ok: false, did: 'missing', text: s.main
        ? `No node_modules here or in the main checkout (${s.main}): install the packages there once (npm ci), then try again.`
        : 'No node_modules here, and this folder isn’t a worktree of a checkout that has them: install the packages here once.' };
    }
    const tmp = join(dir, TMP_NAME);
    exclude(dir, ['/node_modules', `/${TMP_NAME}`]);
    rmSync(tmp, { recursive: true, force: true });
    const srcModules = realpathSync(join(s.main, 'node_modules'));
    const t = Date.now();
    log(`Putting the main checkout’s packages in (hard links, nothing downloaded): ${srcModules}`);
    const c = cloneTree(srcModules, tmp, { srcModules, destModules: join(dir, 'node_modules'), main: s.main, worktree: dir }, undefined, undefined, (n) => log(`${n.files + n.copied} files…`));
    renameSync(tmp, join(dir, 'node_modules'));
    const lockfile = lockDiffers(dir, s.main);
    return {
      ok: true, did: 'cloned',
      text: `Put the main checkout’s packages in (${c.files + c.copied} files as hard links${c.copied ? `, ${c.copied} copied` : ''}, ${Math.round((Date.now() - t) / 1000)} s). Removing this worktree in any way leaves the main checkout’s install whole${lockfile ? `. This branch’s ${lockfile} differs from the main checkout’s, so a package it changed may be missing or older` : ''}.`,
      ...(lockfile ? { lock: lockfile } : {}),
    };
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * Before a worktree is removed: take away a node_modules that is a link (a §110 junction), so the
 * removal can't follow it into the main checkout. A §111 clone is a real folder and stays: removing
 * it only removes its names.
 */
export function unlinkDeps(dir: string): boolean {
  const p = join(dir, 'node_modules');
  if (!isLink(p)) return false;
  unlinkSync(p);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === LINK_DEPS) {
  const dir = resolve(process.argv[2] ?? '.');
  const r = await linkDeps(dir, undefined, console.log);
  console.log(r.text);
  process.exit(r.ok ? 0 : 1);
}

