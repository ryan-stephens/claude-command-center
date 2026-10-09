// Updates through the record lookup (PLAN §134): Dev and UAT only, off unless this machine's Verify
// file says `"allowUpdate": true`, staged and confirmed on the page, checked afterwards by fetching
// again. The answer page has three forms that repeat the record's hidden values (a role assignment,
// a move, and the update form around the results table); only the update form, the one whose
// action is `lookup.updateUrl`, is ever read for sending, and only that address is ever posted to.
//
// What a fetch keeps for an update is a short-lived session, in memory only: the update form's
// controls in page order (its hidden inputs as they are, and where each row's update box and
// checkbox sit), which rows can be changed, and their options. At most five, ten minutes each,
// dropped when sent or when the same record is fetched again; never written down, never logged.

import { randomBytes } from 'node:crypto';
import { DEFAULT_ENV_VALUES, cleanUrl, type FieldChange, type VerifyConfig, type VerifyEnv } from '../shared/verify.ts';
import { attrs, decodeEntities, htmlText } from './verify.ts';

/** One control of the update form, in page order. */
export type FormPart =
  | { kind: 'hidden'; name: string; value: string }
  /** A row's update box (a text box or a select): sent only when that row is changed. */
  | { kind: 'value'; id: string }
  /** A row's "update this field" checkbox: sent ("true") only when that row is changed. */
  | { kind: 'check'; id: string };

export interface UpdateForm {
  parts: FormPart[];
  /** Rows that can be changed: a checkbox with its hidden "false" twin. */
  editable: string[];
  /** A field's allowed values, the empty "clear" one included, from its select or its hidden Options. */
  options: Record<string, string[]>;
  /** The form's Environment value. */
  envValue?: string;
  /** Why it can't be used, when it can't (a control this app doesn't send). */
  problem?: string;
}

const UPDATE_NAME = /^FieldsToUpdate\[([^\]]+)\]\.(Value|ShouldUpdate)$/;

/** The names an update may carry: the form's plain fields Verify knows of, and the bracketed shapes. */
export function updateNameAllowed(name: string, cfg: VerifyConfig): boolean {
  const plain = ['Environment', 'FieldsToFetch', cfg.lookup?.recordField, ...(cfg.lookup?.updateFields ?? [])].filter(Boolean);
  if (plain.includes(name)) return true;
  return /^AssignedRoles\[[^\]]+\]\.(Id|Name)$/.test(name)
    || /^Fields\[[^\]]+\]\.(Value|Exists|ReadOnly)$/.test(name)
    || /^Fields\[[^\]]+\]\.Options\[\d+\]$/.test(name)
    || UPDATE_NAME.test(name);
}

/** A value as a form sends it: line breaks as CRLF. */
const crlf = (v: string): string => v.replace(/\r\n|\r|\n/g, '\r\n');

/**
 * The update form on the answer page: the form whose action, resolved against the lookup's address,
 * has the same path as `updateUrl`. Undefined when the page has none. The role and move forms are
 * other actions and are never read.
 */
export function parseUpdateForm(html: string, cfg: VerifyConfig): UpdateForm | undefined {
  const base = cleanUrl(cfg.lookup?.url);
  const target = cleanUrl(cfg.lookup?.updateUrl);
  if (!base || !target) return undefined;
  const want = new URL(target).pathname.replace(/\/+$/, '').toLowerCase();
  for (const m of html.matchAll(/<form\b[^>]*>/gi)) {
    const action = attrs(m[0], true).action;
    if (action === undefined) continue;
    let path: string;
    try { path = new URL(action, base).pathname.replace(/\/+$/, '').toLowerCase(); } catch { continue; }
    if (path !== want) continue;
    const from = m.index! + m[0].length;
    const end = html.indexOf('</form>', from);
    return readForm(html.slice(from, end < 0 ? undefined : end), cfg);
  }
  return undefined;
}

