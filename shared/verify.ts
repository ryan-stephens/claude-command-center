// Verify (PLAN §105, §132): the team's tools, reached from a card's Verify panel, one sub-section
// each. The set tool says whether a field is in the current field set (and its format and options),
// per environment; the record lookup reads a record's current field values. Both are read-only from
// here: the set tool's add-to-set page and the lookup's update boxes write, and the app never calls
// them. The scenario runner (the "test data" tool, §133) runs on this machine and creates test loans.
//
// Where the tools are is a file per machine (§107); nothing real is in the repo. Lookup values are
// a record's data: they stay in the page's memory, never in a log, a card or a transcript.

export type VerifyEnv = 'dev' | 'uat' | 'prod';
export const VERIFY_ENVS: VerifyEnv[] = ['dev', 'uat', 'prod'];
export const ENV_NAME: Record<VerifyEnv, string> = { dev: 'Dev', uat: 'UAT', prod: 'Prod' };

/** Where the team's tools are on this machine. Every field optional: an empty one says how to fill it. */
export interface VerifyConfig {
  set?: {
    /** What the panel calls it. Unset: "Field set". */
    name?: string;
    /** Each environment's base URL (the tool is a separate host per environment). */
    urls?: Partial<Record<VerifyEnv, string>>;
    /** The add-to-set page, relative to the base URL: only ever opened in the browser. */
    addPage?: string;
    /** The query parameter ValidateField takes the field id in. Unset: DEFAULT_ID_PARAM. */
    idParam?: string;
    /** The key of a set entry that holds the field id. Unset: found (the one key that isn't a known one). */
    idKey?: string;
  };
  lookup?: {
    /** What the panel calls it. Unset: "Record lookup". */
    name?: string;
    /** The form's address, where it posts (one host serves every environment). */
    url?: string;
    /** The form field the record id goes in. */
    recordField?: string;
    /** What the form's Environment dropdown calls each environment. Unset: Dev, Uat, Prod. */
    envValues?: Partial<Record<VerifyEnv, string>>;
    /** How it signs in: auto (try without, then as you on Windows), windows (as you), none. Unset: auto. */
    auth?: VerifyAuth;
    /** Its page, where o and Shift+L open (the form's own page, not where it posts). Unset: `url`. */
    page?: string;
    /** The update form's address (§134), on the same host as `url`. */
    updateUrl?: string;
    /** Updates through the lookup, in Dev and UAT only: only the literal true counts. */
    allowUpdate?: boolean;
  };
  /** The scenario runner on this machine (§133): an API that creates test loans in Dev or UAT. */
  builder?: {
    /** What the panel calls it. Unset: "Test data". */
    name?: string;
    /** The API's base, on this machine only (localhost, 127.0.0.1 or [::1]). */
    url?: string;
    /** Its web UI, opened by o. */
    ui?: string;
    /** A short hint for starting it, shown when it isn't running. Never run. */
    start?: string;
  };
}

export type VerifyAuth = 'auto' | 'windows' | 'none';
export const VERIFY_AUTHS: VerifyAuth[] = ['auto', 'windows', 'none'];
export const DEFAULT_ID_PARAM = 'encompassId';
export const DEFAULT_ENV_VALUES: Record<VerifyEnv, string> = { dev: 'Dev', uat: 'Uat', prod: 'Prod' };

/** This machine's Verify file, as the server read it (§107). */
export interface VerifyFile {
  file: string;
  config: VerifyConfig;
  /** Why it couldn't be read (not JSON, UTF-16). A missing file isn't a problem: it says nothing yet. */
  problem?: string;
}

/** The set tool has hosts for dev and uat (prod when given); the lookup serves every environment from one host. */
export const SET_ENVS: VerifyEnv[] = ['dev', 'uat'];

/** One field id, as the set tool sees it in one environment. */
export interface FieldCheck {
  id: string;
  /** The tool knows the id at all (ValidateField answered Successful). */
  known: boolean;
  exists?: boolean;
  /** In the environment's current field set. */
  inSet?: boolean;
  fieldName?: string;
  format?: string;
  options?: string[];
  /** What the tool said, when it said something (an unknown id's reason). */
  message?: string;
}

/** The current set's version in one environment, as cached on the server. */
export interface SetInfo {
  number?: string | number;
  description?: string;
  fields: number;
  fetchedAt: number;
}

/** One environment's answer to a check: its rows, or why there are none. */
export interface EnvCheck {
  env: VerifyEnv;
  rows?: FieldCheck[];
  set?: SetInfo;
  /** Not reachable, not set up, or the set couldn't be read (the rows may still be there). */
  error?: string;
  setError?: string;
}

