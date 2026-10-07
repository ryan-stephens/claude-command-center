// A workspace's stack on the server (shared/stack.ts says what one is): kept per workspace, the
// picker's suggestions (which APIs changed on the card's branch, which the ticket names), and a
// run built from what was picked: the steps, and the UI's proxy file with the picked APIs' rules.
// The proxy file is a copy outside the repo by default; in edit mode the repo's file is changed and
// put back on stop, with a backup kept until then so a crash can't lose it (restoreLeftovers).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { choiceValues, k8sName, mergeProxy, namesApi, needsUiPort, pickedApis, pickedServices, readLooseJson, runLabel, serviceSteps, stackRules, stackSteps, uiHomePort, uiPortFor, uiProject, uiUrlFor, validateStack, type Stack, type StackApiRow, type StackChoice, type StackInfo, type StackRunContext } from '../shared/stack.ts';
import { uiApp } from '../shared/stack-detect.ts';
import type { RunRecipe } from '../shared/recipes.ts';
import { run } from './hosts.ts';
import { PortPool, type UiPortPick } from './ports.ts';
import type { RunOptions, RunPlaces } from './recipes.ts';
import { repoFiles } from './repo-files.ts';
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

export { readLooseJson } from '../shared/stack.ts';

/**
 * A run of the stack for a card: the steps for what was picked, with a local port picked for each
 * API (and the UI, when it asks for {{uiPort}}) from `pool`, and the proxy file written. Throws
 * what's wrong (an API or UI repo the card doesn't have, a proxy file that isn't there or isn't
 * JSON, no port left), having taken nothing.
 */
export async function prepareStackRun(stack: StackInfo, choice: StackChoice, places: RunPlaces, cardId: string, dir: string, pool = new PortPool(), who = cardId): Promise<{ recipe: RunRecipe; opts: RunOptions }> {
  const session = await prepareStackSession(stack, choice, places, cardId, dir, pool, who);
  const steps = stackSteps(stack, session.choice, session.ctx);
  const url = uiUrlFor(stack, session.choice, session.ctx);
  return {
    recipe: { repo: '', workspaceId: stack.workspaceId, steps, ...(url ? { url } : {}), source: stack.source },
    opts: { choice: session.label, cleanup: session.end, ...(session.uiNote ? { note: session.uiNote } : {}) },
  };
}

/**
 * A card's stack session (§82): what was picked, the ports reserved for each API and the UI, the
 * branches, and the proxy copy, kept while any service runs so one service can be started, stopped
 * or started again without the others losing their ports or the UI its rules. `end` frees it all.
 */
export interface StackSession {
  cardId: string;
  stack: StackInfo;
  choice: StackChoice;
  ctx: StackRunContext;
  places: RunPlaces;
  /** The services in start order: each API, then the UI. */
  services: string[];
  label: string;
  /** What the UI's run should say about its port (§122): off its own port, and why. */
  uiNote?: string;
  end: () => void;
}

/**
 * Reserve what a run of the stack needs for a card, having taken nothing on an error: the picked
 * APIs' and the UI's folders checked, their branches read, a port per API (and the UI when it takes
 * one), and the proxy copy written with the picked APIs' rules. The steps come per service from
 * serviceRecipe.
 */
