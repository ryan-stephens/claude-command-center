// The stack editor's table (PLAN §54, milestone 3's confirmation): one row per part of the stack
// (what t asks, the template every API runs, each API, the UI) with what matters at a glance:
// the port, the command or values, the proxy rule, and which files it was read from. Pure: rows
// from a stack (and the detector's findings), the fields a row can change, and the stack with a
// field changed, so the component only draws and the tests cover the logic.

import { needsUiPort, type Stack, type StackApi } from '../shared/stack.ts';
import type { Finding } from '../shared/stack-detect.ts';

/** One row of the table. `id`: choose, template, api:<repo> or ui. */
export interface TableRow {
  id: string;
  repo: string;
  role: 'Asked each time' | 'Every API' | 'API' | 'UI';
  port: string;
  /** The API's values, the template's steps, the UI's steps, or the choices: shown as lines. */
  lines: string[];
  rule: string;
  /** The files it was read from (the detector's findings for the repo), and what was assumed. */
  from: string[];
  asked: string[];
  /** What the repos say now, when that differs from the saved stack. */
  drift?: string;
}

/** A value a row can change: its key in the stack, a label, the value as text. */
export interface Field {
  key: string;
  label: string;
  value: string;
  multiline?: boolean;
  hint?: string;
}

const ROUTE = /\{\{\s*route\s*\}\}/g;
const basename = (p: string) => p.split('/').pop() ?? p;
const appPortOf = (a: StackApi) => a.values.appPort ?? a.values.port;

/** The API's proxy rule as it will be used: its own, else the template's with {{route}} filled. */
export function ruleOf(stack: Stack, api: StackApi): string {
  const own = Object.keys(api.proxy ?? {});
  if (own.length) return own.join(', ');
  const keys = Object.keys(stack.api.proxy ?? {});
  if (!keys.length) return '';
  return keys.map((k) => k.replace(ROUTE, api.values.route ?? '{{route}}')).join(', ');
}

/** The port the UI starts on: picked per run when its steps or url say {{uiPort}}, else a --port in its steps. */
function uiPortOf(ui: NonNullable<Stack['ui']>): string {
  if (needsUiPort({ ui })) return 'picked per run';
  const m = /--port[= ](\d+)/.exec(ui.steps.join('\n'));
  return m ? `${m[1]} (fixed)` : '';
}

/** What the detector says about a repo: the files it read, and what it had to assume. */
function readFrom(findings: Finding[], repo: string): { from: string[]; asked: string[] } {
  const mine = findings.filter((f) => f.repo.toLowerCase() === repo.toLowerCase());
  return {
    from: [...new Set(mine.filter((f) => f.from && !f.asked).map((f) => basename(f.from!)))],
    asked: mine.filter((f) => f.asked).map((f) => f.text),
  };
}

/** What the repos say now that the saved stack doesn't: per API its values, for the UI its last step and proxy file. */
function driftOf(saved: Stack, detected: Stack | undefined, id: string): string | undefined {
  if (!detected) return undefined;
  if (id === 'ui') {
    if (!saved.ui || !detected.ui) return undefined;
    const out: string[] = [];
    if (saved.ui.steps.at(-1) !== detected.ui.steps.at(-1)) out.push(`serves with ${detected.ui.steps.at(-1)}`);
    if ((saved.ui.proxyFile ?? '') !== (detected.ui.proxyFile ?? '')) out.push(`proxy file ${detected.ui.proxyFile ?? 'none'}`);
    return out.length ? out.join(' · ') : undefined;
  }
  if (!id.startsWith('api:')) return undefined;
  const repo = id.slice(4);
  const a = saved.apis.find((x) => x.repo.toLowerCase() === repo.toLowerCase());
  const d = detected.apis.find((x) => x.repo.toLowerCase() === repo.toLowerCase());
  if (!a || !d) return undefined;
  const out: string[] = [];
  for (const k of ['name', 'appPort', 'dir', 'health'] as const) {
    const have = k === 'appPort' ? appPortOf(a) : a.values[k];
    if (d.values[k] !== undefined && have !== undefined && d.values[k] !== have) out.push(`${k} ${d.values[k]}`);
  }
  return out.length ? out.join(', ') : undefined;
}

