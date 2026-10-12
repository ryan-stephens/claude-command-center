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
    /** The proxy config in the UI repo (JSON), relative to it. May use {{env}} (one file per env). */
    proxyFile?: string;
    /**
     * For an env other than the default: find/replace pairs applied to the proxy file's own rules
     * (the APIs not running here), so they go to that env: { "uat": [{ "from": "dev.", "to": "uat." }] }.
     * The running APIs' localhost rules are added after, so never rewritten.
     */
    proxyEnv?: Record<string, ProxySwap[]>;
    /**
     * For an env other than the default: find/replace pairs on the text of the UI app's runtime config
     * (its sign-in issuer and client id, flags keys, the hosts it calls), in order. The file is
     * changed in place for the run and put back on stop; git is told to look past it meanwhile, so
     * it never reaches a commit. The values are the owner's (a client id can be one): never logged.
     */
    configEnv?: Record<string, ProxySwap[]>;
    /** That config file, relative to the UI repo. Unset: the served app's assets/environmentConfig.js. */
    configFile?: string;
    /** override (default): write a copy with the rules outside the repo and pass it as {{proxy}}. edit: change the file in place and put it back on stop. */
    proxyMode?: 'override' | 'edit';
    steps: string[];
    /** Where it serves; may use {{uiPort}}. Unset: the --port in its steps, else the served app's own port from its project file, else what the app prints. */
    url?: string;
    /** Where the app lives on its server (`/ap-summary/`), put after the port. Unset: the app's baseHref when its project file has one. */
    path?: string;
  };
}

/** One find/replace in the proxy file's targets for another env. */
export interface ProxySwap { from: string; to: string }

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
  /** Its source folder (`apps/shop/src`), where its assets are. */
  src?: string;
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
const MAX_SWAPS = 20;

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

/** "ui.proxyEnv" or "ui.configEnv": per env value (one of "choose"'s), up to 20 short find/replace pairs. */
function swaps(v: unknown, choose: Record<string, string[]>, what = 'proxyEnv'): Record<string, ProxySwap[]> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`"ui.${what}" should look like { "uat": [{ "from": "dev.", "to": "uat." }] }.`);
  const offered = Object.values(choose).flat();
  const out: Record<string, ProxySwap[]> = {};
  for (const [env, list] of Object.entries(v as Record<string, unknown>)) {
    if (!offered.includes(env)) throw new Error(`"ui.${what}.${env}": ${env} isn’t a value in "choose"${offered.length ? ` (${offered.join(', ')})` : ''}.`);
    if (!Array.isArray(list)) throw new Error(`"ui.${what}.${env}" should be a list of { "from": …, "to": … }.`);
    if (list.length > MAX_SWAPS) throw new Error(`"ui.${what}.${env}" has ${list.length} pairs: ${MAX_SWAPS} at most.`);
    out[env] = list.map((x, i) => {
      const o = (x ?? {}) as Record<string, unknown>;
      if (typeof o.from !== 'string' || typeof o.to !== 'string' || !o.from || o.from.length > 200 || o.to.length > 200) throw new Error(`"ui.${what}.${env}" pair ${i + 1} needs "from" (not empty) and "to", each 200 characters at most.`);
      return { from: o.from, to: o.to };
    });
  }
  return Object.keys(out).length ? out : undefined;
}

