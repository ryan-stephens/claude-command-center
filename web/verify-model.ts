// The Verify panel's pure parts (PLAN §132): its sub-sections, the lookup's filter and copy, the
// recent records. No store and no DOM, so they are tested alone (verify-model.test.ts).

import type { LookupField, VerifyConfig, VerifyEnv } from '../shared/verify.ts';

export type VerifySection = 'builder' | 'lookup' | 'set';

/**
 * The panel's sub-sections, one per tool, in tab order. A fourth tool is one entry here and one
 * component: `configured` says whether this machine's Verify file sets it up.
 */
export const SECTIONS: { id: VerifySection; defaultName: string; configured: (c: VerifyConfig) => boolean }[] = [
  { id: 'builder', defaultName: 'Test data', configured: (c) => Boolean(c.builder?.url) },
  { id: 'lookup', defaultName: 'Record lookup', configured: (c) => Boolean(c.lookup?.url) },
  { id: 'set', defaultName: 'Field set', configured: (c) => Boolean(c.set?.urls && Object.keys(c.set.urls).length) },
];

/** A section's name: the one the machine's file gives the tool, or its default. */
export function sectionName(id: VerifySection, c: VerifyConfig): string {
  return c[id]?.name ?? SECTIONS.find((s) => s.id === id)!.defaultName;
}

/** The section to show: the one chosen, else the first this machine sets up; none when nothing is set up. */
export function sectionShown(chosen: VerifySection | null, c: VerifyConfig): VerifySection | null {
  if (chosen) return chosen;
  return SECTIONS.find((s) => s.configured(c))?.id ?? null;
}

/** Alt+← / Alt+→: the previous or next section, round. */
export function stepSection(from: VerifySection | null, delta: number): VerifySection {
  const at = from ? SECTIONS.findIndex((s) => s.id === from) : -1;
  return SECTIONS[(at + delta + SECTIONS.length * 2) % SECTIONS.length].id;
}

/** The lookup's rows the filter (/) and "only empty or missing" (Shift+M) leave. */
export function visibleFields(fields: LookupField[], filter: string, onlyEmpty: boolean): LookupField[] {
  const q = filter.trim().toLowerCase();
  return fields.filter((f) => (!onlyEmpty || !f.exists || !f.value.trim()) && (!q || f.id.toLowerCase().includes(q) || (f.exists && f.value.toLowerCase().includes(q))));
}

/** Rows as field=value lines, to paste somewhere (Shift+Y). A missing field has no value. */
export function fieldLines(fields: LookupField[]): string {
  return fields.map((f) => `${f.id}=${f.exists ? f.value : ''}`).join('\n');
}

/** A record fetched, for the chips under the record box. */
export interface RecentRecord { record: string; env: VerifyEnv; label?: string }

export const RECENT_MAX = 8;

/** The newest first; the same record in the same environment only once (a new label wins). */
export function pushRecent(list: RecentRecord[], r: RecentRecord): RecentRecord[] {
  const had = list.find((x) => x.record === r.record && x.env === r.env);
  return [{ ...r, ...(r.label || !had?.label ? {} : { label: had.label }) }, ...list.filter((x) => x !== had)].slice(0, RECENT_MAX);
}

// ---- The test-data section's run (§133) ----

export const POLL_MS = 2000;
export const POLL_MAX_MS = 15 * 60_000;
/** Polls in a row that fail before the page stops asking. */
export const POLL_MAX_ERRORS = 3;
/** How long the first Enter (or Shift+P, Shift+U) stays armed. */
export const ARM_MS = 4000;

export type RunPhase = 'poll' | 'succeeded' | 'failed' | 'timeout' | 'error';

/**
 * After a poll: ask again in POLL_MS while the run is going, stop when it ends, when it has gone on
 * for POLL_MAX_MS, or after POLL_MAX_ERRORS failed polls in a row.
 */
export function runPhase(status: 'running' | 'succeeded' | 'failed' | undefined, errors: number, startedAt: number, now: number): RunPhase {
  if (status === 'succeeded' || status === 'failed') return status;
  if (errors >= POLL_MAX_ERRORS) return 'error';
  if (now - startedAt >= POLL_MAX_MS) return 'timeout';
  return 'poll';
}

/** The scenarios the filter (/) leaves: by name, version (v3) or tag. */
export function visibleScenarios<T extends { name: string; version: number; tags: string[] }>(list: T[], filter: string): T[] {
  const q = filter.trim().toLowerCase();
  if (!q) return list;
  return list.filter((s) => s.name.toLowerCase().includes(q) || `v${s.version}` === q || s.tags.some((t) => t.toLowerCase().includes(q)));
}

/** A two-step key: armed when pressed once, fired when pressed again within ARM_MS on the same thing. */
export function armed(arm: { key: string; at: number } | null, key: string, now: number): boolean {
  return Boolean(arm && arm.key === key && now - arm.at < ARM_MS);
}

// ---- Updates through the record lookup (§134) ----

/** A change staged on a row: the value it had, the one to send, or an explicit clear. */
export interface Staged { old: string; value: string; clear?: boolean }

/** The same value as the tool shows it: trimmed, and numbers alike with or without thousands commas. */
export function sameValue(a: string, b: string): boolean {
  const x = a.trim(), y = b.trim();
  if (x === y) return true;
  const num = (s: string) => (/^-?[\d,]*\.?\d+$/.test(s) && /\d/.test(s) ? Number(s.replace(/,/g, '')) : NaN);
  const nx = num(x), ny = num(y);
  return !Number.isNaN(nx) && nx === ny;
}

/**
 * Enter on an edit: the row's change staged, or why not. An empty edit is no change (a clear is
 * Backspace); a value the field already has is no change; a field with options takes one of them.
 */
export function stageEdit(staged: Record<string, Staged>, f: { id: string; value: string; options?: string[] }, value: string, clear = false): { staged: Record<string, Staged>; note?: string } {
  const rest = Object.fromEntries(Object.entries(staged).filter(([k]) => k !== f.id));
  if (clear) return f.value === '' ? { staged: rest, note: `${f.id} is empty already` } : { staged: { ...rest, [f.id]: { old: f.value, value: '', clear: true } } };
  if (value.trim() === '') return { staged: rest, note: 'An empty edit is no change (Backspace clears a field)' };
  if (f.options?.length && !f.options.includes(value)) return { staged, note: `${value} isn’t one of ${f.id}’s options` };
  if (sameValue(value, f.value)) return { staged: rest, note: `${f.id} has that value already` };
  return { staged: { ...rest, [f.id]: { old: f.value, value } } };
}

export type AfterMark = 'pending' | 'applied' | 'differs';

/** A row after an update: still the old value, the one sent, or a third. */
export function afterMark(s: Staged, seen: string): AfterMark {
  if (sameValue(seen, s.clear ? '' : s.value)) return 'applied';
  if (sameValue(seen, s.old)) return 'pending';
  return 'differs';
}

export const AFTER_EVERY_MS = 10_000;
export const AFTER_FOR_MS = 3 * 60_000;

/** The checks after an update: stop when every row is applied, or after AFTER_FOR_MS. */
export function afterPhase(marks: AfterMark[], startedAt: number, now: number): 'poll' | 'applied' | 'timeout' {
  if (marks.length && marks.every((m) => m === 'applied')) return 'applied';
  if (now - startedAt >= AFTER_FOR_MS) return 'timeout';
  return 'poll';
}

/** A record id, shortened for a line: the first 8 characters. */
export const shortId = (id: string): string => (id.length > 12 ? `${id.replace(/^\{/, '').slice(0, 8)}…` : id);
