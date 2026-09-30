// A workspace's stack on the server (shared/stack.ts says what one is): kept per workspace, the
// picker's suggestions (which APIs changed on the card's branch, which the ticket names), and a
// run built from what was picked: the steps, and the UI's proxy file with the picked APIs' rules.
// The proxy file is a copy outside the repo by default; in edit mode the repo's file is changed and
// put back on stop, with a backup kept until then so a crash can't lose it (restoreLeftovers).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { choiceLabel, choiceValues, k8sName, mergeProxy, namesApi, pickedApis, stackRules, stackSteps, validateStack, type Stack, type StackApiRow, type StackChoice, type StackInfo } from '../shared/stack.ts';
import type { RunRecipe } from '../shared/recipes.ts';
import { run } from './hosts.ts';
import type { RunOptions, RunPlaces } from './recipes.ts';
import type { Store } from './store.ts';

const key = (workspaceId: string) => `stack:ws:${workspaceId}`;

/** A workspace's stack, if it has one. */
export function stackOf(store: Store, workspaceId: string): StackInfo | undefined {
  const raw = store.getMeta(key(workspaceId));
  if (!raw) return undefined;
  try {
    const r = JSON.parse(raw) as { stack: unknown; imported?: boolean };
    return { ...validateStack(r.stack), workspaceId, source: r.imported ? 'from the workspace file you imported: check it before running' : 'the workspace’s, written by you' };
  } catch {
    return undefined;
  }
}

/** Save a workspace's stack (checked first; throws what's wrong); null removes it. `imported`: it came in a workspace file. */
export function saveStack(store: Store, workspaceId: string, raw: unknown, imported = false): void {
  if (raw === null || raw === undefined) { store.setMeta(key(workspaceId), ''); return; }
  store.setMeta(key(workspaceId), JSON.stringify({ stack: validateStack(raw), ...(imported ? { imported: true } : {}) }));
}

/** A stack as the workspace's recipe for the page: no steps of its own (they depend on what t picks). */
export function stackRecipe(s: StackInfo): RunRecipe {
  return { repo: '', workspaceId: s.workspaceId, steps: [], ...(s.ui?.url ? { url: s.ui.url } : {}), source: s.source, edited: true, stack: plainStack(s) };
}

/** The stack without where it came from: what goes in a workspace file. */
export function plainStack(s: StackInfo): Stack {
  const { workspaceId: _w, source: _s, ...rest } = s;
  return rest;
}

/** The branch a repo folder is on, made safe for a name; "main" when git can't say. */
async function branchOf(dir: string): Promise<string> {
  const o = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir, undefined, 10_000);
  return o.code === 0 && o.out && o.out !== 'HEAD' ? k8sName(o.out) : 'main';
}

/** Has the repo changed on its branch: files not committed, or commits the base branch doesn't have? */
async function changedIn(dir: string): Promise<boolean> {
  const st = await run('git', ['status', '--porcelain'], dir, undefined, 15_000);
  if (st.code === 0 && st.raw.trim()) return true;
  for (const base of ['origin/HEAD', 'origin/main', 'origin/master', 'origin/develop']) {
    const n = await run('git', ['rev-list', '--count', `${base}..HEAD`], dir, undefined, 15_000);
    if (n.code === 0) return Number(n.out) > 0;
  }
  return false;
}

/** The picker's rows: every API in the stack, whether the card has its repo, and why it's suggested. */
export async function stackRows(stack: Stack, places: RunPlaces, text: string): Promise<StackApiRow[]> {
  return Promise.all(stack.apis.map(async (a) => {
    const dir = places.repos[a.repo.toLowerCase()];
    const found = Boolean(dir && existsSync(dir));
    const changed = found ? await changedIn(dir!) : false;
    const named = namesApi(text, a);
    const why = !found ? 'not in this card or its workspace' : changed ? 'changed on this branch' : named ? 'named in the ticket' : 'in context, unchanged';
    return { repo: a.repo, found, changed, named, why };
  }));
}

