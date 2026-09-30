// Run recipes on the server: detect one per repo (package.json, compose.yaml, a plain node
// server), keep the ones you wrote, and run a card's recipe as child processes in its folder for
// Try it. A step that keeps running and serves (prints a localhost URL, or its port opens) is the
// app: the run moves on to the next step and the app stays up until you stop it.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { findUrl, portOf, type CardRun, type RunRecipe } from '../shared/recipes.ts';
import { repoName } from '../shared/workspaces.ts';
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

const key = (repo: string) => `recipe:${repo.replace(/[\\/]+$/, '').toLowerCase()}`;

/** The recipe for a repo: the one you wrote, else the detected one. */
export function recipeOf(store: Store, repo: string): RunRecipe | undefined {
  const saved = store.getMeta(key(repo));
  if (saved) {
    try {
      const r = JSON.parse(saved) as Pick<RunRecipe, 'steps' | 'url'>;
      if (Array.isArray(r.steps) && r.steps.length) return { repo, steps: r.steps, ...(r.url ? { url: r.url } : {}), source: 'written by you', edited: true };
    } catch { /* fall back to detection */ }
  }
  return detectRecipe(repo);
}

/** Save the recipe you wrote; no steps goes back to the detected one. */
export function saveRecipe(store: Store, repo: string, steps: string[], url?: string): void {
  const clean = steps.map((s) => s.replace(/[\r\n]+/g, ' ').trim().slice(0, 500)).filter(Boolean).slice(0, 12);
  const u = url?.trim();
  if (u && !/^https?:\/\/[^\s]+$/.test(u)) throw new Error('The address should look like http://localhost:5173');
  store.setMeta(key(repo), clean.length ? JSON.stringify({ steps: clean, ...(u ? { url: u } : {}) }) : '');
}

/** Output lines kept per step, and shown on the page. */
const KEEP = 200;
const SHOW = 12;
/** A step that neither exits, prints a URL nor opens its port for this long is taken to be up. */
const QUIET_UP_MS = 20_000;

/**
 * Could this step be the app? Only those are taken to be up when they go quiet or their port opens;
 * anything else (an install, a migration) has to finish. A printed localhost URL counts for any step.
 */
export function appLike(cmd: string, last: boolean): boolean {
  return last || (/\b(dev|start|serve|preview)\b|\bup\b|^node\s+\S+\.m?js\b/.test(cmd) && !/\bup\s+-d\b|--detach/.test(cmd));
}

/** Is something listening on this port on this machine? */
function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port });
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(500, () => done(false));
  });
}

/** Kill a step and whatever it started (a dev server's children). */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
}

interface Live {
  run: CardRun;
  procs: ChildProcess[];
  /** Full output per step; the run carries only the tail. */
  lines: string[][];
  stopped: boolean;
}

/** Runs cards' recipes. One run per card; starting again stops the last one first. */
export class RunService {
  private live = new Map<string, Live>();
  private timer: NodeJS.Timeout | null = null;
  private changed: () => void;
  private env: NodeJS.ProcessEnv;

  constructor(changed: () => void, env: NodeJS.ProcessEnv) {
    this.changed = changed;
    // Plain output, and no dev server opening a browser of its own: o opens it.
    this.env = { ...env, FORCE_COLOR: '0', NO_COLOR: '1', BROWSER: 'none', PYTHONUNBUFFERED: '1' };
  }

  list(): CardRun[] {
    return [...this.live.values()].map((l) => l.run);
  }

  get(cardId: string): CardRun | undefined {
    return this.live.get(cardId)?.run;
  }