/** A path inside the UI repo: not absolute, no `..`. */
const insideRepo = (p: string) => !/^[a-z]:|^[\\/]/i.test(p) && !p.split(/[\\/]/).includes('..');

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
    if (proxyFile && !insideRepo(proxyFile)) throw new Error('"ui.proxyFile" should be a path inside the UI repo, like "apps/web/proxy.conf.json".');
    const mode = u.proxyMode === 'edit' ? 'edit' : 'override';
    const proxyEnv = swaps(u.proxyEnv, choose);
    const configEnv = swaps(u.configEnv, choose, 'configEnv');
    const configFile = str(u.configFile, 300);
    if (configFile && !insideRepo(configFile)) throw new Error('"ui.configFile" should be a path inside the UI repo, like "apps/web/src/assets/environmentConfig.js".');
    const url = str(u.url, 300);
    if (url && !/^https?:\/\/\S+$/.test(url)) throw new Error('"ui.url" should look like http://localhost:{{uiPort}}.');
    let path = str(u.path, 200);
    if (path && /\s|^https?:/i.test(path)) throw new Error('"ui.path" is the part after the port, like /ap-summary/.');
    if (path && !path.startsWith('/')) path = `/${path}`;
    const uiSteps = steps(u.steps, '"ui.steps"');
    if (!uiSteps.length) throw new Error('"ui.steps" is empty: say how the UI starts.');
    ui = { repo, ...(proxyFile ? { proxyFile, proxyMode: mode } : {}), ...(proxyEnv ? { proxyEnv } : {}), ...(configEnv ? { configEnv } : {}), ...(configFile ? { configFile } : {}), steps: uiSteps, ...(url ? { url } : {}), ...(path && path !== '/' ? { path } : {}) };
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
    proxyEnv: { uat: [{ from: '.dev.example.test', to: '.uat.example.test' }] },
    configEnv: { uat: [{ from: '.dev.example.test', to: '.uat.example.test' }, { from: 'id-dev', to: 'id-uat' }] },
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

/** A dev server that takes --port: Nx's serve targets, ng serve, webpack serve, Vite. */
const SERVES_ON_PORT = /\bnx(\.cmd)?\s+(run\s+\S+:serve\S*|serve)\b|\bng(\.cmd)?\s+serve\b|\bwebpack(\.cmd)?\s+serve\b|(^|[\s\\/])vite(\.cmd)?(\s|$)/i;

/**
 * §114: a UI start step that serves on its project's fixed port (no --port, no {{uiPort}}) gets
 * `--port {{uiPort}}` added, as an okteto up gets forward: (serviceSteps), so a second card's UI
 * starts on a port of its own instead of stopping at "Port 4200 is already in use".
 */
export function autoUiPort(line: string): boolean {
  const spec = parseStep(line);
  return Boolean(spec && !spec.note && !spec.stop && SERVES_ON_PORT.test(spec.cmd) && !/--port\b/.test(spec.cmd) && !USES('uiPort').test(line));
}

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
  // A non-default env with one proxy file and nothing to move its rules: the APIs not running here stay on the default env.
  if (stack.ui?.proxyFile && !USES('[A-Za-z_]\\w*').test(stack.ui.proxyFile)) {
    const bare = Object.values(stack.choose).flatMap((vals) => vals.slice(1)).filter((v) => !stack.ui!.proxyEnv?.[v]?.length);
    if (bare.length) out.push(`${bare.join(', ')} can be picked, but ui.proxyEnv says nothing for ${bare.length === 1 ? 'it' : 'them'}: the APIs not running here would still go where ${stack.ui.proxyFile} points. Add find/replace pairs in "ui.proxyEnv", or use {{env}} in ui.proxyFile for a file per env.`);
  }
  // The UI's own runtime config (sign-in, flags) is per env too: an empty list says it needs nothing.
  if (stack.ui) {
    const bare = Object.values(stack.choose).flatMap((vals) => vals.slice(1)).filter((v) => !stack.ui!.configEnv?.[v]);
    if (bare.length) out.push(`${bare.join(', ')} can be picked, but ui.configEnv says nothing for ${bare.length === 1 ? 'it' : 'them'}: the UI keeps the default env's runtime config (${stack.ui.configFile ?? 'its assets/environmentConfig.js'}), so it signs in against the default env and the other env's gateway answers 401. Add find/replace pairs in "ui.configEnv" (an empty list when its config doesn't change).`);
  }
  if (stack.ui && !needsUiPort(stack)) {
    out.push('The UI starts on a fixed port, so two cards can’t run it at once: add --port {{uiPort}} to its start step and put {{uiPort}} in ui.url.');
  }
  return out;
}

