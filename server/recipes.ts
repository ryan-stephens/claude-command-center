// Run recipes on the server: detect one per repo (package.json, compose.yaml, a plain node
// server), keep the ones you wrote (per repo, or a workspace's spanning its repos), and run a
// card's recipe as child processes for Try it: each step in the card's folder or the repo it
// names, with its own variables; stop: steps run when it is stopped. A step that keeps running and serves (prints a localhost URL, or its port opens) is the
// app: the run moves on to the next step and the app stays up until you stop it. A step that says
// wait: is ready only when that text shows or that port opens (an API on a dev environment).

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { isAbsolute, join } from 'node:path';
import { FORWARD_MANIFEST, rewriteForward } from '../shared/okteto.ts';
import { findUrl, LOG_KEEP, MAX_STEPS, portOf, specsOf, stepLabel, waitLabel, type CardRun, type LogLine, type RunRecipe, type StepSpec } from '../shared/recipes.ts';
import { repoName } from '../shared/workspaces.ts';
import { withoutSecrets } from './config.ts';
import { withDeps } from './deps.ts';
import { listening } from './ports.ts';
import type { Store } from './store.ts';

function readJson(file: string): Record<string, unknown> | undefined {
  try { return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { return undefined; }
}

function readText(file: string): string {
  try { return readFileSync(file, 'utf8'); } catch { return ''; }
}

const COMPOSE = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];
/** Scripts that prepare the app, run before it in this order when present. */
const SETUP = ['db:migrate', 'migrate', 'db:seed', 'seed'];
/** The script that starts the app: the first one present. */
const APP = ['dev', 'start', 'serve', 'preview'];
const NODE_APPS = ['server.js', 'server.mjs', 'app.js', 'index.js', 'main.js'];

/** Where a dev script will serve, when it says: an explicit port, or the tool's default. */
export function urlFromScript(script: string): string | undefined {
  const port = /(?:--port[= ]|-p )(\d{2,5})\b/.exec(script)?.[1] ?? /\bPORT=(\d{2,5})\b/.exec(script)?.[1];
  if (port) return `http://localhost:${port}`;
  if (/\bastro\b/.test(script)) return 'http://localhost:4321';
  if (/\bvite\b|svelte-kit dev/.test(script)) return 'http://localhost:5173';
  if (/\bnext\b|\bnuxt\b|react-scripts|\bremix\b/.test(script)) return 'http://localhost:3000';
  return undefined;
}