  /** Tell the page, at most every 250 ms while output streams. */
  private soon(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.changed(); }, 250);
  }

  start(cardId: string, recipe: RunRecipe, cwd: string): CardRun {
    this.stop(cardId, true);
    const run: CardRun = {
      cardId, repo: recipe.repo, cwd, state: 'running', startedAt: Date.now(), ...(recipe.url ? { url: recipe.url } : {}),
      steps: recipe.steps.map((cmd) => ({ cmd, state: 'wait', tail: [] })), text: `Starting ${repoName(recipe.repo)}`,
    };
    const live: Live = { run, procs: [], lines: recipe.steps.map(() => []), stopped: false };
    this.live.set(cardId, live);
    this.step(live, 0);
    this.changed();
    return run;
  }

  private step(live: Live, i: number): void {
    const { run } = live;
    if (live.stopped) return;
    if (i >= run.steps.length) {
      const up = run.steps.some((s) => s.state === 'up');
      run.state = up ? 'up' : 'done';
      run.text = up ? (run.url ? `Running at ${run.url}` : 'Running') : 'Every step finished';
      this.changed();
      return;
    }
    const step = run.steps[i];
    step.state = 'go';
    run.text = step.cmd;
    const child = spawn(step.cmd, { cwd: run.cwd, env: this.env, shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    live.procs.push(child);
    let moved = false;
    const next = () => { if (!moved) { moved = true; this.step(live, i + 1); } };
    const up = (url?: string) => {
      if (moved || step.state !== 'go') return;
      step.state = 'up';
      // What the app printed wins, unless the recipe named the same port (it may say localhost where the app says 127.0.0.1).
      if (url && portOf(url) !== portOf(run.url)) run.url = url;
      next();
    };
    // The app's port opening says it is up, unless something was already listening there.
    const port = appLike(step.cmd, i === run.steps.length - 1) ? portOf(run.url) : undefined;
    let poll: NodeJS.Timeout | null = null;
    if (port) {
      void listening(port).then((busy) => {
        if (busy) { step.tail = [...step.tail, `(port ${port} was already in use before this started)`].slice(-SHOW); return; }
        if (step.state === 'go') poll = setInterval(() => { void listening(port).then((ok) => { if (ok) up(); }); }, 1000);
      });
    }
    const quiet = appLike(step.cmd, i === run.steps.length - 1) ? setTimeout(() => up(), QUIET_UP_MS) : null;
    const settle = () => { if (poll) clearInterval(poll); if (quiet) clearTimeout(quiet); };
    const onData = (buf: Buffer) => {
      for (const raw of buf.toString('utf8').split(/\r?\n/)) {
        // eslint-disable-next-line no-control-regex
        const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trimEnd();
        if (!line) continue;
        const lines = live.lines[i];
        lines.push(line);
        if (lines.length > KEEP) lines.splice(0, lines.length - KEEP);
        step.tail = lines.slice(-SHOW);
        const url = findUrl(line);
        if (url && step.state === 'go') { settle(); up(url); }
      }
      this.soon();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (e) => { step.tail = [...step.tail, e.message].slice(-SHOW); });
    child.on('exit', (code) => {
      settle();
      step.code = code;
      if (live.stopped) { step.state = 'off'; this.soon(); return; }
      if (step.state === 'up') {
        // The app went away by itself.
        step.state = code === 0 ? 'off' : 'bad';
        if (run.state === 'up' || run.state === 'running') {
          run.state = code === 0 ? 'stopped' : 'failed';
          run.text = code === 0 ? `${step.cmd} stopped` : `${step.cmd} exited (code ${code})`;
        }
        this.changed();
        return;
      }
      if (code === 0) { step.state = 'ok'; this.soon(); next(); return; }
      step.state = 'bad';
      run.state = 'failed';
      run.text = `${step.cmd} failed (exit ${code})`;
      this.changed();
    });
  }

  /** Stop a card's run and everything it started. */
  stop(cardId: string, quiet = false): void {
    const live = this.live.get(cardId);
    if (!live) return;
    live.stopped = true;
    for (const p of live.procs) killTree(p);
    for (const s of live.run.steps) if (s.state === 'go' || s.state === 'up' || s.state === 'wait') s.state = 'off';
    if (live.run.state === 'running' || live.run.state === 'up') { live.run.state = 'stopped'; live.run.text = 'Stopped'; }
    if (quiet) this.live.delete(cardId);
    else this.changed();
  }

  /** Forget a card's run (the card was removed): stop it and drop it. */
  forget(cardId: string): void {
    this.stop(cardId, true);
    this.changed();
  }

  stopAll(): void {
    for (const id of [...this.live.keys()]) this.stop(id, true);
  }
}
