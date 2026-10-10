// The pure parts of a data check (§139): reading the lines a person types ("ID = value"), comparing
// values the way the record lookup shows them, and the one-line summary the Switchboard and Claude get.

import type { DataCheck, DataCheckAsk, DataStepName } from './types.ts';

/** Two values alike: numbers with or without thousands commas, anything else in any case, spaces trimmed. */
export function sameValue(a: string, b: string): boolean {
  const norm = (v: string) => { const t = v.trim(); return /^-?[\d,]*\.?\d+$/.test(t) && /\d/.test(t) ? String(Number(t.replace(/,/g, ''))) : t.toLowerCase(); };
  return norm(a) === norm(b);
}

/**
 * Lines of "ID = value" (or "ID: value" never: ids may hold colons, so only "="), one per line;
 * a line with no "=" is just an id. An id may have spaces in it. "ID =" means the empty value.
 */
export function parseFieldLines(text: string): { ids: string[]; values: Record<string, string> } {
  const ids: string[] = [];
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    const id = (at < 0 ? line : line.slice(0, at)).trim();
    if (!id) continue;
    if (!ids.some((x) => x.toLowerCase() === id.toLowerCase())) ids.push(id);
    if (at >= 0) values[id] = line.slice(at + 1).trim();
  }
  return { ids, values };
}

/** What a data check asks for, checked before anything runs. Throws in plain words. */
export function cleanAsk(a: Record<string, unknown>): DataCheckAsk {
  const env = String(a.env ?? 'dev').toLowerCase();
  if (env !== 'dev' && env !== 'uat') throw new Error('Data checks are for Dev or UAT only, never Prod.');
  const scenario = typeof a.scenario === 'string' && a.scenario.trim() ? a.scenario.trim() : undefined;
  const loan = typeof a.loan === 'string' && a.loan.trim() ? a.loan.trim() : undefined;
  if (!scenario && !loan) throw new Error('Name a scenario to make a loan from, or a loan to use.');
  if (scenario && loan) throw new Error('Either a scenario (a new loan) or a loan, not both.');
  if (loan && !/^[\w.{}-]{1,80}$/.test(loan)) throw new Error('That loan id doesn’t look like one.');
  const map = (v: unknown): Record<string, string> | undefined => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (k.trim()) out[k.trim()] = x === null || x === undefined ? '' : String(x);
    return Object.keys(out).length ? out : undefined;
  };
  const set = map(a.set);
  const expect = map(a.expect);
  const fields = Array.isArray(a.fields) ? a.fields.map((f) => String(f).trim()).filter(Boolean) : [];
  const list = typeof a.list === 'string' && a.list.trim() ? a.list.trim() : undefined;
  if (set && Object.keys(set).length > 50) throw new Error('At most 50 fields filled in one check.');
  if (!set && !expect && !fields.length && !list) throw new Error('Say which fields to fill or check (or a saved field list).');
  return { env, ...(scenario ? { scenario } : {}), ...(loan ? { loan } : {}), ...(set ? { set } : {}), ...(list ? { list } : {}), ...(fields.length ? { fields } : {}), ...(expect ? { expect } : {}) };
}

/** Every id to read at the end: the list's, the ones named, the ones filled, the ones expected; each once. */
export function idsToRead(ask: DataCheckAsk, listIds: string[] = []): string[] {
  const out: string[] = [];
  for (const id of [...listIds, ...(ask.fields ?? []), ...Object.keys(ask.set ?? {}), ...Object.keys(ask.expect ?? {})]) {
    if (!out.some((x) => x.toLowerCase() === id.toLowerCase())) out.push(id);
  }
  return out;
}

export const STEP_WORD: Record<DataStepName, string> = { loan: 'Loan', set: 'Fill', apply: 'Applied', check: 'Check' };

/** One line for a check: "SHOP loan 6a4d… in Dev · filled 3, applied · 11 / 12 (CX.FEE differs)". */
export function checkLine(c: DataCheck): string {
  const env = c.ask.env === 'dev' ? 'Dev' : 'UAT';
  const parts = [`${c.loan ? `loan ${c.loan}` : 'a new loan'} in ${env}`];
  for (const s of c.steps) if (s.state !== 'skipped' && s.name !== 'loan') parts.push(`${STEP_WORD[s.name].toLowerCase()}: ${s.text}`);
  return `${c.state === 'running' ? 'Running' : c.state === 'passed' ? 'Passed' : c.state === 'differs' ? 'Differs' : 'Failed'}: ${parts.join(' · ')}`;
}
