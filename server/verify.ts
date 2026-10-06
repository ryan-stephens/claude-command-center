// Verify (PLAN §105): the clients for the team's two tools, read-only.
//
// - The set tool (a host per environment, JSON wrapped in { Successful, Payload }):
//   GET <base>/Home/ValidateField?<idParam>=<id> and GET <base>/Home/SetVersion (2 to 2.5 MB, cached).
// - The record lookup (an MVC form, one host for every environment): one POST of the form, read
//   from the table#FieldResults in the page it answers with.
//
// Every request goes through `guard`, which lets exactly those three through and throws on anything
// else: the add-to-set page's Save, the lookup's update boxes or any other address are never
// reached from here. Redirects aren't followed (a followed POST becomes a GET elsewhere).
//
// Values a lookup returns are a record's data: never logged, never kept here.
//
// Where the tools are, and what they're called, is a file on each machine (§107), never the repo:
// ~/.cc-control/verify.json, or the file CC_CONTROL_VERIFY_FILE names. Read again when it changes.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_ENV_VALUES, DEFAULT_ID_PARAM, MAX_IDS, cleanUrl, cleanVerify, setUrl, type VerifyFile,
  type FieldCheck, type LookupField, type LookupResult, type SetInfo, type VerifyConfig, type VerifyEnv,
} from '../shared/verify.ts';

// ---- The machine's file -----------------------------------------------------

export const VERIFY_FILE = process.env.CC_CONTROL_VERIFY_FILE || join(homedir(), '.cc-control', 'verify.json');

/** The file read and cleaned (`cleanVerify`): what it says, or why it says nothing. Never throws. */
export function readVerifyFile(file = VERIFY_FILE): VerifyFile {
  if (!existsSync(file)) return { file, config: {} };
  try {
    const text = readFileSync(file, 'utf8');
    if (text.includes('\u0000')) return { file, config: {}, problem: `${file} is saved as UTF-16; save it as UTF-8.` };
    return { file, config: cleanVerify(JSON.parse(text.replace(/^\uFEFF/, ''))) ?? {} };
  } catch (e) {
    return { file, config: {}, problem: `${file} isn’t JSON: ${(e as Error).message.slice(0, 200)}` };
  }
}

/** The file, read again only when it changed (its size and time). */
export class VerifyFileWatch {
  private file: string;
  private seen: string;
  private last: VerifyFile;

  constructor(file = VERIFY_FILE) {
    this.file = file;
    this.seen = this.stamp();
    this.last = readVerifyFile(file);
  }

  private stamp(): string {
    try { const s = statSync(this.file); return `${s.size}:${s.mtimeMs}`; } catch { return 'none'; }
  }

  /** What the file says now; `changed` when it was read again since the last call. */
  now(): VerifyFile & { changed: boolean } {
    const stamp = this.stamp();
    if (stamp === this.seen) return { ...this.last, changed: false };
    this.seen = stamp;
    this.last = readVerifyFile(this.file);
    return { ...this.last, changed: true };
  }
}

// ---- Requests ---------------------------------------------------------------

export interface VerifyRequest {
  method: 'GET' | 'POST';
  url: string;
  /** A POST's form, url-encoded by the transport. */
  form?: [string, string][];
}

export interface VerifyResponse {
  status: number;
  body: string;
  /** WWW-Authenticate, when it asked for a sign-in. */
  auth?: string;
}

/** How a request goes out: Node's fetch, or PowerShell signed in as you (Windows). */
export type Transport = (req: VerifyRequest, signal: AbortSignal) => Promise<VerifyResponse>;

/** The form fields the lookup may be sent; nothing else (its update boxes are other fields). */
export function lookupFields(cfg: VerifyConfig): string[] {
  return ['Environment', cfg.lookup?.recordField?.trim() ?? '', 'AdvancedFetch', 'FieldsToFetch'].filter(Boolean);
}

/**
 * The only requests Verify makes. Throws on anything else: a write (the set tool's Save, the
 * lookup's update fields), another path, another host, another method.
 */