/** How a repo's app starts, read from its files; undefined when there is nothing to go on. */
export function detectRecipe(dir: string): RunRecipe | undefined {
  const steps: string[] = [];
  const from: string[] = [];
  let url: string | undefined;
  const compose = COMPOSE.find((f) => existsSync(join(dir, f)));
  if (compose) { steps.push('docker compose up -d'); from.push(compose); }
  const pkg = readJson(join(dir, 'package.json'));
  if (pkg) {
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : '';
    const pm = declared || (existsSync(join(dir, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(dir, 'yarn.lock')) ? 'yarn'
      : existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock')) ? 'bun' : 'npm');
    const run = (s: string) => (pm === 'pnpm' || pm === 'yarn' ? `${pm} ${s}` : `${pm} run ${s}`);
    steps.push(`${pm} install`);
    for (const s of SETUP) if (scripts[s]) steps.push(run(s));
    const app = APP.find((s) => scripts[s]);
    if (app) { steps.push(run(app)); url = urlFromScript(scripts[app]); }
    from.push('package.json');
  } else {
    // No package.json: a plain node server ("app.listen(3000)").
    const file = NODE_APPS.find((f) => /\.listen\(/.test(readText(join(dir, f))));
    if (file) {
      steps.push(`node ${file}`);
      const port = /\.listen\(\s*(\d{2,5})/.exec(readText(join(dir, file)))?.[1];
      if (port) url = `http://localhost:${port}`;
      from.push(file);
    }
  }
  if (!steps.length) return undefined;
  return { repo: dir, steps, ...(url ? { url } : {}), source: `detected from ${from.join(' + ')}` };
}

// The same repo written with either slash (a card's packet keeps the path as it was given) finds the same entry.
const key = (repo: string) => `recipe:${repo.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()}`;
const wsKey = (id: string) => `recipe:ws:${id}`;

function saved(store: Store, k: string): Pick<RunRecipe, 'steps' | 'url'> & { imported?: boolean } | undefined {
  const raw = store.getMeta(k);
  if (!raw) return undefined;
  try {
    const r = JSON.parse(raw) as Pick<RunRecipe, 'steps' | 'url'> & { imported?: boolean };
    return Array.isArray(r.steps) && r.steps.length ? r : undefined;
  } catch {
    return undefined;
  }
}

/** The recipe for a repo: the one you wrote, else the detected one. */
export function recipeOf(store: Store, repo: string): RunRecipe | undefined {
  const r = saved(store, key(repo));
  if (r) return { repo, steps: r.steps, ...(r.url ? { url: r.url } : {}), source: 'written by you', edited: true };
  return detectRecipe(repo);
}

/** A workspace's own recipe, spanning its repos, if it has one. */
export function workspaceRecipeOf(store: Store, workspaceId: string): RunRecipe | undefined {
  const r = saved(store, wsKey(workspaceId));
  if (!r) return undefined;
  return {
    repo: '', workspaceId, steps: r.steps, ...(r.url ? { url: r.url } : {}), edited: true,
    source: r.imported ? 'from the workspace file you imported: check it before running' : 'the workspace’s, written by you',
  };
}

/** Steps as typed: one line each, trimmed, at most 20. */
function cleanSteps(steps: string[]): string[] {
  return steps.map((s) => s.replace(/[\r\n]+/g, ' ').trim().slice(0, 500)).filter(Boolean).slice(0, MAX_STEPS);
}

function checkUrl(url?: string): string | undefined {
  const u = url?.trim();
  if (u && !/^https?:\/\/[^\s]+$/.test(u)) throw new Error('The address should look like http://localhost:5173');
  return u || undefined;
}

/** Save the recipe you wrote for a repo; no steps goes back to the detected one. */
export function saveRecipe(store: Store, repo: string, steps: string[], url?: string): void {
  const clean = cleanSteps(steps);
  const u = checkUrl(url);
  store.setMeta(key(repo), clean.length ? JSON.stringify({ steps: clean, ...(u ? { url: u } : {}) }) : '');
}

/** Save a workspace's recipe; no steps removes it (cards go back to their repo's). `imported`: it came in a workspace file. */
export function saveWorkspaceRecipe(store: Store, workspaceId: string, steps: string[], url?: string, imported = false): void {
  const clean = cleanSteps(steps);
  const u = checkUrl(url);
  store.setMeta(wsKey(workspaceId), clean.length ? JSON.stringify({ steps: clean, ...(u ? { url: u } : {}), ...(imported ? { imported: true } : {}) }) : '');
}

/** The recipe a card runs: its workspace's when there is one, else the one for the repo it starts in. */
export function cardRecipeOf(store: Store, workspaceId: string | null, home: string | undefined): RunRecipe | undefined {
  return (workspaceId ? workspaceRecipeOf(store, workspaceId) : undefined) ?? (home ? recipeOf(store, home) : undefined);
}

/** Output lines kept per step, and shown on the page. */
const KEEP = 200;
const SHOW = 12;
/** A step that neither exits, prints a URL nor opens its port for this long is taken to be up. */
const QUIET_UP_MS = 20_000;

/**
 * Could this step be the app? Only those are taken to be up when they go quiet or their port opens;
 * anything else (an install, a migration, a deploy) has to finish. A printed localhost URL counts for any step.
 */
export function appLike(cmd: string, last: boolean): boolean {
  return last || (/\b(dev|start|serve|preview)\b|\bup\b|^node\s+\S+\.m?js\b/.test(cmd) && !/\bup\s+-d\b|--detach/.test(cmd));
}

/**
 * §113: a dev server that compiles before it serves (Nx, Angular, webpack, Create React App, Vue
 * CLI). It prints its address and opens its port long before the app is built, so the step is up
 * only when the build says it is done.
 */
export function compiles(cmd: string): boolean {
  return /\bnx(\.cmd)?\s+(run\s+\S+:serve\b|serve\b)|\bng(\.cmd)?\s+serve\b|\bwebpack(\.cmd)?\s+(serve|s)\b|\bwebpack-dev-server\b|\breact-scripts(\.cmd)?\s+start\b|\bvue-cli-service(\.cmd)?\s+serve\b/i.test(cmd);
}

/** What a dev server's line says about its build: started, done, or failed (a later save builds again). */
export function buildLine(line: string): 'start' | 'done' | 'failed' | undefined {
  if (/failed to compile|compiled with \d+ errors?|with \d+ errors? in\b|\bbuild failed\b|bundle generation failed|^\s*ERROR in /i.test(line)) return 'failed';
  if (/compiled successfully|compiled with (\d+ )?warnings?|bundle generation complete|\bwebpack compiled\b|all remotes started|server ready at/i.test(line)) return 'done';
  if (/\bcompiling\b|\bbuilding\b|generating browser application bundles|starting module federation|\[webpack-dev-server\]/i.test(line)) return 'start';
  return undefined;
}

/** A compiling dev server that never says its build is done is taken to be up after this long. */
const BUILD_WAIT_MS = 15 * 60_000;

/** How long a wait:http: step may go without an answer below 500 before the run fails. */
const HTTP_WAIT_MS = 10 * 60_000;

/**
 * The status this address answers with, or undefined when nothing answers (refused, reset, or a
 * forwarded port with no app behind it yet). Its own agent, so no proxy from the environment is used.
 */
function answers(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const req = httpGet(url, { agent: false, timeout: 3000 }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(undefined));
  });
}

/** Kill a step and whatever it started (a dev server's children). */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
}

/** A step's variables with %NAME% filled in from the environment, as cmd would (KUBECONFIG=%USERPROFILE%\.kube\dev.yaml). */
export function expandVars(vars: Record<string, string>, env: NodeJS.ProcessEnv): Record<string, string> {
  const find = (k: string) => env[k] ?? env[Object.keys(env).find((x) => x.toLowerCase() === k.toLowerCase()) ?? ''];
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, n: string) => find(n) ?? m)]));
}

