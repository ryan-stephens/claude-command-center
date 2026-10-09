// Verify's test-data tool, started from the panel (PLAN §135). The tool is an API (and a web UI)
// that runs on this machine; when it isn't running, Start (Shift+S) runs the commands this machine's
// Verify file gives as `builder.launch`, in `builder.cwd`, and waits for its API to answer. The page
// only asks: it never sends a command, so nothing runs that the file doesn't say.
//
// What it started is stopped by Stop (Shift+K) and when the server goes away; a tool that was
// already running (started by hand) is never touched. Its output is kept in memory, the last lines
// only, and shown only when it didn't come up: the tool may print loan ids, which stay out of logs.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { LAUNCH_WAIT_MS, type BuilderProc, type VerifyConfig } from '../shared/verify.ts';
import { withoutSecrets } from './config.ts';
import { killTree } from './recipes.ts';

/** Lines of output kept, across its commands. */
export const TAIL_LINES = 30;
/** How often it asks whether the API answers yet. */
export const PROBE_MS = 1500;

export interface LaunchDeps {
  cfg: () => VerifyConfig;
  /** Does the tool's API answer (BuilderTool.answers)? */
  answers: () => Promise<boolean>;
  /** Every page hears of a change. */
  changed: (proc: BuilderProc) => void;
  spawnCmd?: (cmd: string, cwd: string) => ChildProcess;
  kill?: (child: ChildProcess) => void;
  now?: () => number;
  probeMs?: number;
  waitMs?: number;
}

/** A Claude Code session's markers aren't handed on (a `claude` the tool ran would act as its child); nor are secrets. */
const MARKERS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_\w+)$/;
export function launchEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(withoutSecrets(base)).filter(([k]) => !MARKERS.test(k)));
}

const shellSpawn = (cmd: string, cwd: string): ChildProcess =>
  spawn(cmd, { cwd, env: launchEnv(process.env), shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

export class BuilderLauncher {
  private d: Required<Omit<LaunchDeps, 'cfg' | 'answers' | 'changed'>> & Pick<LaunchDeps, 'cfg' | 'answers' | 'changed'>;
  private procs: ChildProcess[] = [];
  private tail: string[] = [];
  private proc: BuilderProc = { state: 'off' };
  /** Bumped by every start and stop, so a late probe or exit of an earlier start is ignored. */
  private gen = 0;

  constructor(deps: LaunchDeps) {
    this.d = { spawnCmd: shellSpawn, kill: killTree, now: Date.now, probeMs: PROBE_MS, waitMs: LAUNCH_WAIT_MS, ...deps };
  }

  private name(): string { return this.d.cfg().builder?.name ?? 'The test-data tool'; }

  /** What the page shows: the tail only when it didn't come up. */
  state(): BuilderProc {
    const p = this.proc;
    return p.state === 'exited' || p.state === 'slow' ? { ...p, tail: [...this.tail] } : { ...p };
  }

  private set(p: BuilderProc): void {
    this.proc = p;
    this.d.changed(this.state());
  }

  private running(): boolean { return this.procs.some((c) => c.exitCode === null && c.signalCode === null); }

  /** Shift+S: run the file's commands, then wait for the API. Refused (with why) when it can't or needn't. */
  async start(): Promise<BuilderProc> {
    const b = this.d.cfg().builder;
    if (!b?.url) throw new Error(`${this.name()} has no "url" in this machine’s Verify file.`);
    if (!b.launch?.length) throw new Error(`${this.name()} has no "launch" in this machine’s Verify file: add the command that starts it.`);
    if (this.proc.state === 'starting' || (this.proc.state === 'up' && this.running())) return this.state();
    const cwd = b.cwd ?? homedir();
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`${this.name()}: its folder (“cwd”) isn’t there: ${cwd}`);
    if (await this.d.answers()) throw new Error(`${this.name()} is already running: r reads its scenarios.`);
    this.stopProcs();
    const gen = ++this.gen;
    this.tail = [];
    const startedAt = this.d.now();
    for (const cmd of b.launch) {
      const child = this.d.spawnCmd(cmd, cwd);
      this.procs.push(child);
      const take = (chunk: Buffer | string) => this.take(String(chunk));
      child.stdout?.on('data', take);
      child.stderr?.on('data', take);
      child.on('error', (e) => { this.take(`${cmd}: ${e.message}`); this.ended(gen, null); });
      child.on('exit', (code) => this.ended(gen, code));
    }
    this.set({ state: 'starting', startedAt });
    void this.probe(gen, startedAt);
    return this.state();
  }

  private take(text: string): void {
    for (const line of text.replace(ANSI, '').split(/\r?\n/)) if (line.trim()) this.tail.push(line.slice(0, 400));
    if (this.tail.length > TAIL_LINES) this.tail.splice(0, this.tail.length - TAIL_LINES);
  }

  /** A command ended: before it answered, it failed to start; after, it stopped. Either way the rest go too. */
  private ended(gen: number, code: number | null): void {
    if (gen !== this.gen || this.proc.state === 'exited' || this.proc.state === 'off') return;
    // A command that ends cleanly while starting may have handed off (a script that starts the tool in
    // the background): keep waiting for the API.
    if (code === 0 && this.proc.state === 'starting') return;
    this.gen++;
    this.stopProcs();
    this.set({ state: 'exited', startedAt: this.proc.startedAt, exitCode: code });
  }

  private async probe(gen: number, startedAt: number): Promise<void> {
    while (gen === this.gen) {
      await new Promise((r) => setTimeout(r, this.d.probeMs));
      if (gen !== this.gen) return;
      if (await this.d.answers()) {
        if (gen === this.gen && this.proc.state !== 'up') this.set({ state: 'up', startedAt });
        return;
      }
      if (gen !== this.gen) return;
      // Still not answering: say so once and stop asking; it is left running (Shift+K stops it).
      if (this.d.now() - startedAt >= this.d.waitMs) { this.set({ state: 'slow', startedAt }); return; }
    }
  }

  private stopProcs(): void {
    for (const c of this.procs) this.d.kill(c);
    this.procs = [];
  }

  /** Shift+K: stop what Start started. Nothing started here: says so, and leaves the tool alone. */
  stop(): BuilderProc {
    if (!this.procs.length) throw new Error(`${this.name()} wasn’t started here, so it isn’t stopped from here.`);
    this.gen++;
    this.stopProcs();
    this.set({ state: 'off' });
    return this.state();
  }

  /** The server is going away. */
  stopAll(): void {
    this.gen++;
    this.stopProcs();
  }
}
