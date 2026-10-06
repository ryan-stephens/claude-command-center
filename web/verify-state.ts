// The Verify panel's state and actions (PLAN §105), shared by the panel and its keys. Lookup values
// live here only: in this page's memory, gone with the next card or a reload; never in the card,
// the store's saved state or anything sent to Claude.

import { create } from 'zustand';
import type { Card } from '../shared/cards.ts';
import { ENV_NAME, SET_ENVS, idsInText, setUrl, splitIds, type EnvCheck, type LookupResult, type VerifyEnv } from '../shared/verify.ts';
import { flash, get } from './store.ts';
import { verifyCheck, verifyLookup, verifyRefresh } from './ws.ts';

export interface VerifyState {
  cardId: string | null;
  /** The field ids box. */
  ids: string;
  /** How many ids the card's ticket and notes gave the box. */
  prefilled: number;
  record: string;
  /** Fields to read from the record; empty: the ids box. */
  fields: string;
  /** The lookup's environment, and the one the tool pages open in. */
  env: VerifyEnv;
  /** When P was pressed once (a second press within PROD_CONFIRM_MS switches to Prod). */
  prodArmed: number;
  advanced: boolean;
  checking: boolean;
  check?: EnvCheck[];
  checkError?: string;
  looking: boolean;
  found?: LookupResult;
  lookError?: string;
  refreshing: boolean;
}

const PROD_CONFIRM_MS = 4000;

const fresh = (): VerifyState => ({ cardId: null, ids: '', prefilled: 0, record: '', fields: '', env: 'dev', prodArmed: 0, advanced: false, checking: false, looking: false, refreshing: false });

export const useVerify = create<VerifyState>(() => fresh());
const put = (p: Partial<VerifyState>) => useVerify.setState(p);

/** What a card says that may name fields: its ticket, its acceptance, your notes. */
export function cardText(card: Card): string {
  const t = card.ticket;
  const notes = [card.packet?.note, ...(card.later ?? []).filter((i) => i.kind === 'note').map((i) => i.text ?? i.label)];
  return [card.title, t?.title, t?.description, ...(t?.acceptance ?? []), ...notes].filter(Boolean).join('\n');
}

/** The panel opened on a card: a new card starts afresh, its ids box filled from what the card says. */
export function verifyFor(card: Card): void {
  if (useVerify.getState().cardId === card.id) return;
  const ids = idsInText(cardText(card));
  // The environment carries over; results and values don't.
  const { env } = useVerify.getState();
  useVerify.setState({ ...fresh(), env: env === 'prod' ? 'dev' : env, cardId: card.id, ids: ids.join('\n'), prefilled: ids.length });
}

const cfg = () => get().verify?.config ?? {};

/** The set tool's environments this machine has addresses for (dev and uat side by side; prod when given). */
export function setEnvs(): VerifyEnv[] {
  return [...SET_ENVS, 'prod' as const].filter((e) => setUrl(cfg(), e));
}

/** e: Dev ↔ UAT for the lookup and the tool pages; from Prod, back to Dev. */
export function cycleEnv(): void {
  const env = useVerify.getState().env === 'dev' ? 'uat' : 'dev';
  put({ env, prodArmed: 0 });
  flash(`Verify: ${ENV_NAME[env]}`);
}

/** P: Prod for the lookup, after a second press (it reads production data); P on Prod goes back to Dev. */
export function armProd(now = Date.now()): void {
  const s = useVerify.getState();
  if (s.env === 'prod') { put({ env: 'dev', prodArmed: 0 }); flash('Verify: Dev'); return; }
  if (now - s.prodArmed < PROD_CONFIRM_MS) { put({ env: 'prod', prodArmed: 0 }); flash('Verify: Prod. Lookups read production; nothing is written'); return; }
  put({ prodArmed: now });
  flash('P again to look up in Prod (read only)');
}

export function setField(p: Partial<Pick<VerifyState, 'ids' | 'record' | 'fields'>>): void { put(p); }

/** Enter: the ids in every environment the set tool has; and the record too, when one is named. */
export function runVerify(): void {
  void runCheck();
  if (useVerify.getState().record.trim()) void runLookup();
}

export async function runCheck(): Promise<void> {
  const ids = splitIds(useVerify.getState().ids);
  if (!ids.length) { flash('Paste a field id or two first (i)'); return; }
  const envs = setEnvs();
  if (!envs.length) { put({ checkError: `${cap(toolName('set'))} has no address in this machine’s Verify file.`, check: undefined }); return; }
  const card = useVerify.getState().cardId;
  put({ checking: true, checkError: undefined });
  try {
    const check = await verifyCheck(envs, ids);
    if (useVerify.getState().cardId === card) put({ check });
  } catch (e) {
    if (useVerify.getState().cardId === card) put({ checkError: (e as Error).message });
  } finally {
    if (useVerify.getState().cardId === card) put({ checking: false });
  }
}

