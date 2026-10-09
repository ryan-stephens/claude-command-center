// The internal tools as Claude's toolbelt calls them (v2 hands these to the session on purpose:
// test loans and their fields in Dev and UAT are what proving a change takes). Every request still
// goes through v1's guard (server/verify.ts): the scenario runner's three calls and the lookup's
// read, never Prod, never the lookup's update form. Addresses and names come from the machine's
// ~/.cc-control/verify.json, never the repo.

import type { BuilderEnv, BuilderScenario, LookupField } from '../../shared/verify.ts';
import { readFieldLists, type LookupTool } from '../../server/verify.ts';
import type { BuilderTool } from '../../server/verify-builder.ts';
import type { FieldCheckResult, LoanMade } from '../shared/types.ts';

export const LOAN_POLL_MS = 2_000;
export const LOAN_WAIT_MS = 10 * 60_000;

export function envOf(v: unknown): BuilderEnv {
  const e = String(v ?? 'dev').toLowerCase();
  if (e !== 'dev' && e !== 'uat') throw new Error('Test loans and field checks are for Dev or UAT only, never Prod.');
  return e;
}

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

/** Make a test loan: start the scenario, wait for its run, and say the loans it made (or why it failed). */
export async function makeLoan(builder: BuilderTool, env: BuilderEnv, scenario: string, wait = LOAN_WAIT_MS, poll = LOAN_POLL_MS): Promise<{ loans: LoanMade[]; text: string }> {
  const s = findScenario(await builder.scenarios(), scenario);
  const runId = await builder.start(env, s.id, s.version);
  const until = Date.now() + wait;
  for (;;) {
    await new Promise((r) => setTimeout(r, poll));
    const run = await builder.run(runId);
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

/** The ids to read: a saved list by name, or the ids given. */
export function idsFor(list: string | undefined, fields: string[] | undefined): { ids: string[]; list?: string } {
  if (list) {
    const found = readFieldLists().lists.find((l) => l.name.toLowerCase() === list.trim().toLowerCase());
    if (!found) throw new Error(`No saved field list called "${list}". Saved: ${readFieldLists().lists.map((l) => l.name).join(', ') || 'none'}.`);
    return { ids: found.ids, list: found.name };
  }
  const ids = (fields ?? []).map((f) => String(f).trim()).filter(Boolean);
  if (!ids.length) throw new Error('Name the fields to read, or a saved field list.');
  return { ids };
}

/** Compare what was read with what was expected (numbers alike with or without thousands commas, any case for true/false). */
export function compareFields(read: LookupField[], ids: string[], expect: Record<string, string> = {}): Pick<FieldCheckResult, 'total' | 'matched' | 'differs'> {
  const norm = (v: string) => { const t = v.trim(); return /^-?[\d,]+(\.\d+)?$/.test(t) ? t.replace(/,/g, '') : t.toLowerCase(); };
  const differs: FieldCheckResult['differs'] = [];
  for (const id of ids) {
    const f = read.find((x) => x.id.toLowerCase() === id.toLowerCase());
    const want = Object.entries(expect).find(([k]) => k.toLowerCase() === id.toLowerCase())?.[1];
    if (!f || !f.exists) differs.push({ id, ...(want !== undefined ? { expected: want } : {}) });
    else if (want !== undefined && norm(f.value) !== norm(want)) differs.push({ id, expected: want, actual: f.value });
  }
  return { total: ids.length, matched: ids.length - differs.length, differs };
}

/** Read a loan's fields and compare. Returns the result and the values read (for Claude). */
export async function checkFields(lookup: LookupTool, env: BuilderEnv, loan: string, ids: string[], expect: Record<string, string> = {}, list?: string): Promise<{ result: FieldCheckResult; values: Record<string, string | null> }> {
  const r = await lookup.fetch(env, loan, ids, false, { session: false });
  if (!r.found) throw new Error(`${loan} wasn’t found in ${env === 'dev' ? 'Dev' : 'UAT'}.`);
  const cmp = compareFields(r.fields, ids, expect);
  const values: Record<string, string | null> = {};
  for (const id of ids) { const f = r.fields.find((x) => x.id.toLowerCase() === id.toLowerCase()); values[id] = f?.exists ? f.value : null; }
  return { result: { loan, env, ...(list ? { list } : {}), ...cmp, at: Date.now() }, values };
}
