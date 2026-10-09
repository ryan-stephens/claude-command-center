// Each session's stack on the Switchboard: one UI and as many APIs as the work needs, run with v1's
// RunService from the session's worktrees (an API the session hasn't got a worktree of runs from its
// main checkout). The UI is pointed at the running APIs through its proxy file (proxy.conf.json):
// the APIs not running here keep the file's own rules, which go to Dev. Adding or removing an API
// rebuilds that file and restarts the UI, since a dev server reads it only when it starts.
// The UI goes behind the front door on its own port (the one its sign-in is registered for).
// A small manifest per running stack lets the next start clean up after a server that went away.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OKTETO_UP, runKey, type CardRun, type LogLine } from '../../shared/recipes.ts';
import { choiceValues, k8sName, mergeProxy, needsUiPort, pickedApis, readLooseJson, serviceSteps, stackRules, uiHomePort, uiPortFor, uiProject, uiUrlFor, type StackInfo, type StackRunContext } from '../../shared/stack.ts';
import { uiApp } from '../../shared/stack-detect.ts';
import type { FrontDoors } from '../../server/front-door.ts';
import { run as sh } from '../../server/hosts.ts';
import { listening, type PortPool } from '../../server/ports.ts';
import { RunService, type RunPlaces } from '../../server/recipes.ts';
import { repoFiles } from '../../server/repo-files.ts';
import { cardLogsDir } from '../../server/run-logs.ts';
import { restoreLeftovers } from '../../server/stack.ts';
import type { Leftover, ServiceView, StackView } from '../shared/types.ts';
import { nextHealth, type Track } from './health.ts';

export const PROBE_MS = 5_000;

/** What a stack needs to know about its session. */
export interface StackOwner {
  id: string;
  key: string;
  /** Lower-case repo name → the folder it runs from: the session's worktree, else the workspace's checkout. */
  places: RunPlaces;
}

interface Live {
  owner: StackOwner;
  stack: StackInfo;
  values: Record<string, string>;
  /** The APIs running, in the stack's order (its casing). */
  apis: string[];
  ctx: StackRunContext;
  /** Every port taken from the pool for this stack. */
  taken: number[];
  /** The UI's door, when it is behind one. */
  door?: number;
  proxy?: { file: string; out: string; original: string; edit: boolean; backup: string };
  health: Map<string, Track>;
}

interface Manifest {
  id: string;
  key: string;
  /** Each service's stop: steps, with the folders they run in. */
  stops: { service: string; steps: string[]; places: RunPlaces }[];
}

export interface StackOpts {
  dir: string;
  pool: PortPool;
  doors?: FrontDoors;
  env: NodeJS.ProcessEnv;
  changed: () => void;
  lines?: (key: string, lines: LogLine[], reset: boolean) => void;
  keyOf: (id: string) => string | undefined;
}

export class StackManager {
  private live = new Map<string, Live>();
  private runs: RunService;
  private probe: NodeJS.Timeout | null = null;
  private dir: string;

  private opts: StackOpts;

  constructor(opts: StackOpts) {
    this.opts = opts;
    this.dir = opts.dir;
    mkdirSync(join(this.dir, 'stacks'), { recursive: true });
    this.runs = new RunService(() => opts.changed(), opts.env, {
      pool: opts.pool,
      logDir: (id) => { const k = opts.keyOf(id); return k ? this.logsDir(k) : undefined; },
      lines: opts.lines,
    });
  }

  logsDir(key: string): string {
    return cardLogsDir(this.dir, key);
  }

  isRunning(id: string): boolean {
    return this.live.has(id);
  }

  apisOf(id: string): string[] {
    return this.live.get(id)?.apis ?? [];
  }