/** The okteto manifest in a folder, if it has one. */
const MANIFESTS = ['okteto.yml', 'okteto.yaml'];

/**
 * A forward: step's command: a copy of the folder's okteto manifest is written beside it with the
 * forward pointed at the picked local port, kept out of git through .git/info/exclude, and an
 * okteto command gets `-f <copy>` right after its subcommand (before any `--`). Throws when there
 * is no manifest yet (the step that writes it has to come first) or it has no forward.
 */
export function forwarded(spec: StepSpec, cwd: string): { cmd: string; made?: string } {
  if (!spec.forward) return { cmd: spec.cmd };
  const manifest = MANIFESTS.map((f) => join(cwd, f)).find((f) => existsSync(f));
  const { local, remote } = spec.forward;
  if (!manifest) throw new Error(`No okteto.yml in ${repoName(cwd)} to forward port ${local}: put forward: on the okteto up line, after the step that writes the manifest.`);
  let text: string;
  try { text = rewriteForward(readFileSync(manifest, 'utf8'), local, remote); } catch (e) { throw new Error(`Couldn’t point ${repoName(cwd)}’s okteto.yml at port ${local}: ${(e as Error).message}.`); }
  const copy = join(cwd, FORWARD_MANIFEST);
  writeFileSync(copy, text);
  excludeFromGit(cwd, FORWARD_MANIFEST);
  // The okteto command may sit after a `;` or `&&` in a one-line script ($Env:KUBECONFIG = "…"; okteto up).
  const cmd = spec.cmd.replace(/(^|[;&|]\s*)((?:\S*[\\/])?okteto(?:\.exe)?\s+[a-z]+)/i, `$1$2 -f ${FORWARD_MANIFEST}`);
  return { cmd, made: copy };
}

/** Keep a generated file out of `git status` without touching the repo's .gitignore: .git/info/exclude of the repo (shared by its worktrees). */
function excludeFromGit(cwd: string, name: string): void {
  const r = spawnSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  if (r.status !== 0) return;
  const common = r.stdout.trim();
  const file = join(isAbsolute(common) ? common : join(cwd, common), 'info', 'exclude');
  try {
    const have = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (!have.split(/\r?\n/).includes(name)) appendFileSync(file, `${have && !have.endsWith('\n') ? '\n' : ''}${name}\n`);
  } catch { /* the step still runs; the copy may show in git status */ }
}

