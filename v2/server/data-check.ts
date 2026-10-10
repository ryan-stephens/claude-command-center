// A data check (§139), run by the server step by step, so it carries on while you (or Claude) do
// something else and the Switchboard shows where it is:
//   loan   make one from a scenario through the test-data tool (or use the one given)
//   set    fill fields through the record lookup's update form (Dev or UAT, only when this machine
//          allows updates, only fields the page lets you change, only their options)
//   apply  read those fields again every 10 s until they show what was sent (3 minutes at most)
//   check  read every field asked for and compare with what was filled and what was expected
// Every request goes through v1's guard, as the page's own do. Never Prod.

import { randomUUID } from 'node:crypto';
import type { BuilderEnv, FieldChange, LookupResult, UpdateSent } from '../../shared/verify.ts';
import { idsToRead, sameValue } from '../shared/data-check.ts';
import type { DataCheck, DataCheckAsk, DataStepName, FieldCheckResult, LoanMade } from '../shared/types.ts';

export const APPLY_EVERY_MS = 10_000;
export const APPLY_FOR_MS = 3 * 60_000;
export const KEEP_CHECKS = 8;

export interface DataDeps {
  makeLoan: (env: BuilderEnv, scenario: string) => Promise<{ loans: LoanMade[] }>;
  lookup: {
    fetch: (env: BuilderEnv, loan: string, ids: string[], advanced: boolean, opts: { session?: boolean }) => Promise<LookupResult>;
    update: (token: string, changes: FieldChange[]) => Promise<UpdateSent>;
  };
  check: (env: BuilderEnv, loan: string, ids: string[], expect: Record<string, string>, list?: string) => Promise<{ result: FieldCheckResult; values: Record<string, string | null> }>;
  /** A saved field list's ids by name (throws for an unknown one). */
  listIds: (name: string) => string[];
  updatesOn: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  applyEvery?: number;
  applyFor?: number;
}

export function newCheck(ask: DataCheckAsk, by: DataCheck['by'], now = Date.now()): DataCheck {
  const fills = Object.keys(ask.set ?? {}).length > 0;
  return {
    id: randomUUID().slice(0, 8), ask, by, state: 'running', startedAt: now,
    steps: [
      { name: 'loan', state: 'waiting', text: ask.loan ? `use ${ask.loan}` : `from ${ask.scenario}` },
      { name: 'set', state: fills ? 'waiting' : 'skipped', text: fills ? `${Object.keys(ask.set!).length} field(s)` : 'nothing to fill' },
      { name: 'apply', state: fills ? 'waiting' : 'skipped', text: fills ? 'after the fill' : '' },
      { name: 'check', state: 'waiting', text: '' },
    ],
  };
}

