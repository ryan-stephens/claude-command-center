// The Verify panel's state and actions (PLAN §105, §132), shared by the panel and its keys. Lookup
// values live here only: in this page's memory, gone with the next card or a reload; never in the
// card, the store's saved state or anything sent to Claude.

import { create } from 'zustand';
import type { Card } from '../shared/cards.ts';
import { ENV_NAME, SET_ENVS, idsInText, setUrl, splitFieldLines, splitIds, type EnvCheck, type LookupResult, type VerifyConfig, type VerifyEnv } from '../shared/verify.ts';
import { flash, get, useStore } from './store.ts';
import { fieldLines, pushRecent, sectionName, sectionShown, stepSection, visibleFields, type RecentRecord, type VerifySection } from './verify-model.ts';
import { verifyCheck, verifyListDelete, verifyListSave, verifyLookup, verifyRefresh } from './ws.ts';

export interface VerifyState {
  cardId: string | null;
  /** The sub-section shown (§132); null: the first this machine sets up. Kept from card to card. */
  section: VerifySection | null;
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
  /** The lookup's filter (/) and "only empty or missing" (Shift+M). */
  lookFilter: string;
  onlyEmpty: boolean;
  /** The last records fetched (ids and environments only), newest first; kept from card to card, gone on reload. */
  recent: RecentRecord[];
  /** Where ↑ / ↓ in the record box are in `recent`. */
  recentAt: number;
  /** The saved list chosen (f); the name being typed for Save as list (Shift+S), while its box is open. */
  list: string;
  listName: string | null;
  /** When Shift+F was pressed once (a second press deletes the chosen list). */
  listDeleteArmed: number;
}

const PROD_CONFIRM_MS = 4000;

const fresh = (): VerifyState => ({
  cardId: null, section: null, ids: '', prefilled: 0, record: '', fields: '', env: 'dev', prodArmed: 0, advanced: false, checking: false, looking: false, refreshing: false,
  lookFilter: '', onlyEmpty: false, recent: [], recentAt: -1, list: '', listName: null, listDeleteArmed: 0,
});

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
  // The environment, the section, the recent records and the chosen list carry over; results and values don't.
  const { env, section, recent, list, fields } = useVerify.getState();
  useVerify.setState({ ...fresh(), env: env === 'prod' ? 'dev' : env, section, recent, list, fields: list ? fields : '', cardId: card.id, ids: ids.join('\n'), prefilled: ids.length });
}

const cfg = (): VerifyConfig => get().verify?.config ?? {};

/** The section shown now. */
export function currentSection(): VerifySection | null {
  return sectionShown(useVerify.getState().section, cfg());
}

/** The section shown, for the legend: it follows the chosen section and the machine's file. */
export function useVerifySection(): VerifySection | null {
  const chosen = useVerify((s) => s.section);
  const config = useStore((s) => s.verify?.config);
  return sectionShown(chosen, config ?? {});
}

/** A tab, or Alt+← / Alt+→: another section. */
export function showSection(section: VerifySection): void {
  put({ section });
}

export function cycleSection(delta: number): void {
  const next = stepSection(currentSection(), delta);
  showSection(next);
  flash(`Verify: ${sectionName(next, cfg())}`);
}

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

export function setField(p: Partial<Pick<VerifyState, 'ids' | 'record' | 'fields' | 'lookFilter' | 'listName'>>): void { put(p); }

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

/** The ids a lookup reads: the Fields box, one per line as they are; empty, the ids box. */
export function lookupIds(s = useVerify.getState()): string[] {
  return splitFieldLines(s.fields.trim() ? s.fields : s.ids);
}

export async function runLookup(label?: string): Promise<void> {
  const s = useVerify.getState();
  const record = s.record.trim();
  if (!record) { flash('Name the record first (l)'); return; }
  const ids = lookupIds(s);
  if (!ids.length) { flash('Name a field or two to read (i)'); return; }
  put({ looking: true, lookError: undefined, found: undefined, recentAt: -1 });
  try {
    const found = await verifyLookup(s.env, record, ids, s.advanced);
    if (useVerify.getState().cardId !== s.cardId) return;
    put({ found });
    // Prod lookups aren't offered again from the chips: Prod is always two presses away.
    if (found.found && found.env !== 'prod') put({ recent: pushRecent(useVerify.getState().recent, { record: found.recordId, env: found.env, ...(label ? { label } : {}) }) });
  } catch (e) {
    if (useVerify.getState().cardId === s.cardId) put({ lookError: (e as Error).message });
  } finally {
    if (useVerify.getState().cardId === s.cardId) put({ looking: false });
  }
}

/** A recent record's chip, or ↑ / ↓ in the record box: its id in the box, its environment chosen. */
export function pickRecent(i: number): void {
  const r = useVerify.getState().recent[i];
  if (!r) return;
  put({ record: r.record, env: r.env, prodArmed: 0, recentAt: i });
}