/** Does the UI want a port picked for it? */
export function needsUiPort(stack: Pick<Stack, 'ui'>): boolean {
  return Boolean(stack.ui && (USES('uiPort').test([...stack.ui.steps, stack.ui.url ?? ''].join('\n')) || stack.ui.steps.some(autoUiPort)));
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
  // §114: --port {{uiPort}} was added to its start step, so a url written with the project's fixed port is this run's port instead.
  if (base && ctx.uiPort && stack.ui.url && !USES('uiPort').test(stack.ui.url) && stack.ui.steps.some(autoUiPort)) base = base.replace(/^(https?:\/\/(?:localhost|127\.0\.0\.1)):\d{2,5}/i, `$1:${ctx.uiPort}`);
  // A url written with a port the steps don't set, when the app's project file says another: the file is right (the url was a guess, or from the example).
  if (base && stack.ui.url && !ctx.uiPort && !inSteps && ctx.uiApp?.port && staleUrl(base, ctx.uiApp.port)) base = `http://localhost:${ctx.uiApp.port}`;
  return base ? withPath(base, stack.ui.path ?? ctx.uiApp?.path) : undefined;
}

/** A plain localhost url (no path of its own) on a port that isn't the served app's. */
export function staleUrl(url: string, appPort: number): boolean {
  const m = /^https?:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})\/?$/i.exec(url);
  return Boolean(m && Number(m[1]) !== appPort);
}

/**
 * The UI's own port (§122): its project file's, else a fixed localhost port in `ui.url`. The address
 * its sign-in is registered for, so the run keeps it when it's free.
 */
export function uiHomePort(stack: Pick<Stack, 'ui'>, app?: UiApp): number | undefined {
  if (app?.port) return app.port;
  const url = stack.ui?.url;
  const m = url && !USES('uiPort').test(url) ? /^https?:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})(?:\/|$)/i.exec(url) : null;
  return m ? Number(m[1]) : undefined;
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
  const run: string[] = [];
  const stops: string[][] = [];
  for (const api of pickedApis(stack, choice.apis)) {
    const { steps, stop } = serviceSteps(stack, choice, ctx, api.repo);
    run.push(...steps);
    stops.push(stop);
  }
  if (stack.ui) {
    const { steps, stop } = serviceSteps(stack, choice, ctx, 'ui');
    run.push(...steps);
    stops.push(stop);
  }
  return [...run, ...stops.reverse().flat()];
}

/**
 * One service's steps (§82): an API's by its repo name, or the UI's ("ui"), each run in its repo,
 * with its own stop: steps after them, so a service starts and stops on its own.
 */
export function serviceSteps(stack: Stack, choice: StackChoice, ctx: StackRunContext, service: string): { steps: string[]; stop: string[] } {
  const values = choiceValues(stack, choice.values);
  const steps: string[] = [];
  const stop: string[] = [];
  const add = (lines: string[], repo: string, vars: Record<string, string>, where: string, port?: number) => {
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
      (spec.stop ? stop : steps).push(full);
    }
  };
  if (service === 'ui') {
    if (!stack.ui) throw new Error('The stack has no UI.');
    add(stack.ui.steps.map((l) => (ctx.uiPort && autoUiPort(l) ? `${l} --port {{uiPort}}` : l)), stack.ui.repo, uiVars(values, stack.ui, ctx), 'the UI’s steps');
  } else {
    const [api] = pickedApis(stack, [service]);
    const key = api.repo.toLowerCase();
    add(stack.api.steps, api.repo, apiVars(values, api, ctx.branches[key] ?? 'main', ctx.ports?.[key]), `${api.repo}’s steps`, ctx.ports?.[key]);
  }
  return { steps, stop };
}