function readForm(body: string, cfg: VerifyConfig): UpdateForm {
  const parts: FormPart[] = [];
  const options: Record<string, string[]> = {};
  const checks = new Set<string>();
  const twins = new Set<string>();
  let problem: string | undefined;
  let envValue: string | undefined;
  const hiddenOptions: Record<string, [number, string][]> = {};
  for (const m of body.matchAll(/<input\b[^>]*>|<select\b[^>]*>[\s\S]*?<\/select>|<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi)) {
    const tag = m[0];
    const open = tag.slice(0, tag.indexOf('>') + 1);
    const a = attrs(open, true);
    const name = a.name;
    if (!name) continue;
    const type = (a.type ?? (/^<select/i.test(tag) ? 'select' : /^<textarea/i.test(tag) ? 'textarea' : 'text')).toLowerCase();
    if (['submit', 'button', 'reset', 'image'].includes(type)) continue;
    const upd = UPDATE_NAME.exec(name);
    if (type === 'hidden') {
      const value = crlf(a.value ?? '');
      parts.push({ kind: 'hidden', name, value });
      if (name === 'Environment') envValue = value;
      if (upd && upd[2] === 'ShouldUpdate') twins.add(upd[1]);
      const o = /^Fields\[([^\]]+)\]\.Options\[(\d+)\]$/.exec(name);
      if (o) (hiddenOptions[o[1]] ??= []).push([Number(o[2]), value]);
      if (!updateNameAllowed(name, cfg)) problem ??= `The update form has a field Verify doesn’t send: ${name}. If it is the record’s own (its number or folder, say), add it to "updateFields" for the lookup in the Verify file.`;
      continue;
    }
    if (upd && upd[2] === 'ShouldUpdate' && type === 'checkbox') { parts.push({ kind: 'check', id: upd[1] }); checks.add(upd[1]); continue; }
    if (upd && upd[2] === 'Value') {
      parts.push({ kind: 'value', id: upd[1] });
      if (type === 'select') options[upd[1]] = [...tag.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((o) => { const v = attrs(`<option ${o[1]}>`, true).value; return crlf(v ?? htmlText(o[2])); });
      continue;
    }
    // Any other control the browser would send is one this app doesn't know: don't send a form that leaves it out.
    problem ??= `The update form has a field Verify doesn’t send: ${name}.`;
  }
  for (const [id, list] of Object.entries(hiddenOptions)) options[id] ??= list.sort((x, y) => x[0] - y[0]).map(([, v]) => v);
  return { parts, editable: [...checks].filter((id) => twins.has(id)), options, ...(envValue !== undefined ? { envValue } : {}), ...(problem ? { problem } : {}) };
}

// ---- Sessions ----

export interface UpdateSession {
  env: VerifyEnv;
  recordId: string;
  form: UpdateForm;
  at: number;
}

export const SESSION_TTL_MS = 10 * 60_000;
export const MAX_SESSIONS = 5;

/** The fetches an update may come from: in memory only, a few minutes, one use. */
export class UpdateSessions {
  private map = new Map<string, UpdateSession>();
  private now: () => number;

  constructor(now: () => number = Date.now) { this.now = now; }

  /** Keep a fetch's form; the same record fetched again replaces the old one. Returns the token. */
  add(s: Omit<UpdateSession, 'at'>): string {
    this.sweep();
    for (const [k, v] of this.map) if (v.env === s.env && v.recordId.toLowerCase() === s.recordId.toLowerCase()) this.map.delete(k);
    while (this.map.size >= MAX_SESSIONS) this.map.delete(this.map.keys().next().value!);
    const token = randomBytes(18).toString('base64url');
    this.map.set(token, { ...s, at: this.now() });
    return token;
  }

  get(token: string): UpdateSession | undefined {
    this.sweep();
    return this.map.get(String(token ?? ''));
  }

  drop(token: string): void { this.map.delete(token); }

  get size(): number { this.sweep(); return this.map.size; }

  private sweep(): void {
    const now = this.now();
    for (const [k, v] of this.map) if (now - v.at >= SESSION_TTL_MS) this.map.delete(k);
  }
}

// ---- Composing an update ----

export const MAX_CHANGES = 50;

/** The dev and uat values of the form's Environment dropdown, as this machine's file names them. */
function writableEnvValues(cfg: VerifyConfig): Map<string, VerifyEnv> {
  const v = (e: 'dev' | 'uat') => (cfg.lookup?.envValues?.[e]?.trim() || DEFAULT_ENV_VALUES[e]).toLowerCase();
  return new Map([[v('dev'), 'dev'], [v('uat'), 'uat']]);
}