  /**
   * Bring a session's stack up with these APIs (by repo name). Already up: the APIs not running yet
   * are added (one proxy rebuild, one UI restart). Throws what's wrong, having started nothing.
   */
  async up(owner: StackOwner, stack: StackInfo, apis: string[], values: Record<string, string> = {}): Promise<void> {
    const have = this.live.get(owner.id);
    if (have) {
      const more = pickedApis(stack, apis).map((a) => a.repo).filter((a) => !have.apis.some((x) => x.toLowerCase() === a.toLowerCase()));
      if (more.length) await this.add(owner.id, more);
      return;
    }
    const picked = pickedApis(stack, apis).map((a) => a.repo);
    const vals = choiceValues(stack, values);
    const where = (repo: string, what: string) => {
      const d = owner.places.repos[repo.toLowerCase()];
      if (!d || !existsSync(d)) throw new Error(`${what} ${repo} isn’t in this session or its workspace.`);
      return d;
    };
    const branches: Record<string, string> = {};
    for (const a of picked) branches[a.toLowerCase()] = await branchOf(where(a, 'The API'));
    const uiDir = stack.ui ? where(stack.ui.repo, 'The UI') : undefined;
    if (stack.ui && uiDir) branches[stack.ui.repo.toLowerCase()] = await branchOf(uiDir);
    const app = stack.ui && uiDir ? uiApp(repoFiles(uiDir), uiProject(stack.ui.steps)) : undefined;
    const taken = await this.opts.pool.take(picked.length);
    const ports: Record<string, number> = {};
    picked.forEach((a, i) => { ports[a.toLowerCase()] = taken[i]; });
    const live: Live = { owner, stack, values: vals, apis: picked, ctx: { branches, ports, ...(app ? { uiApp: app } : {}) }, taken, health: new Map() };
    try {
      if (needsUiPort(stack)) await this.uiPort(live, uiHomePort(stack, app));
      this.writeProxy(live, uiDir);
      // Every service's steps built before anything starts, so a mistake in the stack starts nothing.
      for (const sv of this.services(live)) serviceSteps(stack, this.pick(live), live.ctx, sv);
    } catch (e) {
      this.release(live);
      throw e;
    }
    this.live.set(owner.id, live);
    this.writeManifest(live);
    for (const sv of this.services(live)) this.startService(live, sv);
    this.watch();
    this.opts.changed();
  }

  /** Add APIs to a running stack: a port each, the proxy rebuilt, each started, then the UI restarted. */
  async add(id: string, apis: string[]): Promise<void> {
    const live = this.need(id);
    const more = pickedApis(live.stack, apis).map((a) => a.repo).filter((a) => !live.apis.some((x) => x.toLowerCase() === a.toLowerCase()));
    if (!more.length) return;
    for (const a of more) {
      const d = live.owner.places.repos[a.toLowerCase()];
      if (!d || !existsSync(d)) throw new Error(`The API ${a} isn’t in this session or its workspace.`);
      live.ctx.branches[a.toLowerCase()] = await branchOf(d);
    }
    const got = await this.opts.pool.take(more.length);
    live.taken.push(...got);
    more.forEach((a, i) => { live.ctx.ports![a.toLowerCase()] = got[i]; });
    live.apis = live.stack.apis.map((a) => a.repo).filter((r) => [...live.apis, ...more].some((x) => x.toLowerCase() === r.toLowerCase()));
    this.rewriteProxy(live);
    this.writeManifest(live);
    for (const a of more) this.startService(live, a);
    if (live.stack.ui) this.startService(live, 'ui');
    this.opts.changed();
  }

  /** Take an API out: it stops, its port goes back, the proxy is rebuilt and the UI restarted. */
  async remove(id: string, api: string): Promise<void> {
    const live = this.need(id);
    const name = live.apis.find((a) => a.toLowerCase() === api.toLowerCase());
    if (!name) return;
    await this.runs.stop(runKey(id, name), true);
    const port = live.ctx.ports?.[name.toLowerCase()];
    if (port) { this.opts.pool.free([port]); live.taken = live.taken.filter((p) => p !== port); delete live.ctx.ports![name.toLowerCase()]; }
    live.apis = live.apis.filter((a) => a !== name);
    live.health.delete(name);
    this.rewriteProxy(live);
    this.writeManifest(live);
    if (live.stack.ui) this.startService(live, 'ui');
    this.opts.changed();
  }

