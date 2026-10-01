// A workspace's stack: how Try it brings up the APIs a card needs on a dev environment, and the UI
// pointed at them. Which APIs run changes from card to card (and developer to developer), so the
// stack says how *an* API starts once, as a template, and lists the APIs with their own values.
// Pressing t picks the values to choose (dev or uat) and the APIs to run; the steps and the UI's
// proxy rules are built from what was picked. Nothing here knows about any one tool: Okteto,
// kubectl and the rest live in the steps a team writes. Pure and shared, so the page and the server
// build the same thing.

import { MAX_STEPS, parseStep } from './recipes.ts';

/** One API the stack can start. */
export interface StackApi {
  /** Its repo, by folder name (a card's repo, or its workspace's). */
  repo: string;
  /** Its values for the template: {{name}}, {{dir}}, {{port}} … */
  values: Record<string, string>;
  /** Proxy rules of its own, on top of the template's (a route only this API has). */
  proxy?: Record<string, unknown>;
}

export interface Stack {
  /** What t asks each time, the first value being the default: { "env": ["dev", "uat"] }. */
  choose: Record<string, string[]>;
  /** How one API starts: step lines (run-recipe syntax, stop: lines for teardown), and its proxy rules. */
  api: { steps: string[]; proxy?: Record<string, unknown> };
  apis: StackApi[];
  /** The UI: its repo, its proxy file, and how it starts ({{proxy}} is the proxy file to use). */
  ui?: {
    repo: string;
    /** The proxy config in the UI repo (JSON), relative to it. */
    proxyFile?: string;
    /** override (default): write a copy with the rules outside the repo and pass it as {{proxy}}. edit: change the file in place and put it back on stop. */
    proxyMode?: 'override' | 'edit';
    steps: string[];
    url?: string;
  };
}

/** A stack as the page gets it: where it came from. */
export interface StackInfo extends Stack {
  workspaceId: string;
  /** "the workspace’s, written by you", or imported from a file (check before running). */
  source: string;
}

/** What was picked when t was pressed. */
export interface StackChoice {
  /** One value per question: { env: 'uat' }. */
  values: Record<string, string>;
  /** The APIs to run, by repo name. */
  apis: string[];
}

/** One row of the picker: an API, whether the card has it, and why it is (or isn't) suggested. */
export interface StackApiRow {
  repo: string;
  /** False when neither the card nor its workspace has this repo. */
  found: boolean;
  /** Changed on the card's branch: it has to run for the change to be tried. */
  changed: boolean;
  /** Named in the ticket or the card's title. */
  named: boolean;
  /** "changed on this branch", "named in the ticket", "in context, unchanged", "not in this card". */
  why: string;
}

const MAX_APIS = 30;

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function steps(v: unknown, what: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) throw new Error(`${what} should be a list of step lines ("okteto up", …).`);
  return (v as string[]).map((s) => s.replace(/[\r\n]+/g, ' ').trim().slice(0, 500)).filter(Boolean).slice(0, MAX_STEPS);
}

