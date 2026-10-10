// The team's data tools as a session uses them (§137, §140): the test-data tool makes loans from its
// scenarios; the record lookup reads a loan's fields and, where this machine allows it (§134), changes
// them. Claude gets them on purpose: test loans and their fields in Dev and UAT are what proving a
// change takes. Every request still goes through v1's guard (server/verify.ts): the scenario runner's
// three calls, the lookup's read, and its update form only with `allowUpdate`; never Prod.
// Addresses and names come from the machine's ~/.cc-control/verify.json, never the repo.

import type { BuilderEnv, BuilderRun, BuilderScenario, FieldChange, LookupField, LookupResult, UpdateSent } from '../../shared/verify.ts';
import { readFieldLists } from '../../server/verify.ts';
import type { BuilderTool } from '../../server/verify-builder.ts';
import { dataEnv, sameValue } from '../shared/data-tools.ts';
import type { FieldCheckResult, FieldRow, LoanMade } from '../shared/types.ts';

export const LOAN_POLL_MS = 2_000;
export const LOAN_WAIT_MS = 15 * 60_000;
export const APPLY_EVERY_MS = 10_000;
export const APPLY_FOR_MS = 3 * 60_000;

export const envOf = (v: unknown): BuilderEnv => dataEnv(v);

/** The scenario a name means: an exact id, an exact name, else the only one whose name or tags contain it. */
export function findScenario(list: BuilderScenario[], want: string): BuilderScenario {
  const w = want.trim().toLowerCase();
  if (!w) throw new Error('Name a scenario (list_loan_scenarios lists them).');
  const exact = list.find((s) => s.id.toLowerCase() === w || s.name.toLowerCase() === w);
  if (exact) return exact;
  const near = list.filter((s) => s.name.toLowerCase().includes(w) || s.tags.some((t) => t.toLowerCase() === w));
  if (near.length === 1) return near[0];
  if (!near.length) throw new Error(`No scenario called "${want}". There are: ${list.map((s) => s.name).slice(0, 20).join('; ')}.`);
  throw new Error(`"${want}" could be ${near.map((s) => s.name).slice(0, 8).join('; ')}. Name one exactly.`);
}

/**
 * Make a test loan: start the scenario, follow its run (each poll told to `onRun`), and say the loans
 * it made, or why it failed.
 */
export async function makeLoan(builder: Pick<BuilderTool, 'scenarios' | 'start' | 'run'>, env: BuilderEnv, scenario: string, wait = LOAN_WAIT_MS, poll = LOAN_POLL_MS, onRun?: (run: BuilderRun | undefined, s: BuilderScenario, runId: string) => void): Promise<{ loans: LoanMade[]; text: string }> {
  const s = findScenario(await builder.scenarios(), scenario);
  const runId = await builder.start(env, s.id, s.version);
  onRun?.(undefined, s, runId);
  const until = Date.now() + wait;
  for (;;) {
    await new Promise((r) => setTimeout(r, poll));
    const run = await builder.run(runId);
    onRun?.(run, s, runId);
    if (run.status === 'succeeded') {
      const at = Date.now();
      const loans = run.recordIds.map((loan) => ({ loan, env, scenario: s.name, at }));
      return { loans, text: loans.length ? `${s.name} made ${loans.map((l) => l.loan).join(', ')} in ${env === 'dev' ? 'Dev' : 'UAT'}.` : `${s.name} succeeded but named no loan.` };
    }
    if (run.status === 'failed') {
      const step = run.steps.find((x) => x.status === 'failed');
      throw new Error(`${s.name} failed${step ? ` at step ${step.order} (${step.type})${step.error ? `: ${step.error}` : ''}` : ''}${run.error ? `. ${run.error}` : ''}.`);
    }
    if (Date.now() > until) throw new Error(`${s.name} is still running after ${Math.round(wait / 60_000)} minutes (run ${runId}). Check the tool's own page.`);
  }
}