/**
 * The table's rows, in the stack's order: what t asks, the template, each API, then the UI.
 * `findings` fill the "read from" column; `detected` (the repos read again) marks drift from the
 * saved stack.
 */
export function stackRows(stack: Stack, findings: Finding[] = [], detected?: Stack): TableRow[] {
  const rows: TableRow[] = [];
  const stackLevel = findings.filter((f) => !f.repo);
  rows.push({ id: 'choose', repo: '', role: 'Asked each time', port: '', lines: Object.entries(stack.choose).map(([k, v]) => `${k}: ${v.join(', ')}`), rule: '', from: [], asked: stackLevel.filter((f) => /environments/.test(f.text)).map((f) => f.text) });
  rows.push({ id: 'template', repo: '', role: 'Every API', port: '{{appPort}} → {{port}}', lines: stack.api.steps, rule: Object.keys(stack.api.proxy ?? {}).join(', '), from: [], asked: stackLevel.filter((f) => !/environments/.test(f.text)).map((f) => f.text) });
  for (const a of stack.apis) {
    const { from, asked } = readFrom(findings, a.repo);
    const drift = driftOf(stack, detected, `api:${a.repo}`);
    rows.push({
      id: `api:${a.repo}`, repo: a.repo, role: 'API', port: appPortOf(a) ?? '8080 (assumed)',
      lines: Object.entries(a.values).filter(([k]) => k !== 'appPort' && k !== 'port').map(([k, v]) => `${k}: ${v}`),
      rule: ruleOf(stack, a), from, asked, ...(drift ? { drift } : {}),
    });
  }
  if (stack.ui) {
    const { from, asked } = readFrom(findings, stack.ui.repo);
    const drift = driftOf(stack, detected, 'ui');
    rows.push({
      id: 'ui', repo: stack.ui.repo, role: 'UI', port: uiPortOf(stack.ui), lines: stack.ui.steps,
      rule: stack.ui.proxyFile ? `${stack.ui.proxyFile}${stack.ui.proxyMode === 'edit' ? ' (changed in place)' : ''}` : 'no proxy file',
      from, asked, ...(drift ? { drift } : {}),
    });
  }
  return rows;
}

const json = (v: unknown) => (v === undefined ? '' : JSON.stringify(v, null, 2));

/** The values a row can change, with the key `withField` takes back. */
export function fieldsOf(stack: Stack, id: string): Field[] {
  if (id === 'choose') return Object.entries(stack.choose).map(([k, v]) => ({ key: `choose.${k}`, label: `${k} (the default first)`, value: v.join(', '), hint: 'comma-separated' }));
  if (id === 'template') {
    return [
      { key: 'api.steps', label: 'Steps for each API, one per line', value: stack.api.steps.join('\n'), multiline: true, hint: '{{port}}, {{appPort}}, {{env}}, {{branch}}, {{deployment}} and the API’s values fill in; stop: lines run on stop' },
      { key: 'api.proxy', label: 'Proxy rule for each API (JSON; {{route}} and {{port}} fill in)', value: json(stack.api.proxy), multiline: true },
    ];
  }
  if (id === 'ui') {
    if (!stack.ui) return [];
    return [
      { key: 'ui.repo', label: 'Repo (folder name)', value: stack.ui.repo },
      { key: 'ui.steps', label: 'Steps, one per line', value: stack.ui.steps.join('\n'), multiline: true, hint: '{{proxy}} is the proxy copy, {{uiPort}} the port picked for the run' },
      { key: 'ui.proxyFile', label: 'Proxy file, inside the repo (empty: none)', value: stack.ui.proxyFile ?? '' },
      { key: 'ui.proxyMode', label: 'override (a copy) or edit (the file itself, put back on stop)', value: stack.ui.proxyMode ?? 'override' },
      { key: 'ui.url', label: 'Where it serves', value: stack.ui.url ?? '', hint: 'http://localhost:{{uiPort}}' },
    ];
  }
  if (id.startsWith('api:')) {
    const a = stack.apis.find((x) => x.repo === id.slice(4));
    if (!a) return [];
    const keys = [...new Set(['name', 'appPort', 'dir', 'health', 'route', ...Object.keys(a.values).filter((k) => k !== 'port')])];
    const labels: Record<string, string> = { name: 'name (its dev name on Okteto)', appPort: 'appPort (the port it listens on in its container)', dir: 'dir (its project folder)', health: 'health (the path that answers when it is ready)', route: 'route (its part of the proxy rule)' };
    return [
      ...keys.map((k) => ({ key: `values.${k}`, label: labels[k] ?? k, value: k === 'appPort' ? appPortOf(a) ?? '' : a.values[k] ?? '' })),
      { key: 'proxy', label: 'Its own proxy rule (JSON; empty: the template’s)', value: json(a.proxy), multiline: true },
    ];
  }
  return [];
}