export function guard(req: VerifyRequest, cfg: VerifyConfig): void {
  const refuse = (why: string): never => { throw new Error(`Verify refused a request: ${why}.`); };
  let u: URL;
  try { u = new URL(req.url); } catch { return refuse('not an address'); }
  if (req.method === 'GET') {
    if (req.form) refuse('a GET with a form');
    const base = [...Object.values(cfg.set?.urls ?? {})].map((x) => cleanUrl(x)).find((b) => b && (req.url.startsWith(`${b}/Home/SetVersion`) || req.url.startsWith(`${b}/Home/ValidateField`)));
    if (!base) refuse('only the set tool’s SetVersion and ValidateField are read');
    const path = u.pathname.replace(/\/+$/, '');
    if (!/\/Home\/(SetVersion|ValidateField)$/.test(path)) refuse('only SetVersion and ValidateField');
    return;
  }
  if (req.method === 'POST') {
    const at = cleanUrl(cfg.lookup?.url);
    if (!at || req.url !== at) refuse('a POST goes only to the record lookup’s form');
    const allowed = new Set(lookupFields(cfg));
    for (const [k] of req.form ?? []) if (!allowed.has(k)) refuse(`the form field ${k} isn’t one a lookup sends`);
    return;
  }
  refuse(`the method ${String(req.method)}`);
}

const TIMEOUT_MS = 30_000;

/** Node's fetch, no redirects followed. */
export const fetchTransport: Transport = async (req, signal) => {
  const res = await fetch(req.url, {
    method: req.method,
    redirect: 'manual',
    signal,
    headers: { Accept: req.method === 'GET' ? 'application/json' : 'text/html', ...(req.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(req.form ? { body: new URLSearchParams(req.form).toString() } : {}),
  });
  return { status: res.status, body: await res.text(), ...(res.headers.get('www-authenticate') ? { auth: res.headers.get('www-authenticate')! } : {}) };
};

/**
 * PowerShell's Invoke-WebRequest signed in as you (-UseDefaultCredentials): Node's fetch can't do
 * Windows sign-in. The request goes in on stdin as JSON, the answer comes back on stdout; nothing
 * is written anywhere. Windows' own certificate store applies.
 */
export const windowsTransport: Transport = (req, signal) => new Promise((resolve, reject) => {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '$r = [Console]::In.ReadToEnd() | ConvertFrom-Json',
    '$p = @{ Uri = $r.url; Method = $r.method; UseDefaultCredentials = $true; UseBasicParsing = $true; MaximumRedirection = 0 }',
    'if ($r.body) { $p.Body = $r.body; $p.ContentType = "application/x-www-form-urlencoded" }',
    'try { $res = Invoke-WebRequest @p; $o = @{ status = [int]$res.StatusCode; body = [string]$res.Content } }',
    'catch { $x = $_.Exception.Response; if ($x) { $o = @{ status = [int]$x.StatusCode; body = "" } } else { $o = @{ status = 0; body = ""; error = $_.Exception.Message } } }',
    '[Console]::Out.Write(($o | ConvertTo-Json -Compress))',
  ].join('\n');
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, signal });
  let out = '';
  ps.stdout.setEncoding('utf8').on('data', (d: string) => { out += d; });
  ps.on('error', reject);
  ps.on('close', () => {
    try {
      const o = JSON.parse(out) as { status: number; body: string; error?: string };
      if (o.error) reject(new Error(o.error)); else resolve({ status: o.status, body: o.body ?? '' });
    } catch { reject(new Error('PowerShell gave no answer')); }
  });
  ps.stdin.end(JSON.stringify({ url: req.url, method: req.method, ...(req.form ? { body: new URLSearchParams(req.form).toString() } : {}) }));
});

/** A failed request, said for a person: certificates, sign-in, unreachable. Never includes a body. */
export function explain(e: unknown, what: string): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  const code = err.cause?.code ?? '';
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/i.test(code + (err.cause?.message ?? ''))) {
    return `${what}: its certificate isn’t trusted here (${code}). cc-control trusts the certificates Windows trusts; check CC_CONTROL_SYSTEM_CA isn’t 0, or set CC_CONTROL_CA_FILE to the company’s root certificate (PEM), and restart.`;
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET/.test(code)) return `${what}: can’t be reached (${code}). On the VPN?`;
  if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') return `${what}: no answer in ${TIMEOUT_MS / 1000} s.`;
  return `${what}: ${err.message ?? String(e)}`;
}

