// A workspace's stack: how Try it brings up the APIs a card needs on a dev environment, and the UI
// pointed at them. Which APIs run changes from card to card (and developer to developer), so the
// stack says how *an* API starts once, as a template, and lists the APIs with their own values.
// Pressing t picks the values to choose (dev or uat) and the APIs to run; the steps and the UI's
// proxy rules are built from what was picked. Nothing here knows about any one tool: Okteto,
// kubectl and the rest live in the steps a team writes. Pure and shared, so the page and the server
// build the same thing.

import { MAX_STEPS, OKTETO_UP, parseStep } from './recipes.ts';

/** One API the stack can start. */
export interface StackApi {
  /** Its repo, by folder name (a card's repo, or its workspace's). */
  repo: string;
  /**
   * Its values for the template: {{name}}, {{dir}}, {{appPort}} (the port it listens on in its
   * container; a `port` value is read as that too, from before ports were picked per run) …
   * {{port}}, the local port, is picked by cc-control for each run, never written here.
   */
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
  /** The UI: its repo, its proxy file, and how it starts ({{proxy}} is the proxy file to use, {{uiPort}} the port picked for this run). */
  ui?: {
    repo: string;
    /** The proxy config in the UI repo (JSON), relative to it. */
    proxyFile?: string;
    /** override (default): write a copy with the rules outside the repo and pass it as {{proxy}}. edit: change the file in place and put it back on stop. */
    proxyMode?: 'override' | 'edit';
    steps: string[];
    /** Where it serves; may use {{uiPort}}. Unset: the --port in its steps, else the served app's own port from its project file, else what the app prints. */
    url?: string;
    /** Where the app lives on its server (`/ap-summary/`), put after the port. Unset: the app's baseHref when its project file has one. */
    path?: string;
  };
}

/** What one run of the stack knows besides the pick: each repo's branch, the proxy copy, and the ports picked for it. */
export interface StackRunContext {
  /** Each repo's branch (lower-case repo name → branch), already made safe for a name. */
  branches: Record<string, string>;
  /** The proxy file the UI starts with. */
  proxy?: string;
  /** The local port picked for each API (lower-case repo name → port). An API without one falls back to its `port` value. */
  ports?: Record<string, number>;
  /** The port picked for the UI, when its steps or url ask for {{uiPort}}. */
  uiPort?: number;
  /** What the served app's own project file says (angular.json, project.json): its port and baseHref, read when the run is prepared. */
  uiApp?: UiApp;
}

/** One app a UI repo can serve, as its project file says it. */
export interface UiApp {
  name: string;
  port?: number;
  /** Its baseHref, when not `/`. */
  path?: string;
  /** The file it was read from. */
  from: string;
}

/** The project the UI's steps serve: `nx serve X`, `nx run X:serve`, `ng serve X` (none: the project file's default). */
export function uiProject(steps: string[]): string | undefined {
  for (const s of steps) {
    const m = /\b(?:nx|ng)(?:\.cmd)?\s+serve\s+(?!-)([\w@./-]+)/i.exec(s) ?? /\bnx(?:\.cmd)?\s+run\s+([\w@./-]+):serve\b/i.exec(s);
    if (m) return m[1];
  }
  return undefined;
}

/** A fixed --port in steps (after their placeholders were filled). */
export function fixedPort(steps: string[]): number | undefined {
  const m = /--port[= ](\d{2,5})\b/.exec(steps.join('\n'));
  return m ? Number(m[1]) : undefined;
}