/**
 * Start a step: through cmd (or sh), or PowerShell for ps: steps. answers: are typed into its
 * input, one line each (PowerShell's Read-Host and choice prompts read them); otherwise it has none.
 * `made` collects files the step had written for it (a forward: manifest copy), removed on stop.
 */
function launch(spec: StepSpec, cwd: string, base: NodeJS.ProcessEnv, detach = process.platform !== 'win32', made?: string[]): ChildProcess {
  const env = { ...base, ...expandVars(spec.env, base) };
  const stdio: ['pipe' | 'ignore', 'pipe', 'pipe'] = [spec.answers ? 'pipe' : 'ignore', 'pipe', 'pipe'];
  const f = forwarded(spec, cwd);
  if (f.made) made?.push(f.made);
  const child = spec.ps
    ? spawn(process.platform === 'win32' ? 'powershell.exe' : 'pwsh', ['-NoLogo', '-Command', f.cmd], { cwd, env, windowsHide: true, detached: detach, stdio })
    : spawn(f.cmd, { cwd, env, shell: true, windowsHide: true, detached: detach, stdio });
  if (spec.answers) { child.stdin?.on('error', () => {}); child.stdin?.end(spec.answers.map((a) => `${a}\r\n`).join('')); }
  return child;
}

/** Where a run's steps go: the card's folder, and its repos (and its workspace's) by folder name. */
export interface RunPlaces {
  cwd: string;
  /** Lower-case folder name → path; the card's own repo maps to its folder (its worktree, if it has one). */
  repos: Record<string, string>;
}

interface Live {
  run: CardRun;
  specs: StepSpec[];
  places: RunPlaces;
  procs: ChildProcess[];
  /** Full output per step; the run carries only the tail. */
  lines: string[][];
  /** Every line in order, numbered, with a mark where each step starts: what the page's Output view follows (§84). */
  log: LogLine[];
  /** Lines since the last flush to the page's followers. */
  fresh: LogLine[];
  /** The number the next line gets. */
  seq: number;
  /** Files written for steps (forward: manifest copies), removed when the run stops. */
  made: string[];
  stopped: boolean;
  /** The stop in progress (its stop: steps can take minutes); a start waits for it. */
  stopping?: Promise<void>;
  /** Runs once the run is stopped and its stop: steps are done (put a proxy file back, say). */
  cleanup?: () => void;
}

/** Extra for a run: what was picked (shown on the page), what to undo when it stops, and for a stack's service (§82) the card and service it belongs to. */
export interface RunOptions {
  choice?: string;
  cleanup?: () => void;
  /** The card the run belongs to, when the key isn't the card's id (a service's run is kept under runKey(card, service)). */
  cardId?: string;
  service?: string;
}

/** Runs cards' recipes, one per key: a card's id, or runKey(card, service) for one service of its stack (§82). Starting a key again stops that run first (and runs its stop: steps). */
export class RunService {
  private live = new Map<string, Live>();
  private timer: NodeJS.Timeout | null = null;
  private logTimer: NodeJS.Timeout | null = null;
  private changed: () => void;
  private lines?: (key: string, lines: LogLine[], reset: boolean) => void;
  private env: NodeJS.ProcessEnv;
  private httpWaitMs: number;
  private buildWaitMs: number;

  /**
   * `httpWaitMs`: how long a wait:http: step may wait (tests shorten it). `lines`: the run's output as
   * it comes, for whoever follows it on the page (§84): `reset` says the run started afresh, so the
   * lines are the whole log; otherwise they are the ones since the last call.
   */
  constructor(changed: () => void, env: NodeJS.ProcessEnv, opts: { httpWaitMs?: number; buildWaitMs?: number; lines?: (key: string, lines: LogLine[], reset: boolean) => void } = {}) {
    this.changed = changed;
    this.lines = opts.lines;
    this.httpWaitMs = opts.httpWaitMs ?? HTTP_WAIT_MS;
    this.buildWaitMs = opts.buildWaitMs ?? BUILD_WAIT_MS;
    // Plain output, no dev server opening a browser of its own (o opens it), and no tokens from the settings file.
    this.env = { ...withoutSecrets(env), FORCE_COLOR: '0', NO_COLOR: '1', BROWSER: 'none', PYTHONUNBUFFERED: '1' };
  }

