// Verify's test-data section (PLAN §133): the scenario runner on this machine, an ASP.NET API that
// creates test loans in Dev or UAT by running a saved scenario. Driven from here through exactly
// three requests, each through `guard` (server/verify.ts):
//   GET  <base>/api/scenarios                                   the scenarios (latest versions)
//   POST <base>/api/scenarios/<id>/versions/<n>/runs  { environment: 'dev' | 'uat' }   a run, in the background
//   GET  <base>/api/runs/<runId>                                how it is going
// Its other endpoints (create, versions, copy, lock, delete, resume, tokens) are never called.
// Loopback only, plain fetch (no Windows sign-in), ten seconds, nothing kept or logged: loan ids and
// step messages go to the page that asked.

import {
  BUILDER_ENVS, cleanUrl, type BuilderEnv, type BuilderRun, type BuilderScenario, type BuilderStepStatus, type VerifyConfig,
} from '../shared/verify.ts';
import { guard, type VerifyRequest } from './verify.ts';

/** How a builder request goes out: its status and its JSON (undefined when the body isn't JSON). */
export type BuilderTransport = (req: VerifyRequest, signal: AbortSignal) => Promise<{ status: number; json: unknown }>;

export const BUILDER_TIMEOUT_MS = 10_000;

/** The tool didn't answer at all: nothing listens at its address, or it hung. */
export class NotAnswering extends Error {}

/** Node's fetch: JSON in and out, no redirects followed, no credentials. */
export const builderFetch: BuilderTransport = async (req, signal) => {
  const res = await fetch(req.url, {
    method: req.method,
    redirect: 'manual',
    credentials: 'omit',
    signal,
    headers: { Accept: 'application/json', ...(req.json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(req.json !== undefined ? { body: JSON.stringify(req.json) } : {}),
  });
  const text = await res.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: res.status, json };
};

// ---- Reading the tool's JSON, tolerantly ----

type Obj = Record<string, unknown>;
/** A key in camelCase or PascalCase. */
const at = (o: unknown, key: string): unknown => {
  if (!o || typeof o !== 'object') return undefined;
  const r = o as Obj;
  return r[key] ?? r[key[0].toUpperCase() + key.slice(1)];
};
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const short = (s: string, n = 300): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** GET api/scenarios: the list, odd entries skipped. */
export function readScenarios(json: unknown): BuilderScenario[] {
  return list(json).flatMap((s) => {
    const id = text(at(s, 'scenarioId'));
    const version = Number(at(s, 'versionNumber'));
    if (!id || !Number.isInteger(version)) return [];
    return [{ id, version, name: text(at(s, 'name')) || id, tags: list(at(s, 'tags')).map(text).filter(Boolean), locked: at(s, 'isLocked') === true }];
  });
}

const STEP: Record<string, BuilderStepStatus> = { pending: 'pending', running: 'running', succeeded: 'succeeded', failed: 'failed', skipped: 'skipped' };

/** An error as the tool sends it (a string, or { message, … }): its message only, never a stack trace. */
function message(v: unknown): string | undefined {
  const m = typeof v === 'string' ? v : text(at(v, 'message'));
  return m ? short(m) : undefined;
}

/** GET api/runs/{id}: the run, statuses in any case, missing arrays empty. */
export function readRun(json: unknown, runId: string): BuilderRun {
  const status = text(at(json, 'status')).toLowerCase();
  const env = text(at(json, 'environment')).toLowerCase();
  const steps = list(at(json, 'stepRuns')).map((s, i) => {
    const err = message(at(s, 'error'));
    return { order: Number(at(s, 'order')) || i + 1, type: text(at(s, 'typeId')) || 'step', status: STEP[text(at(s, 'status')).toLowerCase()] ?? 'pending', ...(err ? { error: err } : {}) };
  }).sort((a, b) => a.order - b.order);
  const err = message(at(json, 'runError'));
  return {
    runId: text(at(json, 'runId')) || runId,
    env: (BUILDER_ENVS as string[]).includes(env) ? env as BuilderEnv : 'dev',
    status: status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : 'running',
    steps,
    recordIds: list(at(at(json, 'finalArtifacts'), 'loanGuids')).map(text).filter(Boolean),
    ...(err ? { error: err } : {}),
  };
}

// ---- The client ----

export class BuilderTool {
  private cfg: () => VerifyConfig;
  private transport: BuilderTransport;

  constructor(cfg: () => VerifyConfig, transport: BuilderTransport = builderFetch) {
    this.cfg = cfg;
    this.transport = transport;
  }

  private name(): string { return this.cfg().builder?.name ?? 'The test-data tool'; }

  private base(): string {
    const b = cleanUrl(this.cfg().builder?.url);
    if (!b) throw new Error(`${this.name()} has no "url" in this machine’s Verify file.`);
    return b;
  }

  /** One guarded request; a refused connection says the tool isn't running (and how to start it, when the file says). */
  private async send(req: VerifyRequest): Promise<unknown> {
    guard(req, this.cfg());
    let res: { status: number; json: unknown };
    try {
      res = await this.transport(req, AbortSignal.timeout(BUILDER_TIMEOUT_MS));
    } catch (e) {
      const err = e as { name?: string; cause?: { code?: string } };
      if (err.cause?.code === 'ECONNREFUSED') {
        const b = this.cfg().builder;
        // §135: with launch commands, the page offers Start (Shift+S); without, the file's hint.
        throw new NotAnswering(`${this.name()} isn’t running here.${b?.launch ? ' Start it with Shift+S.' : b?.start ? ` To start it: ${b.start}` : ''}`);
      }
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new NotAnswering(`${this.name()}: no answer in ${BUILDER_TIMEOUT_MS / 1000} s.`);
      throw new Error(`${this.name()}: ${(e as Error).message}`);
    }
    if (res.status >= 300) {
      const said = message(at(res.json, 'title')) ?? message(res.json);
      throw new Error(`${this.name()} answered ${res.status}${said ? `: ${said}` : ''}.`);
    }
    return res.json;
  }

  /** §135: does it answer at all (any answer, even an error page, means something is listening)? */
  async answers(): Promise<boolean> {
    try { await this.scenarios(); return true; } catch (e) { return !(e instanceof NotAnswering); }
  }

  async scenarios(): Promise<BuilderScenario[]> {
    return readScenarios(await this.send({ tool: 'builder', method: 'GET', url: `${this.base()}/api/scenarios` }));
  }

  /** Start a run (it goes on in the background); its id. Dev or UAT only. */
  async start(env: BuilderEnv, scenarioId: string, version: number): Promise<string> {
    if (!BUILDER_ENVS.includes(env)) throw new Error(`${this.name()} runs in Dev or UAT only.`);
    if (!/^[\w-]{1,64}$/.test(scenarioId) || !Number.isInteger(version) || version < 0) throw new Error('That isn’t a scenario.');
    const json = await this.send({ tool: 'builder', method: 'POST', url: `${this.base()}/api/scenarios/${scenarioId}/versions/${version}/runs`, json: { environment: env } });
    const runId = text(at(json, 'runId'));
    if (!/^[\w-]{1,64}$/.test(runId)) throw new Error(`${this.name()} didn’t say which run it started.`);
    return runId;
  }

  async run(runId: string): Promise<BuilderRun> {
    if (!/^[\w-]{1,64}$/.test(runId)) throw new Error('That isn’t a run.');
    return readRun(await this.send({ tool: 'builder', method: 'GET', url: `${this.base()}/api/runs/${runId}` }), runId);
  }
}