/** The path put after the port: `/ap-summary/`, never doubled onto a url that already has one. */
export function withPath(url: string, path?: string): string {
  if (!path || path === '/') return url;
  return /^https?:\/\/[^/]+\/?$/.test(url) ? `${url.replace(/\/$/, '')}/${path.replace(/^\//, '')}` : url;
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
    if (url && !/^https?:\/\/\S+$/.test(url)) throw new Error('"ui.url" should look like http://localhost:{{uiPort}}.');
    let path = str(u.path, 200);
    if (path && /\s|^https?:/i.test(path)) throw new Error('"ui.path" is the part after the port, like /ap-summary/.');
    if (path && !path.startsWith('/')) path = `/${path}`;
    const uiSteps = steps(u.steps, '"ui.steps"');
    if (!uiSteps.length) throw new Error('"ui.steps" is empty: say how the UI starts.');
    ui = { repo, ...(proxyFile ? { proxyFile, proxyMode: mode } : {}), steps: uiSteps, ...(url ? { url } : {}), ...(path && path !== '/' ? { path } : {}) };
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
      'ps: answers:"y,n" KUBECONFIG=%KUBECONFIG_{{ENV}}% if (-not (kubectl get deployment {{deployment}} -n team-{{env}} 2>$null)) { New-DevEnvironment -Name {{name}} -Environment {{env}}; kubectl apply -f deployment.json }',
      'wait:port:{{port}} forward:{{port}}:{{appPort}} KUBECONFIG=%KUBECONFIG_{{ENV}}% okteto up',
      'wait:http:{{port}} KUBECONFIG=%KUBECONFIG_{{ENV}}% okteto exec -- sh -c "cd src/{{dir}} && dotnet watch run"',
      'stop: KUBECONFIG=%KUBECONFIG_{{ENV}}% okteto down',
      'stop: KUBECONFIG=%KUBECONFIG_{{ENV}}% kubectl delete deployment {{deployment}} -n team-{{env}}',
    ],
    proxy: {
      '/gateway/team/{{route}}/**': { target: 'http://localhost:{{port}}', secure: false, changeOrigin: true, pathRewrite: { '.*/gateway/team/{{route}}': '' }, logLevel: 'debug' },
    },
  },
  apis: [
    { repo: 'orders-api', values: { name: 'orders-api', dir: 'OrdersApi', appPort: '8080', route: 'orders' } },
  ],
  ui: {
    repo: 'web-ui',
    proxyFile: 'apps/shop/proxy.conf.json',
    steps: ['node_modules\\.bin\\nx.cmd run shop:serve:development --proxyConfig={{proxy}} --port {{uiPort}}'],
    url: 'http://localhost:{{uiPort}}',
  },
};

/** A UI repo by its name: web, ui, client, frontend, app, spa or portal as a word in it. */
export const UI_NAME = /(^|[-_. ])(ui|web|client|frontend|front-end|app|spa|portal)([-_. ]|$)/i;
/** An API repo by its name. */
export const API_NAME = /(^|[-_. ])(api|apis|service|services|svc|backend|server|gateway)([-_. ]|$)/i;

/** The route an API's name suggests: "loans-api" → "loans", "Workspaces-API" → "workspaces". */
export function routeGuess(repo: string): string {
  return repo.toLowerCase().replace(/[-_.]?(api|apis|service|services|svc)$/, '') || repo.toLowerCase();
}

/** Read a JSON file that may have comments or trailing commas (proxy configs often do). */
export function readLooseJson(text: string): Record<string, unknown> {
  const clean = text.replace(/^﻿/, '').replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (_m, str: string | undefined) => str ?? '').replace(/,(\s*[}\]])/g, '$1');
  const v = JSON.parse(clean) as unknown;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('it isn’t a JSON object');
  return v as Record<string, unknown>;
}

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
    // {{port}} is picked for each run; forward: puts it in a copy of the API's okteto.yml, so two cards can run one API at once.
    api: { steps: ['wait:port:{{port}} forward:{{port}}:{{appPort}} okteto up --namespace {{env}}', 'stop: okteto down'], proxy: { '/api/{{route}}/**': { target: 'http://localhost:{{port}}', secure: false, changeOrigin: true } } },
    apis: apis.map((repo) => ({ repo, values: { name: repo, appPort: '8080', route: routeGuess(repo) } })),
    // A card's new worktree of the UI has no node_modules yet: install once, then start on the port picked for the run.
    ...(ui ? { ui: { repo: ui, proxyFile: 'proxy.conf.json', steps: ['if not exist node_modules npm install', 'npm start -- --proxy-config {{proxy}} --port {{uiPort}}'], url: 'http://localhost:{{uiPort}}' } } : {}),
  };
}

const USES = (what: string) => new RegExp(`\\{\\{\\s*${what}\\s*\\}\\}`);

/**
 * What would stop a stack running twice at once, or would mislead: said in the editor and by the
 * doctor, never enforced (a team that runs one card at a time can leave it).
 */
export function stackWarnings(stack: Stack): string[] {
  const out: string[] = [];
  const apiLines = [...stack.api.steps, JSON.stringify(stack.api.proxy ?? {}), ...stack.apis.map((a) => JSON.stringify(a.proxy ?? {}))].join('\n');
  // An okteto up without forward: gets the picked port forwarded on its own (stackSteps); only forward:no keeps a shared 8080.
  const specs = stack.api.steps.map(parseStep).filter((s): s is NonNullable<typeof s> => Boolean(s && !s.note));
  if (USES('port').test(apiLines) && specs.some((s) => s.forward === false && OKTETO_UP.test(s.cmd))) {
    out.push('{{port}} is picked for each run, but forward:no keeps the okteto up step on the manifest’s own port: two cards can’t run that API at once, and the proxy points at a port nothing answers on.');
  }
  const legacy = stack.apis.filter((a) => a.values.port && !a.values.appPort).map((a) => a.repo);
  if (legacy.length) out.push(`${legacy.join(', ')}: "port" in values now means the port inside the container ({{appPort}}); the local port is picked per run. Call it "appPort" to say so.`);
  if (/\{\{\s*name\s*\}\}-\{\{\s*branch\s*\}\}/.test(apiLines)) out.push('Use {{deployment}} for the deployment’s name: it is {{name}}-{{branch}} cut to 50 characters, as Kubernetes needs.');
  if (stack.ui && !USES('uiPort').test([...stack.ui.steps, stack.ui.url ?? ''].join('\n'))) {
    out.push('The UI starts on a fixed port, so two cards can’t run it at once: add --port {{uiPort}} to its start step and put {{uiPort}} in ui.url.');
  }
  return out;
}