  /** Start one service again (its stop: steps run first). */
  restart(id: string, service: string): void {
    const live = this.need(id);
    if (!this.services(live).includes(service)) throw new Error(`${service} isn’t part of this stack.`);
    this.startService(live, service);
  }

  /** Every service that was up and stopped answering, started again. */
  restartUnhealthy(id: string): string[] {
    const live = this.need(id);
    const bad = this.services(live).filter((sv) => ['unhealthy', 'failed'].includes(live.health.get(sv)?.health ?? ''));
    for (const sv of bad) this.startService(live, sv);
    return bad;
  }

  /** Stop the whole stack: services in reverse, their stop: steps, ports back, door left, proxy undone. */
  async down(id: string): Promise<void> {
    const live = this.live.get(id);
    if (!live) return;
    await this.runs.stopCard(id, true);
    this.release(live);
    this.live.delete(id);
    rmSync(this.manifestFile(id), { force: true });
    if (!this.live.size) this.unwatch();
    this.opts.changed();
  }

  /** The server is going away: kill what runs (no time for stop: steps; the manifests keep them for the next start). */
  stopAll(): void {
    this.runs.stopAll();
    for (const live of this.live.values()) this.undoProxy(live);
    this.opts.doors?.closeAll();
    this.unwatch();
  }

  log(id: string, service: string): LogLine[] {
    return this.runs.log(runKey(id, service));
  }

  /** The door shows this session's UI. */
  show(id: string): number | undefined {
    return this.opts.doors?.show(id);
  }

  view(id: string): StackView | undefined {
    const live = this.live.get(id);
    if (!live) return undefined;
    const okteto = live.stack.api.steps.some((l) => OKTETO_UP.test(l));
    const services: ServiceView[] = this.services(live).map((sv) => {
      // An up service keeps what the last probe found; anything else follows its run at once.
      const prev = live.health.get(sv);
      const run = this.runs.get(runKey(id, sv));
      const t = run?.state === 'up' && prev && (prev.health === 'up' || prev.health === 'unhealthy') ? prev : nextHealth(prev, run, undefined, Date.now());
      live.health.set(sv, t);
      const isUi = sv === 'ui';
      const port = isUi ? this.uiPortNow(live) : live.ctx.ports?.[sv.toLowerCase()];
      const where = isUi ? (live.door ? `:${port} behind the front door :${live.door}` : port ? `:${port}` : 'its own port') : `${okteto ? 'okteto · forwarded' : 'local'} :${port}`;
      return { name: isUi ? (live.stack.ui?.repo ?? 'ui') : sv, kind: isUi ? 'ui' : 'api', ...(port ? { port } : {}), where, health: t.health, since: t.since, ...(t.note ? { note: t.note } : {}) };
    });
    const door = this.opts.doors?.stateOf(id);
    const url = live.stack.ui ? uiUrlFor(live.stack, this.pick(live), live.ctx) : undefined;
    const uiUrl = door ? (url ? url.replace(/^(https?:\/\/[^/:]+):\d+/, `$1:${door.port}`) : `http://localhost:${door.port}`) : url;
    return { sessionId: id, values: live.values, services, ...(uiUrl ? { uiUrl } : {}), ...(door ? { door: { home: door.port, shown: door.shown } } : {}) };
  }

  views(): Record<string, StackView> {
    const out: Record<string, StackView> = {};
    for (const id of this.live.keys()) { const v = this.view(id); if (v) out[id] = v; }
    return out;
  }

  // ---- Leftovers --------------------------------------------------------------------------------