/** One field of a looked-up record. */
export interface LookupField {
  id: string;
  value: string;
  exists: boolean;
  readOnly?: boolean;
  /** The values it may take (Advanced only), in the tool's order, the empty "clear" choice left out. */
  options?: string[];
}

export interface LookupResult {
  env: VerifyEnv;
  recordId: string;
  found: boolean;
  fields: LookupField[];
}

/** At most this many ids in one check. */
export const MAX_IDS = 40;

/** At most this many ids in one lookup: the tool's own default list is about 290. */
export const LOOKUP_MAX_IDS = 400;

/**
 * Field ids for the record lookup: one per line, as they are (inner spaces kept: `Group.Name.Role
 * Name` is one id). A text with no line break is split on commas and semicolons instead. Duplicates
 * go case-insensitively (the first's case kept), and so does anything that can't be an id.
 */
export function splitFieldLines(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const parts = /\r?\n/.test(text) ? text.split(/\r?\n/) : text.split(/[,;]/);
  for (const raw of parts) {
    const id = raw.trim();
    if (!/^[A-Za-z0-9][\w .#-]{0,79}$/.test(id) || seen.has(id.toUpperCase())) continue;
    seen.add(id.toUpperCase());
    out.push(id);
    if (out.length === LOOKUP_MAX_IDS) break;
  }
  return out;
}

/** A saved list of field ids for the lookup (§132), from ~/.cc-control/field-lists.json. */
export interface FieldList { name: string; ids: string[] }

export interface FieldListsFile {
  file: string;
  lists: FieldList[];
  /** Why it couldn't be read. A missing file is no lists. */
  problem?: string;
}

export const MAX_LISTS = 50;
export const LIST_NAME_MAX = 60;

/** Untrusted lists: names trimmed and unique (case-insensitive), ids through splitFieldLines, at most MAX_LISTS. */
export function cleanLists(raw: unknown): FieldList[] {
  const out: FieldList[] = [];
  const seen = new Set<string>();
  for (const l of Array.isArray(raw) ? raw : []) {
    const name = typeof l?.name === 'string' ? l.name.trim().slice(0, LIST_NAME_MAX) : '';
    const ids = Array.isArray(l?.ids) ? splitFieldLines(l.ids.filter((x: unknown) => typeof x === 'string').join('\n')) : [];
    if (!name || !ids.length || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, ids });
    if (out.length === MAX_LISTS) break;
  }
  return out;
}

/** The scenario runner's environments (§133): never Prod. */
export type BuilderEnv = 'dev' | 'uat';
export const BUILDER_ENVS: BuilderEnv[] = ['dev', 'uat'];

/** A saved scenario, its latest version, as the scenario runner lists it. */
export interface BuilderScenario {
  id: string;
  version: number;
  name: string;
  tags: string[];
  locked: boolean;
}

export type BuilderStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

/** A run of a scenario, read tolerantly from the tool. Loan ids and step messages stay in the page's memory. */
export interface BuilderRun {
  runId: string;
  env: BuilderEnv;
  status: 'running' | 'succeeded' | 'failed';
  steps: { order: number; type: string; status: BuilderStepStatus; error?: string }[];
  /** The loans it made (the tool's loan guids). */
  recordIds: string[];
  error?: string;
}

/** localhost, 127.0.0.1 or [::1]: the scenario runner is only ever reached on this machine. */
export function isLoopback(url: string | undefined): boolean {
  if (!url) return false;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname.toLowerCase()); } catch { return false; }
}

/**
 * Field ids in text: pasted lists (one per line, or split by commas, spaces, semicolons) as they are.
 * Duplicates go (case kept from the first), and so does anything that can't be an id.
 */