export async function prepareStackSession(stack: StackInfo, choice: StackChoice, places: RunPlaces, cardId: string, dir: string, pool = new PortPool(), who = cardId): Promise<StackSession> {
  const values = choiceValues(stack, choice.values);
  const apis = pickedApis(stack, choice.apis);
  const pick = { values, apis: apis.map((a) => a.repo) };
  const where = (repo: string, what: string) => {
    const d = places.repos[repo.toLowerCase()];
    if (!d || !existsSync(d)) throw new Error(`${what} ${repo} isn’t in this card or its workspace. Add it to the card’s context, or fix the name in the stack (e, then Alt+W).`);
    return d;
  };
  const branches: Record<string, string> = {};
  for (const a of apis) branches[a.repo.toLowerCase()] = await branchOf(where(a.repo, 'The API'));
  const uiDir = stack.ui ? where(stack.ui.repo, 'The UI') : undefined;
  if (stack.ui && uiDir) branches[stack.ui.repo.toLowerCase()] = await branchOf(uiDir);
  // The served app's own port and baseHref, from its project file: the URL when the stack doesn't say.
  const app = stack.ui && uiDir ? uiApp(repoFiles(uiDir), uiProject(stack.ui.steps)) : undefined;
  // One port per API, and one for the UI when it takes one: given back when the session ends. The
  // UI keeps its own port when it's free, where its sign-in is registered (§122).
  const picked = await pool.take(apis.length);
  const ports: Record<string, number> = {};
  apis.forEach((a, i) => { ports[a.repo.toLowerCase()] = picked[i]; });
  let ui: UiPortPick | undefined;
  try {
    ui = needsUiPort(stack) ? await pool.takeUi(uiHomePort(stack, app), who) : undefined;
  } catch (e) {
    pool.free(picked);
    throw e;
  }
  if (ui) picked.push(ui.port);
  const uiPort = ui?.port;
  const ctx: StackRunContext = { branches, ports, ...(uiPort ? { uiPort } : {}), ...(app ? { uiApp: app } : {}) };
  try {
    let cleanup: (() => void) | undefined;
    let write: (() => void) | undefined;
    if (stack.ui && uiDir && stack.ui.proxyFile) {
      const file = join(uiDir, stack.ui.proxyFile);
      if (!existsSync(file)) throw new Error(`${stack.ui.proxyFile} isn’t in ${stack.ui.repo}. Fix "ui.proxyFile" in the stack.`);
      const original = readFileSync(file, 'utf8');
      let base: Record<string, unknown>;
      try { base = readLooseJson(original); } catch (e) { throw new Error(`${stack.ui.proxyFile} couldn’t be read as JSON (${(e as Error).message}). Only JSON proxy files can be pointed at the APIs for now.`); }
      const merged = `${JSON.stringify(mergeProxy(base, stackRules(stack, pick, ctx)), null, 2)}\n`;
      const edit = stack.ui.proxyMode === 'edit';
      const out = edit ? file : join(dir, `${cardId}.proxy.conf.json`);
      ctx.proxy = out;
      const backup = join(dir, `${cardId}.backup.json`);
      // Written only once every service's steps have been built, so a mistake in the stack changes nothing.
      write = () => {
        mkdirSync(dir, { recursive: true });
        if (edit) writeFileSync(backup, JSON.stringify({ path: file, text: original }));
        writeFileSync(out, merged);
      };
      cleanup = edit ? () => { writeFileSync(file, original); rmSync(backup, { force: true }); } : () => rmSync(out, { force: true });
    }
    const services = pickedServices(stack, pick);
    for (const sv of services) serviceSteps(stack, pick, ctx, sv);
    write?.();
    const undo = cleanup;
    let ended = false;
    return {
      cardId, stack, choice: pick, ctx, places, services,
      label: runLabel(values, pick.apis, ports, stack.ui ? uiPortFor(stack, pick, ctx) : undefined, stack.ui ? uiProject(stack.ui.steps) ?? app?.name : undefined),
      ...(ui?.note ? { uiNote: ui.note } : {}),
      end: () => { if (ended) return; ended = true; pool.free(picked); undo?.(); },
    };
  } catch (e) {
    pool.free(picked);
    throw e;
  }
}

/** One service's recipe for the session: its steps then its stop: steps; the UI's carries the app's URL. */
export function serviceRecipe(session: StackSession, service: string): RunRecipe {
  const { stack, choice, ctx } = session;
  if (!session.services.includes(service)) throw new Error(`${service} wasn’t picked for this run. Pick it and start again.`);
  const { steps, stop } = serviceSteps(stack, choice, ctx, service);
  const url = service === 'ui' ? uiUrlFor(stack, choice, ctx) : undefined;
  return { repo: '', workspaceId: stack.workspaceId, steps: [...steps, ...stop], ...(url ? { url } : {}), source: stack.source };
}