  /** What a server that went away left: stacks whose stop: steps never ran, and proxy files changed in place (put back now). */
  leftovers(): Leftover[] {
    const restored = restoreLeftovers(join(this.dir, 'stacks'));
    if (restored.length) console.log(`v2: put back ${restored.length} proxy file(s) a stopped server had changed.`);
    const out: Leftover[] = [];
    for (const f of readdirSync(join(this.dir, 'stacks'))) {
      if (!f.endsWith('.stack.json')) continue;
      try {
        const m = JSON.parse(readFileSync(join(this.dir, 'stacks', f), 'utf8')) as Manifest;
        if (this.live.has(m.id)) continue;
        const steps = m.stops.flatMap((s) => s.steps);
        if (!steps.length) { rmSync(join(this.dir, 'stacks', f), { force: true }); continue; }
        out.push({ id: m.id, key: m.key, text: `${steps.length} stop step${steps.length === 1 ? '' : 's'} never ran (${steps.map((s) => s.replace(/^@\S+\s+/, '').replace(/^stop:\s*/, '')).slice(0, 2).join('; ')})` });
      } catch { /* left for a person to look at */ }
    }
    return out;
  }

  /** Run a leftover's stop: steps now (each its own run, so its output is in the logs), then forget it. */
  async cleanLeftover(id: string): Promise<void> {
    const file = this.manifestFile(id);
    if (!existsSync(file) || this.live.has(id)) return;
    const m = JSON.parse(readFileSync(file, 'utf8')) as Manifest;
    for (const s of m.stops) {
      const key = runKey(`leftover-${id}`, s.service);
      // A run of only stop: steps: nothing starts, and stopping it runs them (two minutes each at most).
      await this.runs.start(key, { repo: '', steps: s.steps, source: 'left over from a server that stopped' }, s.places, { cardId: `leftover-${id}`, service: s.service });
      await this.runs.stop(key, true);
    }
    rmSync(file, { force: true });
    this.opts.changed();
  }

  // ---- Inside -----------------------------------------------------------------------------------

  private need(id: string): Live {
    const live = this.live.get(id);
    if (!live) throw new Error('The stack isn’t running: start it first.');
    return live;
  }

  private pick(live: Live) {
    return { values: live.values, apis: live.apis };
  }

  private services(live: Live): string[] {
    return [...live.apis, ...(live.stack.ui ? ['ui'] : [])];
  }

  private uiPortNow(live: Live): number | undefined {
    return live.stack.ui ? (live.ctx.uiPort ?? uiPortFor(live.stack, this.pick(live), live.ctx)) : undefined;
  }

  private startService(live: Live, service: string): void {
    const { steps, stop } = serviceSteps(live.stack, this.pick(live), live.ctx, service);
    const url = service === 'ui' ? uiUrlFor(live.stack, this.pick(live), live.ctx) : undefined;
    live.health.delete(service);
    void this.runs.start(runKey(live.owner.id, service), { repo: '', workspaceId: live.stack.workspaceId, steps: [...steps, ...stop], ...(url ? { url } : {}), source: live.stack.source },
      live.owner.places, { cardId: live.owner.id, service, choice: Object.values(live.values).join(' · ') })
      .catch((e: Error) => console.error(`v2: ${service} for ${live.owner.key} didn't start: ${e.message}`));
  }

  /** The UI's port: behind the door on its own port when it can be, else its own port when free, else one from the pool. */
  private async uiPort(live: Live, home: number | undefined): Promise<void> {
    const doors = this.opts.doors;
    if (doors && home && (doors.isOpen(home) || !(await listening(home)))) {
      const [port] = await this.opts.pool.take(1);
      try {
        await doors.join(home, live.owner.id, live.owner.key, port);
        live.taken.push(port);
        live.ctx.uiPort = port;
        live.door = home;
        return;
      } catch {
        this.opts.pool.free([port]);
      }
    }
    const pick = await this.opts.pool.takeUi(home, live.owner.key);
    live.taken.push(pick.port);
    live.ctx.uiPort = pick.port;
  }