/** Run a check, telling `progress` after every step; resolves with the check as it ended (never throws). */
export async function runDataCheck(start: DataCheck, deps: DataDeps, progress: (c: DataCheck, made?: { loans?: LoanMade[]; result?: FieldCheckResult }) => void): Promise<DataCheck> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const every = deps.applyEvery ?? APPLY_EVERY_MS;
  const upTo = deps.applyFor ?? APPLY_FOR_MS;
  let c: DataCheck = start;
  const step = (name: DataStepName, state: DataCheck['steps'][number]['state'], text?: string) => {
    c = { ...c, steps: c.steps.map((s) => (s.name === name ? { ...s, state, ...(text !== undefined ? { text } : {}) } : s)) };
  };
  const tell = (made?: { loans?: LoanMade[]; result?: FieldCheckResult }) => progress(c, made);
  const end = (state: DataCheck['state']) => { c = { ...c, state, endedAt: now() }; tell(); return c; };
  const failAt = (name: DataStepName, e: unknown) => {
    step(name, 'failed', (e as Error).message);
    for (const s of c.steps) if (s.state === 'waiting') step(s.name, 'skipped', '');
    return end('failed');
  };
  const { env } = c.ask;

  // Loan.
  let loan = c.ask.loan;
  if (!loan) {
    step('loan', 'running', `making one from ${c.ask.scenario}…`);
    tell();
    try {
      const r = await deps.makeLoan(env, c.ask.scenario!);
      loan = r.loans[0]?.loan;
      if (!loan) throw new Error(`${c.ask.scenario} succeeded but named no loan.`);
      c = { ...c, loan };
      step('loan', 'done', `${loan} from ${c.ask.scenario}`);
      tell({ loans: r.loans });
    } catch (e) { return failAt('loan', e); }
  } else {
    c = { ...c, loan };
    step('loan', 'done', `using ${loan}`);
    tell();
  }

  // Fill, then wait until it applies.
  let applyFailed = false;
  const set = c.ask.set ?? {};
  const setIds = Object.keys(set);
  if (setIds.length) {
    step('set', 'running', `filling ${setIds.length} field(s)…`);
    tell();
    let changes: FieldChange[] = [];
    try {
      if (!deps.updatesOn()) throw new Error('Filling fields is off on this machine: the record lookup needs "allowUpdate": true and its "updateUrl" in verify.json.');
      const r = await deps.lookup.fetch(env, loan, setIds, true, {});
      if (!r.found) throw new Error(`${loan} wasn’t found in ${env === 'dev' ? 'Dev' : 'UAT'}.`);
      if (!r.updatable || !r.token) throw new Error(r.updateNote ?? 'The record lookup didn’t offer its update form for this loan.');
      const editable = new Set(r.editable ?? []);
      const bad = setIds.filter((id) => !editable.has(id));
      if (bad.length) throw new Error(`Can’t fill ${bad.join(', ')}: read-only, or not a field on this loan.`);
      for (const id of setIds) {
        const f = r.fields.find((x) => x.id === id);
        const want = set[id];
        if (f && f.exists && sameValue(f.value, want)) continue;
        if (want !== '' && f?.options?.length && !f.options.includes(want)) {
          const opt = f.options.find((o) => sameValue(o, want));
          if (!opt) throw new Error(`${id}: ${want} isn’t one of its options (${f.options.join(', ')}).`);
          changes.push({ id, value: opt });
        } else changes.push(want === '' ? { id, value: '', clear: true } : { id, value: want });
      }
      if (!changes.length) {
        step('set', 'done', 'every field had its value already');
        step('apply', 'skipped', '');
        tell();
      } else {
        const sent = await deps.lookup.update(r.token, changes);
        c = { ...c, ...(sent.watchUrl ? { watchUrl: sent.watchUrl } : {}) };
        step('set', 'done', `sent ${sent.sent} field(s)`);
        tell();
      }
    } catch (e) { return failAt('set', e); }

    if (changes.length) {
      step('apply', 'running', 'waiting for the update to apply…');
      tell();
      const ids = changes.map((x) => x.id);
      const from = now();
      for (;;) {
        await sleep(every);
        let read: LookupResult | undefined;
        try { read = await deps.lookup.fetch(env, loan, ids, false, { session: false }); } catch { /* asked again next time */ }
        const pending = read ? changes.filter((ch) => { const f = read!.fields.find((x) => x.id.toLowerCase() === ch.id.toLowerCase()); return !f || !sameValue(f.exists ? f.value : '', ch.clear ? '' : ch.value); }) : changes;
        if (!pending.length) { step('apply', 'done', `all ${changes.length} applied`); tell(); break; }
        if (now() - from >= upTo) {
          applyFailed = true;
          step('apply', 'failed', `not applied after ${Math.round(upTo / 60_000)} minutes: ${pending.map((p) => p.id).join(', ')}`);
          tell();
          break;
        }
        step('apply', 'running', `${changes.length - pending.length} of ${changes.length} applied…`);
        tell();
      }
    }
  }

  // Check.
  step('check', 'running', 'reading…');
  tell();
  try {
    const listIds = c.ask.list ? deps.listIds(c.ask.list) : [];
    const ids = idsToRead(c.ask, listIds);
    const expect = { ...set, ...(c.ask.expect ?? {}) };
    const r = await deps.check(env, loan, ids, expect, c.ask.list);
    const { result, values } = r;
    c = { ...c, result, values };
    step('check', result.differs.length ? 'failed' : 'done', `${result.matched} / ${result.total}${result.differs.length ? `, ${result.differs.map((d) => d.id).slice(0, 3).join(', ')} differ${result.differs.length === 1 ? 's' : ''}` : ''}`);
    progress(c, { result });
    return end(applyFailed ? 'failed' : result.differs.length ? 'differs' : 'passed');
  } catch (e) { return failAt('check', e); }
}