/** The ids to read: a saved list by name, the ids given, or both (each once). */
export function idsFor(list: string | undefined, fields: string[] | undefined): { ids: string[]; list?: string } {
  const ids: string[] = [];
  let name: string | undefined;
  if (list) {
    const found = readFieldLists().lists.find((l) => l.name.toLowerCase() === list.trim().toLowerCase());
    if (!found) throw new Error(`No saved field list called "${list}". Saved: ${readFieldLists().lists.map((l) => l.name).join(', ') || 'none'}.`);
    ids.push(...found.ids);
    name = found.name;
  }
  for (const f of fields ?? []) { const id = String(f).trim(); if (id && !ids.some((x) => x.toLowerCase() === id.toLowerCase())) ids.push(id); }
  if (!ids.length) throw new Error('Name the fields to read, or a saved field list.');
  return { ids, ...(name ? { list: name } : {}) };
}

/** Compare what was read with what was expected (numbers alike with or without thousands commas or trailing zeros, anything else in any case). */
export function compareFields(read: LookupField[], ids: string[], expect: Record<string, string> = {}): Pick<FieldCheckResult, 'total' | 'matched' | 'differs'> {
  const differs: FieldCheckResult['differs'] = [];
  for (const id of ids) {
    const f = read.find((x) => x.id.toLowerCase() === id.toLowerCase());
    const want = Object.entries(expect).find(([k]) => k.toLowerCase() === id.toLowerCase())?.[1];
    if (!f || !f.exists) differs.push({ id, ...(want !== undefined ? { expected: want } : {}) });
    else if (want !== undefined && !sameValue(f.value, want)) differs.push({ id, expected: want, actual: f.value });
  }
  return { total: ids.length, matched: ids.length - differs.length, differs };
}

/** The lookup as the data tools use it. */
export interface Lookup {
  fetch: (env: BuilderEnv, loan: string, ids: string[], advanced: boolean, opts: { session?: boolean }) => Promise<LookupResult>;
  update: (token: string, changes: FieldChange[]) => Promise<UpdateSent>;
}

/**
 * Read a loan's fields. `details` asks for read-only marks and options (the lookup's Advanced), and,
 * when this machine allows updates, which fields can be changed. With `expect`, each row says
 * whether it is what it should be, and a check result comes back for the evidence.
 */
export async function lookupFields(lookup: Lookup, env: BuilderEnv, loan: string, ids: string[], o: { details?: boolean; updates?: boolean; expect?: Record<string, string>; list?: string } = {}): Promise<{ rows: FieldRow[]; check?: FieldCheckResult }> {
  const r = await lookup.fetch(env, loan, ids, Boolean(o.details), o.details && o.updates ? {} : { session: false });
  if (!r.found) throw new Error(`${loan} wasn’t found in ${env === 'dev' ? 'Dev' : 'UAT'}.`);
  const editable = new Set(r.updatable ? r.editable ?? [] : []);
  const expect = o.expect ?? {};
  const rows: FieldRow[] = ids.map((id) => {
    const f = r.fields.find((x) => x.id.toLowerCase() === id.toLowerCase());
    const want = Object.entries(expect).find(([k]) => k.toLowerCase() === id.toLowerCase())?.[1];
    const value = f?.exists ? f.value : null;
    return {
      id, value,
      ...(f?.readOnly ? { readOnly: true } : {}),
      ...(editable.has(f?.id ?? id) ? { editable: true } : {}),
      ...(f?.options?.length ? { options: f.options } : {}),
      ...(want !== undefined ? { expected: want, ok: value !== null && sameValue(value, want) } : {}),
    };
  });
  if (!Object.keys(expect).length && !o.list) return { rows };
  return { rows, check: { loan, env, ...(o.list ? { list: o.list } : {}), ...compareFields(r.fields, ids, expect), at: Date.now() } };
}