/** Sends guarded requests: fetch first; on a Windows sign-in request (401), as you through PowerShell when the config allows. */
export class Requester {
  private cfg: () => VerifyConfig;
  private transports: { fetch: Transport; windows: Transport };
  private platform: NodeJS.Platform;

  constructor(cfg: () => VerifyConfig, transports: { fetch: Transport; windows: Transport } = { fetch: fetchTransport, windows: windowsTransport }, platform: NodeJS.Platform = process.platform) {
    this.cfg = cfg;
    this.transports = transports;
    this.platform = platform;
  }

  async send(req: VerifyRequest, auth: 'auto' | 'windows' | 'none' = 'none'): Promise<VerifyResponse> {
    const cfg = this.cfg();
    guard(req, cfg);
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    if (auth === 'windows') return this.transports.windows(req, signal);
    const res = await this.transports.fetch(req, signal);
    if (res.status === 401 && auth === 'auto' && this.platform === 'win32' && /negotiate|ntlm/i.test(res.auth ?? '')) {
      return this.transports.windows(req, AbortSignal.timeout(TIMEOUT_MS));
    }
    return res;
  }
}

// ---- The set tool -----------------------------------------------------------

interface Envelope { Successful?: unknown; Payload?: unknown }

/** The { Successful, Payload } wrapper: the payload, or an error with what the tool said. */
export function unwrap(body: string): { ok: true; payload: unknown } | { ok: false; message: string } {
  let j: Envelope;
  try { j = JSON.parse(body) as Envelope; } catch { return { ok: false, message: 'The set tool didn’t answer with JSON (a sign-in page?)' }; }
  if (j === null || typeof j !== 'object') return { ok: false, message: 'The set tool’s answer had no Successful' };
  if (j.Successful !== true) return { ok: false, message: typeof j.Payload === 'string' ? j.Payload.slice(0, 300) : 'The set tool said it didn’t work' };
  return { ok: true, payload: j.Payload };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : typeof v === 'string' ? /^true$/i.test(v) : undefined);
const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map((x) => (typeof x === 'object' && x !== null ? str((x as Record<string, unknown>).Value ?? (x as Record<string, unknown>).Text ?? (x as Record<string, unknown>).Name) ?? JSON.stringify(x) : String(x))) : undefined);

/** ValidateField's payload, read: the "is it in the set" flag is the one key starting ExistsIn. */
export function readValidate(id: string, payload: unknown): FieldCheck {
  const p = (payload ?? {}) as Record<string, unknown>;
  const inSetKey = Object.keys(p).find((k) => /^ExistsIn/i.test(k));
  const options = strs(p.Options);
  return {
    id, known: true,
    ...(bool(p.Exists) !== undefined ? { exists: bool(p.Exists) } : {}),
    ...(inSetKey && bool(p[inSetKey]) !== undefined ? { inSet: bool(p[inSetKey]) } : {}),
    ...(str(p.FieldName) ? { fieldName: str(p.FieldName) } : {}),
    ...(str(p.Format) ? { format: str(p.Format) } : {}),
    ...(options?.length ? { options } : {}),
    ...(str(p.Message) ? { message: str(p.Message)!.slice(0, 300) } : {}),
  };
}

/** A set version, as kept in the cache: its entries by field id (upper case). */
export interface SetVersion {
  info: SetInfo;
  byId: Map<string, { fieldName?: string; format?: string; options?: string[] }>;
}

const KNOWN_KEYS = new Set(['id', 'fieldname', 'ispii', 'rdbtype', 'rdbfieldsize', 'format', 'options']);