/** The services a pick runs, in start order: each API, then the UI. */
export function pickedServices(stack: Stack, choice: StackChoice): string[] {
  return [...pickedApis(stack, choice.apis).map((a) => a.repo), ...(stack.ui ? ['ui'] : [])];
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

/** The UI's proxy file for these values: ui.proxyFile with {{env}} (or any picked value) filled in. */
export function proxyFileFor(stack: Pick<Stack, 'choose' | 'ui'>, values: Record<string, string>): string | undefined {
  const f = stack.ui?.proxyFile;
  return f ? fill(f, chosenVars(choiceValues(stack, values)), '"ui.proxyFile"') : undefined;
}

/** The find/replace pairs for the picked values (ui.proxyEnv, or ui.configEnv): none for a default (first) value. */
export function proxySwaps(stack: Pick<Stack, 'choose' | 'ui'>, values: Record<string, string>, which: 'proxyEnv' | 'configEnv' = 'proxyEnv'): ProxySwap[] {
  const picked = choiceValues(stack, values);
  return Object.entries(stack.choose).flatMap(([k, vals]) => (picked[k] !== vals[0] ? stack.ui?.[which]?.[picked[k]] ?? [] : []));
}

/** Each pair replaced throughout a text, in order (a later pair sees what an earlier one wrote); `count` is how many replacements. */
export function swapText(text: string, pairs: ProxySwap[]): { text: string; count: number } {
  let count = 0;
  for (const p of pairs) {
    const parts = text.split(p.from);
    count += parts.length - 1;
    text = parts.join(p.to);
  }
  return { text, count };
}

/** Every string value of the rules (targets, headers) with each pair replaced throughout; keys (the routes) left alone. */
export function swapTargets<T>(rules: T, pairs: ProxySwap[]): T {
  return swapRules(rules, pairs).rules;
}

/** swapTargets, and how many string values it changed. */
export function swapRules<T>(rules: T, pairs: ProxySwap[]): { rules: T; count: number } {
  if (!pairs.length) return { rules, count: 0 };
  let count = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') { const s = swapText(v, pairs).text; if (s !== v) count++; return s; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { rules: walk(rules) as T, count };
}

/** Nothing to replace, but some pair's "to" is already there: the file looks like that env's already. */
export function looksSwapped(text: string, pairs: ProxySwap[]): boolean {
  return pairs.length > 0 && !pairs.some((p) => text.includes(p.from)) && pairs.some((p) => p.to && p.to !== p.from && text.includes(p.to));
}

/** Where the UI app's runtime config may be, most likely first: ui.configFile, else the served app's assets/environmentConfig.js. */
export function configCandidates(stack: Pick<Stack, 'ui'>, app?: UiApp): string[] {
  if (stack.ui?.configFile) return [stack.ui.configFile];
  const src = app?.src?.replace(/\/+$/, '');
  const dirs = src ? [src, src.split('/').slice(0, -1).join('/')] : ['src'];
  return [...new Set(dirs.map((d) => `${d ? `${d}/` : ''}assets/environmentConfig.js`))];
}

/**
 * What moving to the picked env did, for the Logs: "3 proxy targets and 5 config values moved to UAT"
 * (counts only: a pair's values can be secrets), and a note when nothing moved but a file already
 * looks like that env's.
 */
export function movedText(env: string, moved: { proxy: number; config: number; configFile?: string; proxyAlready?: boolean; configAlready?: boolean }): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = [`${n(moved.proxy, 'proxy target', 'proxy targets')} and ${n(moved.config, 'config value', 'config values')} moved to ${env}${moved.configFile ? ` (${moved.configFile} changed for this run and put back on stop; git looks past it meanwhile, so Ship and changed files leave it out)` : ''}.`];
  if (moved.proxyAlready) parts.push('The proxy file’s own targets already look like that env’s.');
  if (moved.configAlready) parts.push(`${moved.configFile ?? 'The config file'} already looks like that env’s: nothing to replace.`);
  return parts.join(' ');
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
  if (stack.ui?.configEnv && Object.values(stack.ui.configEnv).some((l) => l.length)) L.push(`On another env than the default, the UI app’s runtime config (${stack.ui.configFile ?? 'its assets/environmentConfig.js'}) is changed to that env’s values for the run and put back on stop; git is told to look past it meanwhile. Never commit that file’s env values, and don’t edit it while the stack runs (the stop puts the original back).`);
  L.push('cc-control does this; don’t start the APIs or the UI yourself, and don’t edit the proxy file to point at them.');
  return L.join(' ');
}