export interface UpdateOpts {
  updates: boolean;
  /** How long to wait for the change to show (0: don't wait). */
  waitMs?: number;
  everyMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Told as the wait goes on. */
  progress?: (rows: FieldRow[]) => void;
}

/**
 * Change a loan's fields through the lookup's update form ('' clears a field), then read them again
 * every few seconds until they show what was sent. Refused, with nothing sent, when updates are off
 * here, a field is read-only or not on the loan, or a value isn't one of a field's options (matched
 * in any case and sent as the option is written). A field that has the value already isn't sent.
 */
export async function updateFields(lookup: Lookup, env: BuilderEnv, loan: string, set: Record<string, string>, o: UpdateOpts): Promise<{ rows: FieldRow[]; sent: number; watchUrl?: string; pending: string[] }> {
  const ids = Object.keys(set);
  if (!ids.length) throw new Error('Name the fields to change and their values.');
  if (ids.length > 50) throw new Error('At most 50 fields in one update.');
  if (!o.updates) throw new Error('Changing fields is off on this machine: the record lookup needs "allowUpdate": true, its "updateUrl" and "updateFields" in verify.json.');
  const r = await lookup.fetch(env, loan, ids, true, {});
  if (!r.found) throw new Error(`${loan} wasn’t found in ${env === 'dev' ? 'Dev' : 'UAT'}.`);
  if (!r.updatable || !r.token) throw new Error(r.updateNote ?? 'The record lookup didn’t offer its update form for this loan.');
  const editable = new Set(r.editable ?? []);
  const changes: FieldChange[] = [];
  const rows: FieldRow[] = [];
  for (const id of ids) {
    const f = r.fields.find((x) => x.id.toLowerCase() === id.toLowerCase());
    if (!f?.exists) throw new Error(`${id} isn’t a field on ${loan}.`);
    if (!editable.has(f.id)) throw new Error(`${id} is read-only: it can’t be changed through the lookup.`);
    const want = set[id];
    let value = want;
    if (want !== '' && f.options?.length) {
      const opt = f.options.find((x) => sameValue(x, want));
      if (!opt) throw new Error(`${id}: ${want} isn’t one of its options (${f.options.join(', ')}).`);
      value = opt;
    }
    rows.push({ id: f.id, value: f.value, sent: value, applied: sameValue(f.value, value) ? 'applied' : 'pending', ...(f.options?.length ? { options: f.options } : {}) });
    if (!sameValue(f.value, value)) changes.push(value === '' ? { id: f.id, value: '', clear: true } : { id: f.id, value });
  }
  if (!changes.length) return { rows, sent: 0, pending: [] };
  const sent = await lookup.update(r.token, changes);
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  const now = o.now ?? Date.now;
  const from = now();
  const waitMs = o.waitMs ?? APPLY_FOR_MS;
  let current = rows;
  const pendingIds = () => current.filter((x) => x.applied !== 'applied').map((x) => x.id);
  o.progress?.(current);
  while (pendingIds().length && now() - from < waitMs) {
    await sleep(o.everyMs ?? APPLY_EVERY_MS);
    let read: LookupResult | undefined;
    try { read = await lookup.fetch(env, loan, changes.map((c) => c.id), false, { session: false }); } catch { continue; }
    current = current.map((row) => {
      if (row.applied === 'applied') return row;
      const f = read!.fields.find((x) => x.id.toLowerCase() === row.id.toLowerCase());
      const seen = f?.exists ? f.value : '';
      const mark = sameValue(seen, row.sent ?? '') ? 'applied' : sameValue(seen, row.value ?? '') ? 'pending' : 'differs';
      return { ...row, value: f?.exists ? f.value : null, applied: mark };
    });
    o.progress?.(current);
  }
  return { rows: current, sent: sent.sent, ...(sent.watchUrl ? { watchUrl: sent.watchUrl } : {}), pending: pendingIds() };
}