export async function runLookup(): Promise<void> {
  const s = useVerify.getState();
  const record = s.record.trim();
  if (!record) { flash('Name the record first (l)'); return; }
  const ids = splitIds(s.fields.trim() ? s.fields : s.ids);
  if (!ids.length) { flash('Name a field or two to read'); return; }
  put({ looking: true, lookError: undefined, found: undefined });
  try {
    const found = await verifyLookup(s.env, record, ids, s.advanced);
    if (useVerify.getState().cardId === s.cardId) put({ found });
  } catch (e) {
    if (useVerify.getState().cardId === s.cardId) put({ lookError: (e as Error).message });
  } finally {
    if (useVerify.getState().cardId === s.cardId) put({ looking: false });
  }
}

/** r: read each environment's set again; the check's version line follows. */
export async function refreshSets(): Promise<void> {
  const envs = setEnvs();
  if (!envs.length) { flash(`${cap(toolName('set'))} has no address in this machine’s Verify file`); return; }
  put({ refreshing: true });
  const done = await Promise.allSettled(envs.map(async (env) => [env, await verifyRefresh(env)] as const));
  put({ refreshing: false });
  const check = useVerify.getState().check;
  const got = done.flatMap((d) => (d.status === 'fulfilled' ? [d.value] : []));
  if (check) put({ check: check.map((c) => { const hit = got.find(([env]) => env === c.env); return hit ? { ...c, set: hit[1], setError: undefined } : c; }) });
  const failed = done.find((d) => d.status === 'rejected') as PromiseRejectedResult | undefined;
  flash(failed ? (failed.reason as Error).message : `Read the set again: ${got.map(([env, v]) => `${ENV_NAME[env]} v${v.number ?? '?'} (${v.fields} field${v.fields === 1 ? '' : 's'})`).join(', ')}`);
}

export function toggleAdvanced(): void {
  const advanced = !useVerify.getState().advanced;
  put({ advanced });
  flash(advanced ? 'Advanced fetch on: slower, reads more' : 'Advanced fetch off');
}

/** A tool's name, as this machine's Verify file gives it, or a plain description (lower case, for mid-sentence). */
/** The same, to start a sentence with. */
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function toolName(which: 'set' | 'lookup'): string {
  return (which === 'set' ? cfg().set?.name : cfg().lookup?.name) ?? (which === 'set' ? 'the field set' : 'the record lookup');
}

/** The page o, O or L opens, for the environment chosen; undefined with why not. */
export function pageUrl(which: 'set' | 'add' | 'lookup', env = useVerify.getState().env): { url?: string; why?: string } {
  const c = cfg();
  if (which === 'lookup') return c.lookup?.url ? { url: c.lookup.url } : { why: `${cap(toolName('lookup'))} has no address in this machine’s Verify file` };
  const base = setUrl(c, env);
  if (!base) return { why: `${cap(toolName('set'))} has no ${ENV_NAME[env]} address in this machine’s Verify file` };
  if (which === 'set') return { url: base };
  return c.set?.addPage ? { url: `${base}/${c.set.addPage}` } : { why: `${cap(toolName('set'))}’s add-to-set page isn’t in this machine’s Verify file` };
}

/** o, O, L: the tool's own page in the browser. The add-to-set page is only opened: nothing is submitted from here. */
export function openPage(which: 'set' | 'add' | 'lookup'): void {
  if (which === 'add') { addToSet(useVerify.getState().env); return; }
  const p = pageUrl(which);
  if (!p.url) { flash(p.why ?? 'Not set up'); return; }
  window.open(p.url, '_blank', 'noopener');
}

/** The ids the last check found known but not in the environment's set: what there is to add. */
export function missingIn(env: VerifyEnv): string[] {
  return (useVerify.getState().check?.find((c) => c.env === env)?.rows ?? []).filter((r) => r.known && !r.inSet).map((r) => r.id);
}

/**
 * Shift+O, or Add on a field the set lacks: the set tool's add-to-set page for the environment, with
 * the ids to add copied to paste there. Only opened; adding is done on that page, by you.
 */
export function addToSet(env: VerifyEnv, ids = missingIn(env)): void {
  const p = pageUrl('add', env);
  if (!p.url) { flash(p.why ?? 'Not set up'); return; }
  window.open(p.url, '_blank', 'noopener');
  if (!ids.length) return;
  navigator.clipboard?.writeText(ids.join('\n')).then(
    () => flash(`Copied ${ids.join(', ')}: paste it in ${toolName('set')}’s add-to-set page (${ENV_NAME[env]})`),
    () => flash(`Opened ${toolName('set')}’s add-to-set page (${ENV_NAME[env]}); add ${ids.join(', ')} there`),
  );
}