/** Does the UI want a port picked for it? */
export function needsUiPort(stack: Pick<Stack, 'ui'>): boolean {
  return Boolean(stack.ui && USES('uiPort').test([...stack.ui.steps, stack.ui.url ?? ''].join('\n')));
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

/**
 * The deployment made for an API on a branch: its name, a dash, the branch, cut to 50 characters
 * (the limit the team's helper applies), so a long name doesn't end in a dash.
 */
export function k8sDeployment(name: string, branch: string): string {
  return `${k8sName(name)}-${k8sName(branch)}`.slice(0, 50).replace(/-+$/, '');
}

/** "uat · orders-api :18000, fees-api :18001 · UI :18002": what was picked, with the ports picked for it. */
export function runLabel(values: Record<string, string>, apis: string[], ports: Record<string, number> = {}, uiPort?: number, app?: string): string {
  const api = apis.map((a) => (ports[a.toLowerCase()] ? `${a} :${ports[a.toLowerCase()]}` : a));
  const ui = app || uiPort ? [`${app ?? 'UI'}${uiPort ? ` :${uiPort}` : ''}`] : [];
  return [...Object.values(values), api.length ? api.join(', ') : 'UI only', ...ui].join(' · ');
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

/** The picked values, plus each in upper case under its upper-case name ({{ENV}} = DEV), for %KUBECONFIG_{{ENV}}%-style variables. */
function chosenVars(values: Record<string, string>): Record<string, string> {
  const upper = Object.fromEntries(Object.entries(values).filter(([k]) => k !== k.toUpperCase()).map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]));
  return { ...upper, ...values };
}

/**
 * Everything an API's template can use: the picked values, its repo and branch, its own values,
 * {{appPort}} (its `appPort` value, else its old `port` value, else 8080), {{deployment}}, and
 * {{port}}: the local port picked for this run, or the `port` value when none was picked.
 */
export function apiVars(values: Record<string, string>, api: StackApi, branch: string, port?: number): Record<string, string> {
  const name = api.values.name ?? api.repo;
  const appPort = api.values.appPort ?? api.values.port ?? '8080';
  return { ...chosenVars(values), repo: api.repo, branch, ...api.values, name, appPort, deployment: k8sDeployment(name, branch), ...(port !== undefined ? { port: String(port) } : {}) };
}

/** Everything the UI's template can use. */
function uiVars(values: Record<string, string>, ui: NonNullable<Stack['ui']>, ctx: StackRunContext): Record<string, string> {
  return { ...chosenVars(values), repo: ui.repo, branch: ctx.branches[ui.repo.toLowerCase()] ?? 'main', ...(ctx.proxy ? { proxy: ctx.proxy } : {}), ...(ctx.uiPort ? { uiPort: String(ctx.uiPort) } : {}) };
}

/**
 * Where the UI will serve for this run: `ui.url` filled in; else the port picked for it, a --port in
 * its steps, or the served app's own port from its project file; then `ui.path`, else the app's
 * baseHref. Nothing says the port: no URL up front, and the address the app prints is used.
 */
export function uiUrlFor(stack: Stack, choice: StackChoice, ctx: StackRunContext): string | undefined {
  if (!stack.ui) return undefined;
  const vars = uiVars(choiceValues(stack, choice.values), stack.ui, ctx);
  const inSteps = fixedPort(stack.ui.steps.map((s) => fill(s, vars, 'the UI’s steps')));
  const port = ctx.uiPort ?? inSteps ?? ctx.uiApp?.port;
  let base = stack.ui.url ? fill(stack.ui.url, vars, 'the UI’s url') : port ? `http://localhost:${port}` : undefined;
  // A url written with a port the steps don't set, when the app's project file says another: the file is right (the url was a guess, or from the example).
  if (base && stack.ui.url && !ctx.uiPort && !inSteps && ctx.uiApp?.port && staleUrl(base, ctx.uiApp.port)) base = `http://localhost:${ctx.uiApp.port}`;
  return base ? withPath(base, stack.ui.path ?? ctx.uiApp?.path) : undefined;
}

/** A plain localhost url (no path of its own) on a port that isn't the served app's. */
export function staleUrl(url: string, appPort: number): boolean {
  const m = /^https?:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})\/?$/i.exec(url);
  return Boolean(m && Number(m[1]) !== appPort);
}

