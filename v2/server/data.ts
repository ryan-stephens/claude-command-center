// The data desk (§140): the team's data tools for a session, for Claude (the toolbelt) and for you (the
// Data panel) alike, each use kept on the session as a DataEvent so the page shows what was done and
// what came of it as it happens:
//   the test-data tool  started from its installed folder (v1's BuilderLauncher, verify.json's
//                       builder.launch and builder.cwd), its scenarios listed, loans made from them
//   the record lookup   a loan's fields read (with read-only marks and options when asked), and
//                       changed where this machine allows it, then read again until the change shows
// Dev and UAT only; every request through v1's guard.

import { randomUUID } from 'node:crypto';
import type { BuilderTool } from '../../server/verify-builder.ts';
import { BuilderLauncher } from '../../server/verify-launch.ts';
import { updatesOn, type VerifyConfig } from '../../shared/verify.ts';
import { dataEnv, loanId } from '../shared/data-tools.ts';
import type { DataEvent, FieldCheckResult, LoanMade, Session, Snapshot } from '../shared/types.ts';
import type { SessionStore } from './sessions.ts';
import { idsFor, lookupFields, makeLoan, updateFields, type Lookup } from './tools.ts';

export const KEEP_EVENTS = 40;
/** A tool call answers within this: Node's fetch in the toolbelt stops waiting for headers at 300 s. */
export const MAX_WAIT_MS = 270_000;

export interface DeskDeps {
  sessions: SessionStore;
  builder: BuilderTool;
  lookup: Lookup;
  cfg: () => VerifyConfig;
  changed: () => void;
}

const word = (env: string) => (env === 'dev' ? 'Dev' : 'UAT');
const waitOf = (v: unknown, dflt: number) => Math.min(Math.max(Number(v ?? dflt / 1000) * 1000 || 0, 0), MAX_WAIT_MS);

export class DataDesk {
  private d: DeskDeps;
  readonly launcher: BuilderLauncher;
  private running = new Map<string, Promise<void>>();

  constructor(d: DeskDeps) {
    this.d = d;
    this.launcher = new BuilderLauncher({ cfg: d.cfg, answers: () => d.builder.answers(), changed: () => d.changed() });
    // A server that stopped while a loan was being made left it running on paper: say so.
    for (const s of d.sessions.list()) {
      if ((s.data ?? []).some((e) => e.state === 'running')) {
        d.sessions.update(s.id, (x) => ({ ...x, data: (x.data ?? []).map((e) => (e.state === 'running' ? { ...e, state: 'failed', error: 'Command Center stopped while this ran.', endedAt: Date.now() } : e)) }));
      }
    }
  }

  private name(): string { return this.d.cfg().builder?.name ?? 'The test-data tool'; }

  /** What the page shows of the test-data tool. */
  toolView(): Snapshot['config']['testData'] {
    const p = this.launcher.state();
    return { name: this.name(), launch: Boolean(this.d.cfg().builder?.launch?.length), state: p.state, ...(p.tail ? { tail: p.tail } : {}), ...(p.exitCode !== undefined ? { exitCode: p.exitCode } : {}) };
  }

  /** v1's "not running" says to press Shift+S; here it is a button or a tool. */
  private plain(e: unknown): Error {
    const m = (e as Error).message.replace(' Start it with Shift+S.', ' Start it from the Data panel, or with test_data_tool (start).');
    return new Error(m);
  }

  /** Is the tool answering, and what was started here. */
  async toolStatus() {
    return { answering: await this.d.builder.answers(), ...this.toolView() };
  }

  /** Start the tool from its folder and wait (up to `waitMs`) until it answers. Already answering: says so. */
  async startTool(waitMs = 120_000) {
    if (await this.d.builder.answers()) return { answering: true, ...this.toolView(), note: `${this.name()} is running.` };
    await this.launcher.start();
    const until = Date.now() + waitMs;
    while (Date.now() < until && this.launcher.state().state === 'starting') await new Promise((r) => setTimeout(r, 1000));
    const v = this.toolView();
    return { answering: v.state === 'up', ...v, ...(v.state === 'starting' ? { note: 'Still starting (a first build is slow): ask again with status.' } : {}) };
  }