/** Where runs keep what they write: generated proxy files, and backups of files changed in place. */
export function runsDir(dbPath: string): string {
  return join(dirname(dbPath), 'runs');
}

/** Put back files a run changed in place and never restored (the server stopped without its stop: steps). */
export function restoreLeftovers(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const restored: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.backup.json')) continue;
    try {
      const b = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { path: string; text: string };
      writeFileSync(b.path, b.text);
      rmSync(join(dir, f));
      restored.push(b.path);
    } catch { /* leave it for a person to look at */ }
  }
  return restored;
}

/** Read a JSON file that may have comments or trailing commas (proxy configs often do). */
export function readLooseJson(text: string): Record<string, unknown> {
  const clean = text.replace(/^﻿/, '').replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, str: string | undefined) => str ?? '').replace(/,(\s*[}\]])/g, '$1');
  const v = JSON.parse(clean) as unknown;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('it isn’t a JSON object');
  return v as Record<string, unknown>;
}

/**
 * A run of the stack for a card: the steps for what was picked, and the proxy file written. Throws
 * what's wrong (an API or UI repo the card doesn't have, a proxy file that isn't there or isn't JSON).
 */
export async function prepareStackRun(stack: StackInfo, choice: StackChoice, places: RunPlaces, cardId: string, dir: string): Promise<{ recipe: RunRecipe; opts: RunOptions }> {
  const values = choiceValues(stack, choice.values);
  const apis = pickedApis(stack, choice.apis);
  const where = (repo: string, what: string) => {
    const d = places.repos[repo.toLowerCase()];
    if (!d || !existsSync(d)) throw new Error(`${what} ${repo} isn’t in this card or its workspace. Add it to the card’s context, or fix the name in the stack (e, then Alt+W).`);
    return d;
  };
  const branches: Record<string, string> = {};
  for (const a of apis) branches[a.repo.toLowerCase()] = await branchOf(where(a.repo, 'The API'));
  let proxy: string | undefined;
  let cleanup: (() => void) | undefined;
  let write: (() => void) | undefined;
  if (stack.ui) {
    const uiDir = where(stack.ui.repo, 'The UI');
    branches[stack.ui.repo.toLowerCase()] = await branchOf(uiDir);
    if (stack.ui.proxyFile) {
      const file = join(uiDir, stack.ui.proxyFile);
      if (!existsSync(file)) throw new Error(`${stack.ui.proxyFile} isn’t in ${stack.ui.repo}. Fix "ui.proxyFile" in the stack.`);
      const original = readFileSync(file, 'utf8');
      let base: Record<string, unknown>;
      try { base = readLooseJson(original); } catch (e) { throw new Error(`${stack.ui.proxyFile} couldn’t be read as JSON (${(e as Error).message}). Only JSON proxy files can be pointed at the APIs for now.`); }
      const merged = `${JSON.stringify(mergeProxy(base, stackRules(stack, { values, apis: apis.map((a) => a.repo) }, branches)), null, 2)}\n`;
      const edit = stack.ui.proxyMode === 'edit';
      proxy = edit ? file : join(dir, `${cardId}.proxy.conf.json`);
      const backup = join(dir, `${cardId}.backup.json`);
      const out = proxy;
      // Written only once every step has been built, so a mistake in the stack changes nothing.
      write = () => {
        mkdirSync(dir, { recursive: true });
        if (edit) writeFileSync(backup, JSON.stringify({ path: file, text: original }));
        writeFileSync(out, merged);
      };
      cleanup = edit ? () => { writeFileSync(file, original); rmSync(backup, { force: true }); } : () => rmSync(out, { force: true });
    }
  }
  const steps = stackSteps(stack, { values, apis: apis.map((a) => a.repo) }, branches, proxy);
  write?.();
  return {
    recipe: { repo: '', workspaceId: stack.workspaceId, steps, ...(stack.ui?.url ? { url: stack.ui.url } : {}), source: stack.source },
    opts: { choice: choiceLabel(values, apis.map((a) => a.repo)), ...(cleanup ? { cleanup } : {}) },
  };
}
