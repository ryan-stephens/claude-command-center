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
  /** The form for where the tools are (u). */
  setup: boolean;
}

const PROD_CONFIRM_MS = 4000;

const fresh = (): VerifyState => ({ cardId: null, ids: '', prefilled: 0, record: '', fields: '', env: 'dev', prodArmed: 0, advanced: false, checking: false, looking: false, refreshing: false, setup: false });

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
  // The environment and the setup form carry over; results and values don't.
  const { env, setup } = useVerify.getState();
  useVerify.setState({ ...fresh(), env: env === 'prod' ? 'dev' : env, setup, cardId: card.id, ids: ids.join('\n'), prefilled: ids.length });
}

const cfg = () => get().settings.verify ?? {};

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
  if (!envs.length) { put({ checkError: 'The set tool isn’t set up on this machine: u sets where it is.', check: undefined }); return; }
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
  if (!envs.length) { flash('The set tool isn’t set up: u sets where it is'); return; }
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

/** u: the form for where the tools are; opening it puts the cursor in its first field. */
export function toggleSetup(open?: boolean): void {
  const setup = open ?? !useVerify.getState().setup;
  put({ setup });
  if (setup) setTimeout(() => document.getElementById('verify-cfg-set-dev')?.focus(), 0);
}

/** Ctrl+Enter in the form: it submits itself (its values live in the form's own state). */
export function submitSetup(): void {
  (document.getElementById('verify-setup') as HTMLFormElement | null)?.requestSubmit();
}

/** The page o, O or L opens, for the environment chosen; undefined with why not. */
export function pageUrl(which: 'set' | 'add' | 'lookup', env = useVerify.getState().env): { url?: string; why?: string } {
  const c = cfg();
  if (which === 'lookup') return c.lookup?.url ? { url: c.lookup.url } : { why: 'The record lookup has no address yet: u sets it' };
  const base = setUrl(c, env);
  if (!base) return { why: `The set tool has no ${ENV_NAME[env]} address: u sets it` };
  if (which === 'set') return { url: base };
  return c.set?.addPage ? { url: `${base}/${c.set.addPage}` } : { why: 'The add-to-set page isn’t set: u sets it' };
}

/** o, O, L: the tool's own page in the browser. The add-to-set page is only opened: nothing is submitted from here. */
export function openPage(which: 'set' | 'add' | 'lookup'): void {
  const p = pageUrl(which);
  if (!p.url) { flash(p.why ?? 'Not set up'); return; }
  window.open(p.url, '_blank', 'noopener');
}