  stopTool() {
    this.launcher.stop();
    return this.toolView();
  }

  async scenarios() {
    try { return (await this.d.builder.scenarios()).map((x) => ({ id: x.id, name: x.name, version: x.version, tags: x.tags })); } catch (e) { throw this.plain(e); }
  }

  // ---- Events ----

  private put(sessionId: string, ev: DataEvent, made: { loans?: LoanMade[]; check?: FieldCheckResult; note?: string } = {}): void {
    this.d.sessions.update(sessionId, (x) => ({
      ...x,
      data: [...(x.data ?? []).filter((y) => y.id !== ev.id), ev].slice(-KEEP_EVENTS),
      ...(made.loans?.length ? { loans: [...x.loans, ...made.loans] } : {}),
      ...(made.check ? { fields: [...x.fields, made.check] } : {}),
      ...(made.note ? { evidence: [...x.evidence, { kind: 'note' as const, text: made.note, at: Date.now(), ok: true }] } : {}),
    }));
  }

  private event(s: Session, kind: DataEvent['kind'], env: DataEvent['env'], by: DataEvent['by'], title: string, more: Partial<DataEvent> = {}): DataEvent {
    const ev: DataEvent = { id: randomUUID().slice(0, 8), at: Date.now(), by, kind, env, state: 'running', title, ...more };
    this.put(s.id, ev);
    return ev;
  }

  private failed(s: Session, ev: DataEvent, e: unknown): DataEvent {
    const out: DataEvent = { ...ev, state: 'failed', title: `${ev.title.replace(/…$/, '').replace(/: (starting|started|running)$/, '')}: didn’t work`, error: this.plain(e).message, endedAt: Date.now() };
    this.put(s.id, out);
    return out;
  }

  get(sessionId: string, id: string): DataEvent | undefined {
    return this.d.sessions.get(sessionId)?.data?.find((e) => e.id === id);
  }

  /** Wait (up to `ms`) for an event still running; then the event as it is. */
  async wait(sessionId: string, id: string, ms: number): Promise<DataEvent | undefined> {
    const run = this.running.get(id);
    if (run) await Promise.race([run, new Promise((r) => setTimeout(r, ms))]);
    return this.get(sessionId, id);
  }

  // ---- The tools ----