  /** Write the UI's proxy file with the running APIs' rules: a copy outside the repo, or the file itself in edit mode (backed up first). */
  private writeProxy(live: Live, uiDir: string | undefined): void {
    const ui = live.stack.ui;
    if (!ui || !uiDir || !ui.proxyFile) return;
    const file = join(uiDir, ui.proxyFile);
    if (!existsSync(file)) throw new Error(`${ui.proxyFile} isn’t in ${ui.repo}. Fix "ui.proxyFile" in the workspace's stack.`);
    const original = readFileSync(file, 'utf8');
    try { readLooseJson(original); } catch (e) { throw new Error(`${ui.proxyFile} couldn’t be read as JSON (${(e as Error).message}).`); }
    const edit = ui.proxyMode === 'edit';
    const id = live.owner.id;
    live.proxy = { file, original, edit, out: edit ? file : join(this.dir, 'stacks', `${id}.proxy.conf.json`), backup: join(this.dir, 'stacks', `${id}.backup.json`) };
    live.ctx.proxy = live.proxy.out;
    if (edit) writeFileSync(live.proxy.backup, JSON.stringify({ path: file, text: original }));
    this.rewriteProxy(live);
  }

  /** The proxy file again, for the APIs running now. */
  private rewriteProxy(live: Live): void {
    if (!live.proxy) return;
    const merged = mergeProxy(readLooseJson(live.proxy.original), stackRules(live.stack, this.pick(live), live.ctx));
    writeFileSync(live.proxy.out, `${JSON.stringify(merged, null, 2)}\n`);
  }

  private undoProxy(live: Live): void {
    const p = live.proxy;
    if (!p) return;
    try {
      if (p.edit) { writeFileSync(p.file, p.original); rmSync(p.backup, { force: true }); } else rmSync(p.out, { force: true });
    } catch (e) { console.error(`v2: couldn't put the proxy file back: ${(e as Error).message}`); }
    live.proxy = undefined;
  }

  private release(live: Live): void {
    this.opts.pool.free(live.taken.splice(0));
    if (live.door) this.opts.doors?.leave(live.owner.id);
    this.undoProxy(live);
  }

  private manifestFile(id: string): string {
    return join(this.dir, 'stacks', `${id}.stack.json`);
  }

  private writeManifest(live: Live): void {
    const stops = this.services(live).map((sv) => ({ service: sv, steps: serviceSteps(live.stack, this.pick(live), live.ctx, sv).stop, places: live.owner.places }));
    const m: Manifest = { id: live.owner.id, key: live.owner.key, stops };
    writeFileSync(this.manifestFile(live.owner.id), JSON.stringify(m, null, 2));
  }

  /** Probe every running service's port every few seconds; tell the page only when a health changed. */
  private watch(): void {
    if (this.probe) return;
    this.probe = setInterval(() => { void this.check(); }, PROBE_MS);
  }

  private unwatch(): void {
    if (this.probe) clearInterval(this.probe);
    this.probe = null;
  }

  async check(now = Date.now()): Promise<void> {
    let moved = false;
    for (const [id, live] of this.live) {
      for (const sv of this.services(live)) {
        const run: CardRun | undefined = this.runs.get(runKey(id, sv));
        const port = sv === 'ui' ? this.uiPortNow(live) : live.ctx.ports?.[sv.toLowerCase()];
        const answered = run?.state === 'up' && port ? await listening(port) : undefined;
        const prev = live.health.get(sv);
        const next = nextHealth(prev, run, answered, now);
        live.health.set(sv, next);
        if (!prev || prev.health !== next.health || prev.note !== next.note) moved = true;
      }
    }
    if (moved) this.opts.changed();
  }
}

async function branchOf(dir: string): Promise<string> {
  const o = await sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir, undefined, 10_000);
  return o.code === 0 && o.out && o.out !== 'HEAD' ? k8sName(o.out) : 'main';
}