/** The port the UI serves on for this run, as uiUrlFor works it out, when it is a number. */
export function uiPortFor(stack: Stack, choice: StackChoice, ctx: StackRunContext): number | undefined {
  const url = uiUrlFor(stack, choice, ctx);
  const m = url ? /:(\d{2,5})(?:\/|$)/.exec(url) : null;
  return m ? Number(m[1]) : undefined;
}

/**
 * The run: each picked API's steps in its repo, then the UI's, then every stop: step (the UI's
 * first, then the APIs' in reverse, so what started last stops first).
 */
export function stackSteps(stack: Stack, choice: StackChoice, ctx: StackRunContext): string[] {
  const values = choiceValues(stack, choice.values);
  const run: string[] = [];
  const stops: string[][] = [];
  const add = (lines: string[], repo: string, vars: Record<string, string>, where: string, port?: number) => {
    const mine: string[] = [];
    for (const raw of lines) {
      let line = fill(raw, vars, where);
      let spec = parseStep(line);
      if (!spec) continue;
      // An okteto up with a port picked forwards it without being told: the team's manifest says
      // 8080 -> 8080, and nothing answers on the picked port otherwise. forward:no keeps the manifest's own.
      if (port !== undefined && !spec.note && !spec.stop && spec.forward === undefined && OKTETO_UP.test(spec.cmd)) {
        line = `forward:${port}:${vars.appPort} ${line}`;
        spec = parseStep(line)!;
      }
      // Steps run in their repo unless the line names another; notes are shown as written.
      const full = spec.note || spec.repo ? line : `@${repo} ${line}`;
      (spec.stop ? mine : run).push(full);
    }
    stops.push(mine);
  };
  for (const api of pickedApis(stack, choice.apis)) {
    const key = api.repo.toLowerCase();
    add(stack.api.steps, api.repo, apiVars(values, api, ctx.branches[key] ?? 'main', ctx.ports?.[key]), `${api.repo}’s steps`, ctx.ports?.[key]);
  }
  if (stack.ui) add(stack.ui.steps, stack.ui.repo, uiVars(values, stack.ui, ctx), 'the UI’s steps');
  return [...run, ...stops.reverse().flat()];
}

/** The proxy rules the picked APIs add, in order: each one's template rules, then its own. */
export function stackRules(stack: Stack, choice: StackChoice, ctx: Pick<StackRunContext, 'branches' | 'ports'>): Record<string, unknown> {
  const values = choiceValues(stack, choice.values);
  const out: Record<string, unknown> = {};
  for (const api of pickedApis(stack, choice.apis)) {
    const key = api.repo.toLowerCase();
    const port = ctx.ports?.[key];
    const vars = apiVars(values, api, ctx.branches[key] ?? 'main', port);
    const rules: Record<string, unknown> = Object.assign({}, fillDeep(stack.api.proxy ?? {}, vars, `the proxy rules for ${api.repo}`), fillDeep(api.proxy ?? {}, vars, `${api.repo}’s own proxy rules`));
    Object.assign(out, port ? retarget(rules, Number(vars.appPort), port) : rules);
  }
  return out;
}

/**
 * Rules written with the API's container port as a literal (`http://localhost:8080`, from before
 * ports were picked per run) follow the port picked for this run: the API answers there, and a
 * rule left on 8080 gives the UI a 504. Only that port is touched; other targets are the team's.
 */
export function retarget<T>(rules: T, appPort: number, port: number): T {
  const at = new RegExp(`^(https?://(?:localhost|127\\.0\\.0\\.1)):${appPort}(?=/|$)`, 'i');
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(at, `$1:${port}`);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(rules) as T;
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
  const L = [`The workspace’s stack starts the app. When you press Try it, you pick ${ask ? `${ask} and ` : ''}which APIs to run: ${stack.apis.map((a) => a.repo).join(', ') || 'none set up'}. Each gets a local port of its own for that run.`];
  if (stack.ui) L.push(`Then ${stack.ui.repo} starts${stack.ui.proxyFile ? `, with ${stack.ui.proxyFile} pointed at the APIs that run (${stack.ui.proxyMode === 'edit' ? 'changed in place and put back on stop: never commit that change' : 'a copy; the repo’s file isn’t changed'})` : ''}${stack.ui.url ? `, at ${withPath(stack.ui.url.replace(/\{\{\s*uiPort\s*\}\}/, '<a port picked for the run>'), stack.ui.path)}` : stack.ui.path ? `, at ${stack.ui.path} on its port` : ''}.`);
  L.push('cc-control does this; don’t start the APIs or the UI yourself, and don’t edit the proxy file to point at them.');
  return L.join(' ');
}