/** ↑ / ↓ in the record box: older and newer recent records. */
export function stepRecent(delta: number): void {
  const s = useVerify.getState();
  if (!s.recent.length) { flash('No records fetched yet'); return; }
  pickRecent(Math.max(0, Math.min(s.recent.length - 1, s.recentAt + delta)));
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
  flash(advanced ? 'Advanced fetch on: slower; marks read-only and missing fields, and gives options' : 'Advanced fetch off');
}

/** Shift+M: only the rows that are empty or don't exist. */
export function toggleOnlyEmpty(): void {
  const onlyEmpty = !useVerify.getState().onlyEmpty;
  put({ onlyEmpty });
  flash(onlyEmpty ? 'Only empty or missing fields' : 'Every field');
}

/** The lookup's rows the filter and Shift+M leave. */
export function shownFields(s = useVerify.getState()) {
  return s.found?.found ? visibleFields(s.found.fields, s.lookFilter, s.onlyEmpty) : [];
}

/** Shift+Y: the rows shown, as field=value lines, to the clipboard. The values go nowhere else. */
export function copyFields(): void {
  const rows = shownFields();
  if (!rows.length) { flash('Nothing to copy: look a record up first'); return; }
  navigator.clipboard?.writeText(fieldLines(rows)).then(() => flash(`Copied ${rows.length} field${rows.length === 1 ? '' : 's'} as field=value lines`), () => flash('The clipboard said no'));
}

// ---- Saved field lists (§132) ----

/** f's picker: a saved list fills the Fields box. */
export function pickList(name: string): void {
  const l = get().verifyLists?.lists.find((x) => x.name === name);
  if (!l) { put({ list: '' }); return; }
  put({ list: l.name, fields: l.ids.join('\n'), listDeleteArmed: 0 });
  flash(`${l.name}: ${l.ids.length} field${l.ids.length === 1 ? '' : 's'}`);
}

/** Shift+S: a box for the list's name opens (the chosen list's name, to save over it). */
export function startSaveList(): void {
  const s = useVerify.getState();
  if (!splitFieldLines(s.fields).length) { flash('Put field ids in the Fields box first (i)'); return; }
  put({ listName: s.list || '' });
}

export async function saveList(): Promise<void> {
  const s = useVerify.getState();
  const name = (s.listName ?? '').trim();
  if (!name) { flash('Name the list'); return; }
  const ids = splitFieldLines(s.fields);
  try {
    await verifyListSave(name, ids);
    put({ listName: null, list: name.slice(0, 60) });
    flash(`Saved ${ids.length} field${ids.length === 1 ? '' : 's'} as “${name}”`);
  } catch (e) {
    flash((e as Error).message);
  }
}

/** Shift+F twice: delete the chosen list (the Fields box keeps its ids). */
export async function deleteList(now = Date.now()): Promise<void> {
  const s = useVerify.getState();
  if (!s.list) { flash('Choose a list first (f)'); return; }
  if (now - s.listDeleteArmed >= PROD_CONFIRM_MS) { put({ listDeleteArmed: now }); flash(`Shift+F again to delete the list “${s.list}”`); return; }
  try {
    await verifyListDelete(s.list);
    flash(`Deleted the list “${s.list}”`);
    put({ list: '', listDeleteArmed: 0 });
  } catch (e) {
    flash((e as Error).message);
  }
}

/** The same, to start a sentence with. */
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A tool's name, as this machine's Verify file gives it, or a plain description (lower case, for mid-sentence). */
export function toolName(which: 'set' | 'lookup' | 'builder'): string {
  return cfg()[which]?.name ?? (which === 'set' ? 'the field set' : which === 'lookup' ? 'the record lookup' : 'the test-data tool');
}

/** The page o, O or L opens, for the environment chosen; undefined with why not. */
export function pageUrl(which: 'set' | 'add' | 'lookup' | 'builder', env = useVerify.getState().env): { url?: string; why?: string } {
  const c = cfg();
  // The lookup's own page (§132): `page`, else where its form posts.
  if (which === 'lookup') { const u = c.lookup?.page ?? c.lookup?.url; return u ? { url: u } : { why: `${cap(toolName('lookup'))} has no address in this machine’s Verify file` }; }
  if (which === 'builder') return c.builder?.ui ? { url: c.builder.ui } : { why: `${cap(toolName('builder'))} has no "ui" address in this machine’s Verify file` };
  const base = setUrl(c, env);
  if (!base) return { why: `${cap(toolName('set'))} has no ${ENV_NAME[env]} address in this machine’s Verify file` };
  if (which === 'set') return { url: base };
  return c.set?.addPage ? { url: `${base}/${c.set.addPage}` } : { why: `${cap(toolName('set'))}’s add-to-set page isn’t in this machine’s Verify file` };
}

/** o, O, L: the tool's own page in the browser. The add-to-set page is only opened: nothing is submitted from here. */
export function openPage(which: 'set' | 'add' | 'lookup' | 'builder'): void {
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