  /** Read a loan's fields: ids and/or a saved list; `details` for read-only marks and options; `expect` to compare. */
  async lookup(s: Session, a: Record<string, unknown>, by: DataEvent['by']): Promise<DataEvent> {
    const env = dataEnv(a.env);
    const loan = loanId(a.loan);
    const { ids, list } = idsFor(a.list ? String(a.list) : undefined, Array.isArray(a.fields) ? a.fields.map(String) : undefined);
    const expect = a.expect && typeof a.expect === 'object' && !Array.isArray(a.expect) ? Object.fromEntries(Object.entries(a.expect as Record<string, unknown>).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])) : undefined;
    const details = a.details === true;
    const ev = this.event(s, 'lookup', env, by, `Looking up ${ids.length} field(s) on ${loan} in ${word(env)}…`, { loan, ...(list ? { list } : {}), ...(details ? { details } : {}) });
    try {
      const r = await lookupFields(this.d.lookup, env, loan, ids, { details, updates: updatesOn(this.d.cfg()), ...(expect ? { expect } : {}), ...(list ? { list } : {}) });
      const missing = r.rows.filter((x) => x.value === null).length;
      const wrong = r.rows.filter((x) => x.ok === false).length;
      const title = `${ids.length} field(s) on ${loan} in ${word(env)}${list ? ` (${list})` : ''}${expect ? `: ${ids.length - wrong - missing} as expected${wrong ? `, ${wrong} differ` : ''}` : ''}${missing ? `, ${missing} not on the loan` : ''}`;
      const out: DataEvent = { ...ev, state: 'done', title, rows: r.rows, endedAt: Date.now() };
      this.put(s.id, out, r.check ? { check: r.check } : {});
      return out;
    } catch (e) { return this.failed(s, ev, e); }
  }

  /** Change fields ('' clears), then wait (up to `wait_seconds`, 3 minutes at most) until they show. */
  async update(s: Session, a: Record<string, unknown>, by: DataEvent['by']): Promise<DataEvent> {
    const env = dataEnv(a.env);
    const loan = loanId(a.loan);
    if (!a.set || typeof a.set !== 'object' || Array.isArray(a.set)) throw new Error('Give `set`: field id → the value to put in it ("" clears it).');
    const set = Object.fromEntries(Object.entries(a.set as Record<string, unknown>).map(([k, v]) => [k.trim(), v === null || v === undefined ? '' : String(v)]).filter(([k]) => k));
    const ev = this.event(s, 'update', env, by, `Changing ${Object.keys(set).length} field(s) on ${loan} in ${word(env)}…`, { loan });
    try {
      const r = await updateFields(this.d.lookup, env, loan, set, {
        updates: updatesOn(this.d.cfg()),
        waitMs: Math.min(waitOf(a.wait_seconds, 180_000), 180_000),
        progress: (rows) => this.put(s.id, { ...ev, rows, title: `Sent; ${rows.filter((x) => x.applied === 'applied').length} of ${rows.length} applied…` }),
      });
      const applied = r.rows.filter((x) => x.applied === 'applied').length;
      const title = r.sent === 0
        ? `${loan} in ${word(env)}: every field had its value already`
        : `${r.sent} field(s) changed on ${loan} in ${word(env)}: ${r.pending.length ? `${applied} applied, ${r.pending.length} not yet (${r.pending.slice(0, 3).join(', ')})` : 'all applied'}`;
      const out: DataEvent = { ...ev, state: 'done', title, rows: r.rows, ...(r.watchUrl ? { watchUrl: r.watchUrl } : {}), endedAt: Date.now() };
      this.put(s.id, out, r.sent && !r.pending.length ? { note: `Changed ${r.rows.map((x) => x.id).join(', ')} on ${loan} in ${word(env)} through the record lookup; applied` } : {});
      return out;
    } catch (e) { return this.failed(s, ev, e); }
  }

  /** Start making a loan from a scenario; it runs on here, its steps shown as they go. */
  startLoan(s: Session, a: Record<string, unknown>, by: DataEvent['by']): DataEvent {
    const env = dataEnv(a.env);
    const scenario = String(a.scenario ?? '').trim();
    if (!scenario) throw new Error('Name a scenario (list_loan_scenarios lists them).');
    const ev = this.event(s, 'loan', env, by, `A loan from ${scenario} in ${word(env)}: starting…`, { scenario });
    let now = ev;
    const run = makeLoan(this.d.builder, env, scenario, undefined, undefined, (r, sc, runId) => {
      now = { ...now, scenario: sc.name, runId, title: `A loan from ${sc.name} in ${word(env)}: ${r ? r.status : 'started'}…`, ...(r ? { steps: r.steps } : {}) };
      this.put(s.id, now);
    }).then((r) => {
      const loans = r.loans.map((l) => l.loan);
      this.put(s.id, { ...now, state: 'done', loans, ...(loans[0] ? { loan: loans[0] } : {}), title: r.text, endedAt: Date.now() }, { loans: r.loans });
    }, (e) => { this.failed(s, now, e); })
      .finally(() => setTimeout(() => this.running.delete(ev.id), 60_000));
    this.running.set(ev.id, run);
    return ev;
  }

  stopAll(): void {
    this.launcher.stopAll();
  }
}

/** An event as Claude reads it. */
export function forClaude(ev: DataEvent | undefined): unknown {
  if (!ev) return 'No such data event in this session.';
  return {
    id: ev.id, kind: ev.kind, state: ev.state, env: ev.env, summary: ev.title,
    ...(ev.error ? { error: ev.error } : {}),
    ...(ev.loan ? { loan: ev.loan } : {}),
    ...(ev.loans?.length ? { loans: ev.loans } : {}),
    ...(ev.rows ? { fields: ev.rows } : {}),
    ...(ev.steps?.length ? { steps: ev.steps } : {}),
    ...(ev.watchUrl ? { updateProgress: ev.watchUrl } : {}),
    ...(ev.state === 'running' ? { note: `Still running: call data_status with id ${ev.id} to wait for it.` } : {}),
  };
}

export { waitOf };