const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const rulesFrom = (s: string, what: string): Record<string, unknown> | undefined => {
  if (!s.trim()) return undefined;
  let v: unknown;
  try { v = JSON.parse(s); } catch (e) { throw new Error(`${what} isn’t valid JSON: ${(e as Error).message}`); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what} should be an object of rules, like { "/api/{{route}}/**": { "target": "http://localhost:{{port}}" } }.`);
  return v as Record<string, unknown>;
};

/** The stack with one field of a row changed. Throws when the value can't be taken (bad JSON for a rule). */
export function withField(stack: Stack, id: string, key: string, value: string): Stack {
  const v = value.trim();
  if (id === 'choose' && key.startsWith('choose.')) {
    const k = key.slice(7);
    const vals = v.split(',').map((x) => x.trim()).filter(Boolean);
    if (!vals.length) throw new Error(`${k} needs at least one value to pick from.`);
    return { ...stack, choose: { ...stack.choose, [k]: vals } };
  }
  if (id === 'template') {
    if (key === 'api.steps') return { ...stack, api: { ...stack.api, steps: lines(value) } };
    if (key === 'api.proxy') { const proxy = rulesFrom(value, 'The proxy rule'); const { proxy: _p, ...rest } = stack.api; return { ...stack, api: proxy ? { ...rest, proxy } : rest }; }
  }
  if (id === 'ui' && stack.ui) {
    const ui = { ...stack.ui };
    if (key === 'ui.repo') ui.repo = v;
    else if (key === 'ui.steps') ui.steps = lines(value);
    else if (key === 'ui.proxyFile') { if (v) ui.proxyFile = v; else { delete ui.proxyFile; delete ui.proxyMode; } }
    else if (key === 'ui.proxyMode') ui.proxyMode = v === 'edit' ? 'edit' : 'override';
    else if (key === 'ui.url') { if (v) ui.url = v; else delete ui.url; }
    return { ...stack, ui };
  }
  if (id.startsWith('api:')) {
    const repo = id.slice(4);
    return {
      ...stack,
      apis: stack.apis.map((a) => {
        if (a.repo !== repo) return a;
        if (key === 'proxy') { const proxy = rulesFrom(value, `${repo}’s proxy rule`); const { proxy: _p, ...rest } = a; return proxy ? { ...rest, proxy } : rest; }
        if (key.startsWith('values.')) {
          const k = key.slice(7);
          const values = { ...a.values };
          if (v) values[k] = v; else delete values[k];
          // appPort replaces the old port value.
          if (k === 'appPort') delete values.port;
          return { ...a, values };
        }
        return a;
      }),
    };
  }
  return stack;
}

/** The stack without one API (a repo that isn't part of it). */
export function withoutApi(stack: Stack, repo: string): Stack {
  return { ...stack, apis: stack.apis.filter((a) => a.repo !== repo) };
}