/** SetVersion's payload, read: the field id is `idKey`, or the one string key of an entry that isn't a known one. */
export function readSet(payload: unknown, idKey?: string, now = Date.now()): SetVersion {
  const p = (payload ?? {}) as Record<string, unknown>;
  const fields = Array.isArray(p.Fields) ? (p.Fields as Record<string, unknown>[]) : [];
  const key = idKey || Object.keys(fields[0] ?? {}).find((k) => !KNOWN_KEYS.has(k.toLowerCase()) && typeof fields[0][k] === 'string');
  const byId = new Map<string, { fieldName?: string; format?: string; options?: string[] }>();
  for (const f of fields) {
    const id = key ? str(f[key]) : undefined;
    if (!id) continue;
    byId.set(id.toUpperCase(), { ...(str(f.FieldName) ? { fieldName: str(f.FieldName) } : {}), ...(str(f.Format) ? { format: str(f.Format) } : {}), ...(strs(f.Options)?.length ? { options: strs(f.Options) } : {}) });
  }
  return { info: { ...(str(p.Number) !== undefined ? { number: str(p.Number) } : {}), ...(str(p.Description) ? { description: str(p.Description) } : {}), fields: byId.size, fetchedAt: now }, byId };
}

export const SET_TTL_MS = 10 * 60_000;

export class SetTool {
  private cache = new Map<VerifyEnv, SetVersion>();
  private loading = new Map<VerifyEnv, Promise<SetVersion>>();
  private cfg: () => VerifyConfig;
  private req: Requester;
  private now: () => number;

  constructor(cfg: () => VerifyConfig, req: Requester, now: () => number = Date.now) {
    this.cfg = cfg;
    this.req = req;
    this.now = now;
  }

  private base(env: VerifyEnv): string {
    const b = setUrl(this.cfg(), env);
    if (!b) throw new Error(`${this.cfg().set?.name ?? 'The set tool'} has no ${env} address in this machine’s Verify file.`);
    return b;
  }

  /** ValidateField for one id: an unknown id comes back known: false with what the tool said. */
  async validate(env: VerifyEnv, id: string): Promise<FieldCheck> {
    const param = this.cfg().set?.idParam?.trim() || DEFAULT_ID_PARAM;
    const res = await this.req.send({ method: 'GET', url: `${this.base(env)}/Home/ValidateField?${encodeURIComponent(param)}=${encodeURIComponent(id)}` });
    if (res.status >= 400 && !res.body.trim().startsWith('{')) throw new Error(`The set tool answered ${res.status}`);
    const r = unwrap(res.body);
    return r.ok ? readValidate(id, r.payload) : { id, known: false, message: r.message };
  }

  /** The current set (cached for SET_TTL_MS; `refresh` reads it again). One read at a time per environment. */
  async set(env: VerifyEnv, refresh = false): Promise<SetVersion> {
    const had = this.cache.get(env);
    if (had && !refresh && this.now() - had.info.fetchedAt < SET_TTL_MS) return had;
    const going = this.loading.get(env);
    if (going) return going;
    const p = (async () => {
      const res = await this.req.send({ method: 'GET', url: `${this.base(env)}/Home/SetVersion` });
      if (res.status >= 400) throw new Error(`The set tool answered ${res.status}`);
      const r = unwrap(res.body);
      if (!r.ok) throw new Error(r.message);
      const v = readSet(r.payload, this.cfg().set?.idKey?.trim() || undefined, this.now());
      this.cache.set(env, v);
      return v;
    })();
    this.loading.set(env, p);
    try { return await p; } finally { this.loading.delete(env); }
  }

  /** Which ids the current set has, from the cache (read first if needed). */
  async has(env: VerifyEnv, ids: string[]): Promise<{ id: string; inSet: boolean; fieldName?: string; format?: string; options?: string[] }[]> {
    const v = await this.set(env);
    return ids.slice(0, MAX_IDS).map((id) => ({ id, inSet: v.byId.has(id.toUpperCase()), ...v.byId.get(id.toUpperCase()) }));
  }

  /** Forget every cached set (the addresses changed). */
  clear(): void { this.cache.clear(); }
}

// ---- The record lookup ------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', '#39': '\'' };

/** HTML text to plain text: entities decoded, tags dropped, white space folded. */
export function htmlText(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
      if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** A tag's attributes, by lower-case name (values decoded). */
export function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.[\]-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = htmlText(m[3] ?? m[4] ?? m[5] ?? '');
  return out;
}