/**
 * The form an update sends, as the browser would: every control in page order; a changed row's
 * update box and its checkbox ("true") where they sit, then its hidden "false" twin and the row's
 * hidden values; an unchanged row only its hidden inputs. Throws, in plain words, on anything that
 * isn't allowed: Prod, a field that can't be changed, a value that isn't one of its options.
 */
export function composeUpdate(s: UpdateSession, changes: FieldChange[], cfg: VerifyConfig): [string, string][] {
  if (s.env !== 'dev' && s.env !== 'uat') throw new Error('Updates are for Dev and UAT only.');
  const envs = writableEnvValues(cfg);
  if (s.form.envValue === undefined || envs.get(s.form.envValue.toLowerCase()) !== s.env) throw new Error('The update form isn’t for Dev or UAT: nothing was sent.');
  if (s.form.problem) throw new Error(s.form.problem);
  if (!Array.isArray(changes) || !changes.length) throw new Error('Nothing is staged.');
  if (changes.length > MAX_CHANGES) throw new Error(`At most ${MAX_CHANGES} fields in one update.`);
  const byId = new Map<string, FieldChange>();
  const editable = new Set(s.form.editable);
  for (const c of changes) {
    const id = String(c?.id ?? '');
    const value = typeof c?.value === 'string' ? c.value : '';
    const clear = c?.clear === true;
    if (!editable.has(id)) throw new Error(`${id || 'That field'} can’t be changed here (read-only, missing, or not in this fetch).`);
    if (byId.has(id)) throw new Error(`${id} is staged twice.`);
    if (value === '' && !clear) throw new Error(`${id}: an empty value isn’t a change (clear it instead).`);
    if (clear && value !== '') throw new Error(`${id}: a clear has no value.`);
    const opts = s.form.options[id];
    if (opts && !opts.includes(value)) throw new Error(`${id}: that isn’t one of its options.`);
    byId.set(id, { id, value: crlf(value), clear });
  }
  const out: [string, string][] = [];
  for (const p of s.form.parts) {
    if (p.kind === 'hidden') out.push([p.name, p.value]);
    else if (p.kind === 'value' && byId.has(p.id)) out.push([`FieldsToUpdate[${p.id}].Value`, byId.get(p.id)!.value]);
    else if (p.kind === 'check' && byId.has(p.id)) out.push([`FieldsToUpdate[${p.id}].ShouldUpdate`, 'true']);
  }
  return out;
}

// ---- Reading the answer ----

/**
 * The page an update answers with: success only when it has a SuccessMessage paragraph whose count
 * equals what was sent. Nothing else of the page is kept or passed on: the count, and the progress
 * page's link when it is on the lookup's host and ends in the record's id.
 */
export function readUpdateAnswer(html: string, sent: number, cfg: VerifyConfig, recordId: string): { sent: number; watchUrl?: string } {
  const fail = (): never => { throw new Error('The tool didn’t confirm the update.'); };
  const p = /<p\b[^>]*\bid\s*=\s*["']?SuccessMessage["'\s>][^>]*>([\s\S]*?)<\/p>/i.exec(html) ?? /<p\b[^>]*\bid\s*=\s*["']?SuccessMessage["']?>([\s\S]*?)<\/p>/i.exec(html);
  if (!p) return fail();
  const text = htmlText(p[1]);
  const n = /(\d+)\s+field\(?s?\)?\s+to\s+update/i.exec(text) ?? /(\d+)\s+fields?\b/i.exec(text);
  if (!n || Number(n[1]) !== sent) return fail();
  const out: { sent: number; watchUrl?: string } = { sent };
  const info = /<(div|p|span|section)\b[^>]*\bid\s*=\s*["']?InfoMessage["'\s>][\s\S]*?<\/\1>/i.exec(html);
  const href = info ? /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(info[0]) : null;
  const base = cleanUrl(cfg.lookup?.url);
  if (href && base) {
    try {
      const u = new URL(decodeEntities(href[2] ?? href[3] ?? ''), base);
      const last = decodeURIComponent(u.pathname.replace(/\/+$/, '').split('/').pop() ?? '');
      const bare = (x: string) => x.replace(/^\{|\}$/g, '').toLowerCase();
      if (u.origin === new URL(base).origin && /^https?:$/.test(u.protocol) && bare(last) === bare(recordId)) out.watchUrl = u.href;
    } catch { /* no link */ }
  }
  return out;
}