export function splitIds(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\s,;]+/)) {
    const id = raw.replace(/^["'`(]+|["'`).:]+$/g, '');
    if (!/^[A-Za-z0-9][\w.#-]{0,63}$/.test(id) || seen.has(id.toUpperCase())) continue;
    seen.add(id.toUpperCase());
    out.push(id);
  }
  return out.slice(0, MAX_IDS);
}

/**
 * Field ids a ticket or a note mentions, to start the box with: dotted upper-case ids (CX.SAMPLE.ONE,
 * LE1.X2), and numbers or codes right after "field" or "fields" (field 1000, fields 1000 and 4002).
 * Not every number in a ticket: those are mostly not fields.
 */
export function idsInText(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]*(?:\.[A-Z0-9_]+)+\b/g)) {
    // A file name or a version is not a field: CardView.tsx, v1.2.
    if (/\.(TS|TSX|JS|CS|JSON|MD|HTML|CSS|YML|YAML|XML)$/i.test(m[0])) continue;
    found.push(m[0]);
  }
  for (const m of text.matchAll(/\bfields?\s*(?:id|ids)?\s*[:#]?\s*((?:[A-Za-z0-9][\w.]*)(?:\s*(?:,|and|&)\s*(?!fields?\b)[A-Za-z0-9][\w.]*)*)/gi)) {
    for (const id of m[1].split(/\s*(?:,|and|&)\s*/i)) if (/\d/.test(id)) found.push(id);
  }
  return splitIds(found.join('\n'));
}

/** Where two environments disagree about a field: known, exists or in the set. Undefined when they agree or one is missing. */
export function drift(a: FieldCheck | undefined, b: FieldCheck | undefined): string | undefined {
  if (!a || !b) return undefined;
  if (a.known !== b.known) return a.known ? 'unknown in the second' : 'unknown in the first';
  if (Boolean(a.exists) !== Boolean(b.exists)) return 'exists in one only';
  if (Boolean(a.inSet) !== Boolean(b.inSet)) return 'in the set in one only';
  return undefined;
}

/** The set tool's base URL for an environment, if this machine has one. */
export function setUrl(cfg: VerifyConfig | undefined, env: VerifyEnv): string | undefined {
  return cleanUrl(cfg?.set?.urls?.[env]);
}

/** An untrusted config from a page: known keys only, short strings, URLs that are http(s). */
export function cleanVerify(raw: unknown): VerifyConfig | undefined {
  const r = (raw ?? {}) as VerifyConfig;
  const s = (v: unknown, n = 300): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);
  const urls = (u: unknown): Partial<Record<VerifyEnv, string>> => Object.fromEntries(VERIFY_ENVS.flatMap((e) => { const v = cleanUrl(s((u as Record<string, unknown> | undefined)?.[e], 500)); return v ? [[e, v]] : []; }));
  const words = (u: unknown): Partial<Record<VerifyEnv, string>> => Object.fromEntries(VERIFY_ENVS.flatMap((e) => { const v = s((u as Record<string, unknown> | undefined)?.[e], 40); return v ? [[e, v]] : []; }));
  const set: NonNullable<VerifyConfig['set']> = {};
  const name = s(r.set?.name, 60); if (name) set.name = name;
  const su = urls(r.set?.urls); if (Object.keys(su).length) set.urls = su;
  const add = s(r.set?.addPage, 300); if (add) set.addPage = add.replace(/^\/*/, '');
  const param = s(r.set?.idParam, 60); if (param && /^[\w.-]+$/.test(param)) set.idParam = param;
  const key = s(r.set?.idKey, 60); if (key && /^[\w.-]+$/.test(key)) set.idKey = key;
  const lookup: NonNullable<VerifyConfig['lookup']> = {};
  const ln = s(r.lookup?.name, 60); if (ln) lookup.name = ln;
  const lu = cleanUrl(s(r.lookup?.url, 500)); if (lu) lookup.url = lu;
  const rf = s(r.lookup?.recordField, 60); if (rf && /^[\w.\[\]-]+$/.test(rf)) lookup.recordField = rf;
  const ev = words(r.lookup?.envValues); if (Object.keys(ev).length) lookup.envValues = ev;
  if (r.lookup?.auth && VERIFY_AUTHS.includes(r.lookup.auth)) lookup.auth = r.lookup.auth;
  const lp = cleanUrl(s(r.lookup?.page, 500)); if (lp) lookup.page = lp;
  // The update form must be on the lookup's own host: nothing else is ever written to.
  const uu = cleanUrl(s(r.lookup?.updateUrl, 500)); if (uu && lu && sameHost(uu, lu)) lookup.updateUrl = uu;
  if (r.lookup?.allowUpdate === true) lookup.allowUpdate = true;
  const builder: NonNullable<VerifyConfig['builder']> = {};
  const bn = s(r.builder?.name, 60); if (bn) builder.name = bn;
  const bu = cleanUrl(s(r.builder?.url, 500)); if (bu && isLoopback(bu)) builder.url = bu;
  const bi = cleanUrl(s(r.builder?.ui, 500)); if (bi) builder.ui = bi;
  const bs = s(r.builder?.start, 200); if (bs) builder.start = bs;
  const out: VerifyConfig = {};
  if (Object.keys(set).length) out.set = set;
  if (Object.keys(lookup).length) out.lookup = lookup;
  if (Object.keys(builder).length) out.builder = builder;
  return Object.keys(out).length ? out : undefined;
}

/** Two addresses on the same scheme, host and port. */
export function sameHost(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

/** An http(s) URL without a trailing slash, or undefined. */
export function cleanUrl(u: string | undefined): string | undefined {
  const t = u?.trim();
  if (!t || !/^https?:\/\/[^\s/]+/i.test(t)) return undefined;
  return t.replace(/\/+$/, '');
}