/**
 * The lookup's answer page, read: the rows of table#FieldResults (the header skipped). Each row's
 * hidden Fields[<id>].Value / .Exists / .ReadOnly win over its visible cells when they are there;
 * a salmon row, or "(Field does not exist)", is a field the record doesn't have. No table: no record.
 */
export function parseLookup(html: string): { found: boolean; fields: LookupField[] } {
  const start = html.search(/<table\b[^>]*\bid\s*=\s*["']?FieldResults["'\s>]/i);
  if (start < 0) return { found: false, fields: [] };
  const end = html.indexOf('</table>', start);
  const table = html.slice(start, end < 0 ? undefined : end);
  const fields: LookupField[] = [];
  for (const row of table.split(/<tr\b/i).slice(1)) {
    const open = row.slice(0, row.indexOf('>') + 1);
    if (/<th\b/i.test(row) && !/<td\b/i.test(row)) continue;
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 2) continue;
    const hidden: Record<string, string> = {};
    let hiddenId: string | undefined;
    for (const m of row.matchAll(/<input\b[^>]*>/gi)) {
      const a = attrs(m[0]);
      const n = /^Fields\[([^\]]+)\]\.(Value|Exists|ReadOnly)$/i.exec(a.name ?? '');
      if (!n) continue;
      hiddenId ??= n[1];
      hidden[n[2].toLowerCase()] = a.value ?? '';
    }
    const id = htmlText(cells[0]) || hiddenId || '';
    if (!id) continue;
    const shown = htmlText(cells[1]);
    const salmon = /background(-color)?\s*:\s*salmon/i.test(open) || /does not exist/i.test(shown);
    const exists = hidden.exists !== undefined ? /^true$/i.test(hidden.exists) : !salmon;
    fields.push({
      id,
      value: exists ? (hidden.value ?? shown) : '',
      exists,
      ...(hidden.readonly !== undefined ? { readOnly: /^true$/i.test(hidden.readonly) } : {}),
    });
  }
  return { found: true, fields };
}

export class LookupTool {
  private cfg: () => VerifyConfig;
  private req: Requester;

  constructor(cfg: () => VerifyConfig, req: Requester) {
    this.cfg = cfg;
    this.req = req;
  }

  /** Look a record up: the form posted once, the page read into fields. Values are never logged or kept. */
  async fetch(env: VerifyEnv, recordId: string, ids: string[], advanced = false): Promise<LookupResult> {
    const cfg = this.cfg();
    const url = cleanUrl(cfg.lookup?.url);
    const field = cfg.lookup?.recordField?.trim();
    if (!url) throw new Error('The record lookup has no address in this machine’s Verify file.');
    if (!field) throw new Error(`${cfg.lookup?.name ?? 'The record lookup'} needs "recordField" in this machine’s Verify file: the form’s name for the record id box.`);
    const rid = recordId.trim();
    if (!/^[\w.{}-]{1,80}$/.test(rid)) throw new Error('That record id doesn’t look like one.');
    const list = ids.slice(0, MAX_IDS);
    if (!list.length) throw new Error('Name a field or two to read.');
    const envValue = cfg.lookup?.envValues?.[env]?.trim() || DEFAULT_ENV_VALUES[env];
    const res = await this.req.send({
      method: 'POST', url,
      form: [['Environment', envValue], [field, rid], ['AdvancedFetch', advanced ? 'true' : 'false'], ['FieldsToFetch', list.join('\r\n')]],
    }, cfg.lookup?.auth ?? 'auto');
    if (res.status === 401) throw new Error(`${cfg.lookup?.name ?? 'The record lookup'} wants a sign-in: set "auth": "windows" for it in this machine’s Verify file.`);
    if (res.status >= 300 && res.status < 400) throw new Error(`The record lookup answered with a redirect (${res.status}): is its address the form’s?`);
    if (res.status >= 400) throw new Error(`The record lookup answered ${res.status}.`);
    return { env, recordId: rid, ...parseLookup(res.body) };
  }
}