function rules(v: unknown, what: string): Record<string, unknown> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what} should be an object of proxy rules ({ "/api/**": { "target": … } }).`);
  if (JSON.stringify(v).length > 20_000) throw new Error(`${what} is too long.`);
  return v as Record<string, unknown>;
}

/** Check a stack someone wrote or imported, and keep only what it should have. Throws what's wrong. */
export function validateStack(raw: unknown): Stack {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('The stack should be a JSON object.');
  const choose: Record<string, string[]> = {};
  const rc = r.choose ?? {};
  if (typeof rc !== 'object' || Array.isArray(rc)) throw new Error('"choose" should look like { "env": ["dev", "uat"] }.');
  for (const [k, v] of Object.entries(rc as Record<string, unknown>).slice(0, 5)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`"${k}" in "choose" can’t be a placeholder name: use letters, digits and _.`);
    const vals = Array.isArray(v) ? v.map((x) => str(x, 60)).filter(Boolean).slice(0, 9) : [];
    if (!vals.length) throw new Error(`"choose.${k}" should list the values to pick from, the default first.`);
    choose[k] = vals;
  }
  const ra = (r.api ?? {}) as Record<string, unknown>;
  const api = { steps: steps(ra.steps, '"api.steps"'), ...(rules(ra.proxy, '"api.proxy"') ? { proxy: rules(ra.proxy, '"api.proxy"') } : {}) };
  if (!Array.isArray(r.apis ?? [])) throw new Error('"apis" should be a list: [{ "repo": "orders-api", "values": { … } }].');
  const apis: StackApi[] = [];
  for (const [i, a] of ((r.apis ?? []) as unknown[]).slice(0, MAX_APIS).entries()) {
    const o = (a ?? {}) as Record<string, unknown>;
    const repo = str(o.repo, 120);
    if (!repo) throw new Error(`API ${i + 1} in "apis" has no "repo" (its folder name).`);
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries((o.values ?? {}) as Record<string, unknown>).slice(0, 30)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`"${k}" in ${repo}’s values can’t be a placeholder name: use letters, digits and _.`);
      values[k] = typeof v === 'number' ? String(v) : str(v);
    }
    const proxy = rules(o.proxy, `${repo}’s "proxy"`);
    apis.push({ repo, values, ...(proxy ? { proxy } : {}) });
  }
  if (apis.length && !api.steps.length) throw new Error('"api.steps" is empty: say how an API starts (the stack runs them for each API picked).');
  let ui: Stack['ui'];
  if (r.ui !== undefined) {
    const u = (r.ui ?? {}) as Record<string, unknown>;
    const repo = str(u.repo, 120);
    if (!repo) throw new Error('"ui" has no "repo" (its folder name).');
    const proxyFile = str(u.proxyFile, 300);
    if (proxyFile && (/^[a-z]:|^[\\/]/i.test(proxyFile) || proxyFile.split(/[\\/]/).includes('..'))) throw new Error('"ui.proxyFile" should be a path inside the UI repo, like "apps/web/proxy.conf.json".');
    const mode = u.proxyMode === 'edit' ? 'edit' : 'override';
    const url = str(u.url, 300);
    if (url && !/^https?:\/\/\S+$/.test(url)) throw new Error('"ui.url" should look like http://localhost:4200.');
    const uiSteps = steps(u.steps, '"ui.steps"');
    if (!uiSteps.length) throw new Error('"ui.steps" is empty: say how the UI starts.');
    ui = { repo, ...(proxyFile ? { proxyFile, proxyMode: mode } : {}), steps: uiSteps, ...(url ? { url } : {}) };
  }
  if (!apis.length && !ui) throw new Error('The stack has no APIs and no UI.');
  return { choose, api, apis, ...(ui ? { ui } : {}) };
}

/**
 * A worked example with made-up names (tests use it): how an API on a dev environment and a proxied
 * UI fit. The editor starts from stackDraft instead, so these names never end up in a real stack.
 */
export const STACK_EXAMPLE: Stack = {
  choose: { env: ['dev', 'uat'] },
  api: {
    steps: [
      'ps: answers:"y,n" if (-not (kubectl get deployment {{name}}-{{branch}} -n team-{{env}} 2>$null)) { New-DevEnvironment -Name {{name}} -Environment {{env}}; kubectl apply -f deployment.json }',
      'wait:port:{{port}} okteto up',
      'wait:http:{{port}} okteto exec -- sh -c "cd src/{{dir}} && dotnet watch run"',
      'stop: okteto down',
      'stop: kubectl delete deployment {{name}}-{{branch}} -n team-{{env}}',
    ],
    proxy: {
      '/gateway/team/{{route}}/**': { target: 'http://localhost:{{port}}', secure: false, changeOrigin: true, pathRewrite: { '.*/gateway/team/{{route}}': '' }, logLevel: 'debug' },
    },
  },
  apis: [
    { repo: 'orders-api', values: { name: 'orders-api', dir: 'OrdersApi', port: '8080', route: 'orders' } },
  ],
  ui: {
    repo: 'web-ui',
    proxyFile: 'apps/shop/proxy.conf.json',
    steps: ['node_modules\\.bin\\nx.cmd run shop:serve:development --proxyConfig={{proxy}}'],
    url: 'http://localhost:4200',
  },
};

/** A UI repo by its name: web, ui, client, frontend, app, spa or portal as a word in it. */
const UI_NAME = /(^|[-_. ])(ui|web|client|frontend|front-end|app|spa|portal)([-_. ]|$)/i;
/** An API repo by its name. */
const API_NAME = /(^|[-_. ])(api|apis|service|services|svc|backend|server|gateway)([-_. ]|$)/i;

/**
 * The stack editor's starting point for a workspace with none yet: the workspace's own repos (a UI
 * by its name, the APIs by theirs, or every other repo), with a common Okteto + Angular-style
 * shape to change. Never made-up repo names, so saving it untouched can't list repos you don't have.
 */
export function stackDraft(repoNames: string[]): Stack {
  const ui = repoNames.find((n) => UI_NAME.test(n) && !API_NAME.test(n));
  const rest = repoNames.filter((n) => n !== ui);
  const apis = rest.some((n) => API_NAME.test(n)) ? rest.filter((n) => API_NAME.test(n)) : rest;
  return {
    choose: { env: ['dev', 'uat'] },
    api: { steps: ['wait:port:{{port}} okteto up --namespace {{env}}', 'stop: okteto down'], proxy: { '/api/{{route}}/**': { target: 'http://localhost:{{port}}', secure: false, changeOrigin: true } } },
    apis: apis.map((repo, i) => ({ repo, values: { name: repo, port: String(5001 + i), route: repo.toLowerCase().replace(/[-_.]?(api|service|svc)$/, '') || repo.toLowerCase() } })),
    // A card's new worktree of the UI has no node_modules yet: install once, then start.
    ...(ui ? { ui: { repo: ui, proxyFile: 'proxy.conf.json', steps: ['if not exist node_modules npm install', 'npm start -- --proxy-config {{proxy}}'], url: 'http://localhost:4200' } } : {}),
  };
}

/** The repos a stack names that aren't in `known` (folder names, any case): a stack still holding an example's names. */
export function unknownStackRepos(stack: Pick<Stack, 'apis' | 'ui'>, known: string[]): string[] {
  const have = new Set(known.map((n) => n.toLowerCase()));
  return [...stack.apis.map((a) => a.repo), ...(stack.ui ? [stack.ui.repo] : [])].filter((r) => !have.has(r.toLowerCase()));
}

/** Put values into {{name}} placeholders. A placeholder with no value is an error that says which. */
export function fill(text: string, vars: Record<string, string>, where: string): string {
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, k: string) => {
    if (vars[k] === undefined) throw new Error(`${where} uses {{${k}}}, which has no value (set it in the API’s "values", or in "choose").`);
    return vars[k];
  });
}

/** fill() through every string (and key) of a JSON value. */
export function fillDeep(v: unknown, vars: Record<string, string>, where: string): unknown {
  if (typeof v === 'string') return fill(v, vars, where);
  if (Array.isArray(v)) return v.map((x) => fillDeep(x, vars, where));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [fill(k, vars, where), fillDeep(x, vars, where)]));
  return v;
}

/** A branch name as Kubernetes allows in a name: lower case, letters, digits and dashes ("feature/ABC-12" → "feature-abc-12"). */
export function k8sName(branch: string): string {
  return branch.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

/** The picked values, each checked against what the stack offers; missing ones get the default. */
export function choiceValues(stack: Pick<Stack, 'choose'>, picked: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, vals] of Object.entries(stack.choose)) {
    const p = picked[k];
    if (p !== undefined && !vals.includes(p)) throw new Error(`${k} can be ${vals.join(' or ')}, not ${p}.`);
    out[k] = p ?? vals[0];
  }
  return out;
}

/** "dev · orders-api, fees-api", "uat · UI only". */
export function choiceLabel(values: Record<string, string>, apis: string[]): string {
  return [...Object.values(values), apis.length ? apis.join(', ') : 'UI only'].join(' · ');
}

/** The picked APIs, in the stack's order. Unknown names are an error. */
export function pickedApis(stack: Stack, names: string[]): StackApi[] {
  const want = names.map((n) => n.toLowerCase());
  for (const n of names) if (!stack.apis.some((a) => a.repo.toLowerCase() === n.toLowerCase())) throw new Error(`The stack has no API called ${n}.`);
  return stack.apis.filter((a) => want.includes(a.repo.toLowerCase()));
}

/** Everything an API's template can use: the picked values, its repo and branch, then its own values. */
export function apiVars(values: Record<string, string>, api: StackApi, branch: string): Record<string, string> {
  return { ...values, repo: api.repo, branch, ...api.values };
}

/**
 * The run: each picked API's steps in its repo, then the UI's, then every stop: step (the UI's
 * first, then the APIs' in reverse, so what started last stops first). `branches` holds each
 * repo's branch, already made safe for a name.
 */
export function stackSteps(stack: Stack, choice: StackChoice, branches: Record<string, string>, proxy?: string): string[] {
  const values = choiceValues(stack, choice.values);
  const run: string[] = [];
  const stops: string[][] = [];
  const add = (lines: string[], repo: string, vars: Record<string, string>, where: string) => {
    const mine: string[] = [];
    for (const raw of lines) {
      const line = fill(raw, vars, where);
      const spec = parseStep(line);
      if (!spec) continue;
      // Steps run in their repo unless the line names another; notes are shown as written.
      const full = spec.note || spec.repo ? line : `@${repo} ${line}`;
      (spec.stop ? mine : run).push(full);
    }
    stops.push(mine);
  };
  for (const api of pickedApis(stack, choice.apis)) {
    add(stack.api.steps, api.repo, apiVars(values, api, branches[api.repo.toLowerCase()] ?? 'main'), `${api.repo}’s steps`);
  }
  if (stack.ui) {
    const vars = { ...values, repo: stack.ui.repo, branch: branches[stack.ui.repo.toLowerCase()] ?? 'main', ...(proxy ? { proxy } : {}) };
    add(stack.ui.steps, stack.ui.repo, vars, 'the UI’s steps');
  }
  return [...run, ...stops.reverse().flat()];
}

/** The proxy rules the picked APIs add, in order: each one's template rules, then its own. */
export function stackRules(stack: Stack, choice: StackChoice, branches: Record<string, string>): Record<string, unknown> {
  const values = choiceValues(stack, choice.values);
  const out: Record<string, unknown> = {};
  for (const api of pickedApis(stack, choice.apis)) {
    const vars = apiVars(values, api, branches[api.repo.toLowerCase()] ?? 'main');
    Object.assign(out, fillDeep(stack.api.proxy ?? {}, vars, `the proxy rules for ${api.repo}`), fillDeep(api.proxy ?? {}, vars, `${api.repo}’s own proxy rules`));
  }
  return out;
}

/**
 * The UI's proxy config with the picked APIs' rules. The dev server takes the first rule that
 * matches, so the new rules go first; a rule the file already has is replaced (and moves up).
 */
export function mergeProxy(base: Record<string, unknown>, rules: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...rules };
  for (const [k, v] of Object.entries(base)) if (!(k in rules)) out[k] = v;
  return out;
}

/** Does the text name this API (its repo, or its "name" value)? Whole words, any case. */
export function namesApi(text: string, api: StackApi): boolean {
  const t = text.toLowerCase();
  const words = [api.repo, api.values.name].filter((w): w is string => Boolean(w && w.length > 2)).map((w) => w.toLowerCase());
  return words.some((w) => new RegExp(`(^|[^a-z0-9-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9-])`).test(t));
}

/** Which APIs to tick when nothing was picked before: the ones changed on the branch, else the ones the ticket names. */
export function suggested(rows: StackApiRow[]): string[] {
  const changed = rows.filter((r) => r.found && r.changed).map((r) => r.repo);
  return changed.length ? changed : rows.filter((r) => r.found && r.named).map((r) => r.repo);
}

/** What a card's context tells Claude about the stack, under "Running the app". */
export function stackText(stack: Stack): string {
  const ask = Object.entries(stack.choose).map(([k, v]) => `${k} (${v.join(' / ')})`).join(', ');
  const L = [`The workspace’s stack starts the app. When you press Try it, you pick ${ask ? `${ask} and ` : ''}which APIs to run: ${stack.apis.map((a) => a.repo).join(', ') || 'none set up'}.`];
  if (stack.ui) L.push(`Then ${stack.ui.repo} starts${stack.ui.proxyFile ? `, with ${stack.ui.proxyFile} pointed at the APIs that run (${stack.ui.proxyMode === 'edit' ? 'changed in place and put back on stop: never commit that change' : 'a copy; the repo’s file isn’t changed'})` : ''}${stack.ui.url ? `, at ${stack.ui.url}` : ''}.`);
  L.push('cc-control does this; don’t start the APIs or the UI yourself, and don’t edit the proxy file to point at them.');
  return L.join(' ');
}