  list(): CardRun[] {
    return [...this.live.values()].map((l) => l.run);
  }

  get(key: string): CardRun | undefined {
    return this.live.get(key)?.run;
  }

  /** Every run of a card: its own, and its services'. */
  ofCard(cardId: string): CardRun[] {
    return [...this.live.values()].map((l) => l.run).filter((r) => r.cardId === cardId);
  }

  /** The keys of a card's runs. */
  private keysOf(cardId: string): string[] {
    return [...this.live.entries()].filter(([, l]) => l.run.cardId === cardId).map(([k]) => k);
  }

  /** Tell the page, at most every 250 ms while output streams. */
  private soon(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.changed(); }, 250);
  }

  /** A run's output so far, oldest first (empty for a key with no run). */
  log(key: string): LogLine[] {
    return this.live.get(key)?.log ?? [];
  }

  /** Keep a line of a run's output and hand it to the followers soon (at most every 100 ms). */
  private logLine(live: Live, step: number, text: string, mark?: true): void {
    const line: LogLine = { n: live.seq++, t: Date.now(), step, text, ...(mark ? { mark } : {}) };
    live.log.push(line);
    if (live.log.length > LOG_KEEP) live.log.splice(0, live.log.length - LOG_KEEP);
    if (!this.lines) return;
    live.fresh.push(line);
    if (this.logTimer) return;
    this.logTimer = setTimeout(() => {
      this.logTimer = null;
      for (const [k, l] of this.live) if (l.fresh.length) this.lines?.(k, l.fresh.splice(0), false);
    }, 100);
  }

  /** Where a step runs, or why it can't. */
  private where(places: RunPlaces, spec: StepSpec): string | { error: string } {
    if (!spec.repo) return places.cwd;
    return places.repos[spec.repo.toLowerCase()] ?? { error: `No repo called ${spec.repo} in this card or its workspace (${Object.keys(places.repos).join(', ') || 'none'}).` };
  }

  /** Stop what runs now (with its stop: steps), then run the recipe. `places` or a plain folder for a repo's own recipe. */
  async start(key: string, recipe: RunRecipe, places: RunPlaces | string, opts: RunOptions = {}): Promise<CardRun> {
    await this.stop(key, true);
    const at: RunPlaces = typeof places === 'string' ? { cwd: places, repos: {} } : places;
    // A folder without its packages (a card's new worktree) gets them first (§110).
    const specs = withDeps(specsOf(recipe), (s) => this.where(at, s));
    const run: CardRun = {
      cardId: opts.cardId ?? key, repo: recipe.repo, cwd: at.cwd, state: 'running', startedAt: Date.now(), ...(recipe.url ? { url: recipe.url } : {}),
      ...(opts.service ? { service: opts.service } : {}),
      steps: specs.map((s) => ({
        cmd: s.cmd, state: s.note ? 'note' : 'wait', tail: [],
        ...(s.repo ? { repo: s.repo } : {}), ...(Object.keys(s.env).length ? { env: Object.keys(s.env) } : {}), ...(s.stop ? { stop: true } : {}),
        ...(s.wait ? { waitFor: waitLabel(s) } : {}),
      })),
      text: `Starting ${opts.service ?? (recipe.workspaceId ? 'the workspace' : repoName(recipe.repo))}`,
      ...(opts.choice ? { choice: opts.choice } : {}),
    };
    const live: Live = { run, specs, places: at, procs: [], lines: specs.map(() => []), log: [], fresh: [], seq: 1, made: [], stopped: false, ...(opts.cleanup ? { cleanup: opts.cleanup } : {}) };
    this.live.set(key, live);
    // A fresh log: whoever follows this key starts over (the service was started again).
    this.lines?.(key, [], true);
    this.step(live, 0);
    this.changed();
    return run;
  }

  /** The index of the next step to run from i: skipping notes and stop: steps. */
  private nextFrom(live: Live, i: number): number {
    while (i < live.specs.length && (live.specs[i].note || live.specs[i].stop)) i++;
    return i;
  }

  private step(live: Live, from: number): void {
    const { run } = live;
    if (live.stopped) return;
    const i = this.nextFrom(live, from);
    const runnable = live.specs.map((_s, k) => k).filter((k) => !live.specs[k].note && !live.specs[k].stop);
    if (i >= live.specs.length) {
      const up = run.steps.some((s) => s.state === 'up');
      run.state = up ? 'up' : 'done';
      run.text = up ? (run.url ? `Running at ${run.url}` : 'Running') : 'Every step finished';
      this.changed();
      return;
    }
    const spec = live.specs[i];
    const step = run.steps[i];
    const cwd = this.where(live.places, spec);
    if (typeof cwd !== 'string') {
      step.state = 'bad';
      step.tail = [cwd.error];
      run.state = 'failed';
      run.text = `${stepLabel(spec)} can’t run`;
      this.changed();
      return;
    }
    step.state = 'go';
    run.text = stepLabel(spec);
    const last = i === runnable[runnable.length - 1];
    this.logLine(live, i, `$ ${spec.cmd}`, true);
    let child: ChildProcess;
    try {
      child = launch(spec, cwd, this.env, undefined, live.made);
    } catch (e) {
      // What a forward: step needed wasn't there: the run stops here, with the reason on the step.
      step.state = 'bad';
      step.tail = [(e as Error).message];
      this.logLine(live, i, (e as Error).message);
      run.state = 'failed';
      run.text = `${stepLabel(spec)} can’t run`;
      this.changed();
      return;
    }
    live.procs.push(child);
    let moved = false;
    const next = () => { if (!moved) { moved = true; this.step(live, i + 1); } };
    // §113: a compiling dev server is up when its build is done, not when it first prints its address.
    let building = !spec.wait && compiles(spec.cmd);
    let built = false;
    let builtUrl: string | undefined;
    let cap: NodeJS.Timeout | null = null;
    const startBuild = () => {
      building = true;
      if (!cap) cap = setTimeout(() => { if (built || moved || step.state !== 'go') return; built = true; step.waitNote = 'no build-finished line seen; taken to be up'; up(builtUrl); }, this.buildWaitMs);
      if (!step.waitNote) { step.waitNote = 'compiling…'; this.soon(); }
    };
    if (building) startBuild();
    const up = (url?: string) => {
      if (moved || step.state !== 'go') return;
      if (building && !built) { builtUrl = url ?? builtUrl; return; }
      if (cap) clearTimeout(cap);
      if (step.waitNote === 'compiling…') delete step.waitNote;
      settle();
      step.state = 'up';
      // Only the last step is the app you open: an API before it prints its own address. What the
      // app printed wins, unless the recipe named the same port (it may say localhost where the app says 127.0.0.1).
      if (last && url && portOf(url) !== portOf(run.url)) run.url = url;
      next();
    };
    // wait: says exactly when the step is ready. Otherwise the app's port opening says it is up
    // (unless something was already listening there), and so does going quiet.
    const wait = spec.wait;
    const port = wait ? ('port' in wait ? wait.port : undefined) : appLike(spec.cmd, last) ? portOf(run.url) : undefined;
    let poll: NodeJS.Timeout | null = null;
    if (port) {
      void listening(port).then((busy) => {
        if (busy) { const why = `(port ${port} was already in use before this started)`; step.tail = [...step.tail, why].slice(-SHOW); this.logLine(live, i, why); if (!wait) return; }
        if (step.state === 'go') poll = setInterval(() => { void listening(port).then((ok) => { if (ok) up(); }); }, 1000);
      });
    }
    // wait:http: asks the address every second until it answers below 500, and fails the run if it
    // never does in time. The step keeps running (its output shows why) until t stops it.
    const addr = wait && 'url' in wait ? wait.url : undefined;
    let ask: NodeJS.Timeout | null = null;
    let timedOut = false;
    if (addr) {
      const deadline = Date.now() + this.httpWaitMs;
      step.waitNote = 'no answer yet';
      const check = () => {
        ask = null;
        void answers(addr).then((status) => {
          if (moved || step.state !== 'go' || live.stopped) return;
          if (status !== undefined && status < 500) { delete step.waitNote; up(); return; }
          const note = status === undefined ? 'no answer yet' : `answered ${status}`;
          if (note !== step.waitNote) { step.waitNote = note; this.soon(); }
          if (Date.now() < deadline) { ask = setTimeout(check, 1000); return; }
          timedOut = true;
          settle();
          const mins = Math.round(this.httpWaitMs / 60_000);
          step.state = 'bad';
          step.waitNote = mins ? `no answer in ${mins} min` : 'no answer in time';
          const why = `(${addr} ${status === undefined ? 'never answered' : `still answered ${status}`})`;
          step.tail = [...step.tail, why].slice(-SHOW);
          this.logLine(live, i, why);
          run.state = 'failed';
          run.text = `${stepLabel(spec)}: ${addr} never answered`;
          this.changed();
        });
      };
      check();
    }
    const quiet = !wait && appLike(spec.cmd, last) ? setTimeout(() => up(), QUIET_UP_MS) : null;
    const settle = () => { if (poll) clearInterval(poll); if (quiet) clearTimeout(quiet); if (ask) clearTimeout(ask); };
    const text = wait && 'text' in wait ? wait.text.toLowerCase() : undefined;
    this.capture(live, i, child, (url) => { if (step.state === 'go' && !wait) { if (!building || built) settle(); up(url); } }, (line) => {
      if (text && step.state === 'go' && line.toLowerCase().includes(text)) { settle(); up(findUrl(line)); }
      if (wait || step.state !== 'go' || built) return;
      const b = buildLine(line);
      if (b === 'start' && appLike(spec.cmd, last)) startBuild();
      else if (b === 'failed' && building) { step.waitNote = 'didn’t compile (a saved fix builds again)'; this.soon(); }
      else if (b === 'done' && building) { built = true; delete step.waitNote; up(builtUrl ?? findUrl(line)); }
    });
    child.on('exit', (code) => {
      if (cap) clearTimeout(cap);
      settle();
      step.code = code;
      if (live.stopped) { step.state = 'off'; this.soon(); return; }
      this.logLine(live, i, `(exited, code ${code})`, true);
      // It already failed by never answering; going away later changes nothing.
      if (timedOut) { this.soon(); return; }
      delete step.waitNote;
      if (step.state === 'up') {
        // The app went away by itself.
        step.state = code === 0 ? 'off' : 'bad';
        if (run.state === 'up' || run.state === 'running') {
          run.state = code === 0 ? 'stopped' : 'failed';
          run.text = code === 0 ? `${stepLabel(spec)} stopped` : `${stepLabel(spec)} exited (code ${code})`;
        }
        this.changed();
        return;
      }
      if (code === 0) { step.state = 'ok'; this.soon(); next(); return; }
      step.state = 'bad';
      run.state = 'failed';
      run.text = `${stepLabel(spec)} failed (exit ${code})`;
      this.changed();
    });
  }

  /**
   * Keep a step's output (colour codes dropped) and watch it for a localhost URL. Each stream keeps
   * the piece of a line a chunk ended in the middle of, so a line split across two chunks is one line.
   */
  private capture(live: Live, i: number, child: ChildProcess, onUrl: (url: string) => void, onLine?: (line: string) => void): void {
    const step = live.run.steps[i];
    const keep = (line: string) => {
      const lines = live.lines[i];
      lines.push(line);
      if (lines.length > KEEP) lines.splice(0, lines.length - KEEP);
      step.tail = lines.slice(-SHOW);
      this.logLine(live, i, line);
      // The line first: a dev server's "[webpack-dev-server] … at http://…" starts a build (§113) before its URL counts.
      onLine?.(line);
      const url = findUrl(line);
      if (url) onUrl(url);
    };
    const reader = () => {
      let rest = '';
      const take = (text: string) => {
        const parts = (rest + text).split(/\r?\n/);
        rest = parts.pop() ?? '';
        for (const raw of parts) {
          const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trimEnd();
          if (line) keep(line);
        }
        this.soon();
      };
      return { data: (buf: Buffer) => take(buf.toString('utf8')), end: () => { if (rest) take('\n'); } };
    };
    const out = reader();
    const err = reader();
    child.stdout?.on('data', out.data);
    child.stdout?.on('end', out.end);
    child.stderr?.on('data', err.data);
    child.stderr?.on('end', err.end);
    child.on('error', (e) => { step.tail = [...step.tail, e.message].slice(-SHOW); this.logLine(live, i, e.message); });
  }

  /** Run the stop: steps one after another (each gets two minutes), after the app is killed. */
  private async teardown(live: Live): Promise<void> {
    for (let i = 0; i < live.specs.length; i++) {
      const spec = live.specs[i];
      if (!spec.stop) continue;
      const step = live.run.steps[i];
      const cwd = this.where(live.places, spec);
      if (typeof cwd !== 'string') { step.state = 'bad'; step.tail = [cwd.error]; continue; }
      step.state = 'go';
      live.run.text = `Stopping: ${stepLabel(spec)}`;
      this.changed();
      this.logLine(live, i, `$ ${spec.cmd}`, true);
      let child: ChildProcess;
      try { child = launch(spec, cwd, this.env, false, live.made); } catch (e) { step.state = 'bad'; step.tail = [(e as Error).message]; this.logLine(live, i, (e as Error).message); continue; }
      this.capture(live, i, child, () => {});
      const code = await new Promise<number | null>((resolve) => {
        const t = setTimeout(() => { killTree(child); resolve(null); }, 120_000);
        child.on('exit', (c) => { clearTimeout(t); resolve(c); });
        child.on('error', () => { clearTimeout(t); resolve(-1); });
      });
      step.code = code;
      step.state = code === 0 ? 'ok' : 'bad';
    }
  }

  /** Stop a run by its key: kill everything it started, then run its stop: steps. `quiet`: drop it (it's being started again, or forgotten). */
  async stop(key: string, quiet = false): Promise<void> {
    const live = this.live.get(key);
    if (!live) return;
    if (live.stopped) { await live.stopping; if (quiet) this.live.delete(key); return; }
    live.stopped = true;
    live.stopping = this.finish(key, live, quiet);
    await live.stopping;
  }

  /** Stop every run of a card: its services in reverse start order (what started last stops first). */
  async stopCard(cardId: string, quiet = false): Promise<void> {
    for (const key of this.keysOf(cardId).reverse()) await this.stop(key, quiet);
  }

  private async finish(key: string, live: Live, quiet: boolean): Promise<void> {
    for (const p of live.procs) killTree(p);
    live.run.steps.forEach((s, i) => {
      if (s.stop || (s.state !== 'go' && s.state !== 'up' && s.state !== 'wait')) return;
      if (s.state !== 'wait') this.logLine(live, i, '(stopped)', true);
      s.state = 'off';
    });
    const was = live.run.state;
    if (was === 'running' || was === 'up') { live.run.state = 'stopped'; live.run.text = 'Stopping'; }
    this.changed();
    // Teardown runs whatever state the run was in: a failed run may have half started something.
    if (live.specs.some((s) => s.stop)) await this.teardown(live);
    this.cleanup(live);
    if (live.run.state === 'stopped') live.run.text = live.run.steps.some((s) => s.stop && s.state === 'bad') ? 'Stopped, but a stop step failed' : 'Stopped';
    if (quiet) this.live.delete(key);
    this.changed();
  }

  /** Forget a card's runs (the card was removed): stop them and drop them. */
  async forget(cardId: string): Promise<void> {
    await this.stopCard(cardId, true);
  }

  /** The server is going away: kill what runs now. Stop steps are skipped (there is no time to wait for them). */
  stopAll(): void {
    for (const live of this.live.values()) { live.stopped = true; for (const p of live.procs) killTree(p); this.cleanup(live); }
    this.live.clear();
  }

  /** Undo what the run changed outside its processes, once: the files written for its steps, then what the caller asked. */
  private cleanup(live: Live): void {
    for (const f of live.made.splice(0)) rmSync(f, { force: true });
    const c = live.cleanup;
    live.cleanup = undefined;
    try { c?.(); } catch (e) { live.run.text = `Stopped, but couldn’t undo a change: ${(e as Error).message}`; }
  }
}
