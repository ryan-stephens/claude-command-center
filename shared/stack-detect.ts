// A stack found in the repos themselves (PLAN §54, milestone 3), so nobody writes one by hand:
// an API from its okteto manifest (name, the container port it forwards), its .csproj folder and
// a health route in its code; the UI from angular.json / project.json / package.json (the serve
// command, its proxy file); each API's proxy rule from the rules the proxy file already has. What
// can't be read is asked once, and every finding says which file it came from. Pure: the server
// hands in each repo's file list and a reader, so tests use repos in memory.

import { API_NAME, readLooseJson, routeGuess, UI_NAME, type Stack, type StackApi, type UiApp } from './stack.ts';
import { findForwards } from './okteto.ts';

/** One repo as the detector sees it: its files (relative, forward slashes, a bounded walk) and a reader. */
export interface RepoFiles {
  /** The folder name (how the stack names it). */
  name: string;
  files: string[];
  read: (rel: string) => string | undefined;
}

/** One thing found, or one thing that had to be assumed (asked). */
export interface Finding {
  repo: string;
  role: 'api' | 'ui' | 'other' | 'stack';
  text: string;
  /** The file it was read from. */
  from?: string;
  /** Nothing said it: a default was taken, to check. */
  asked?: boolean;
}

export interface Detected {
  stack?: Stack;
  findings: Finding[];
}

const dirOf = (p: string) => p.split('/').slice(0, -1).join('/');

/** `name:` at the top of an okteto manifest, or the first dev entry of a v2 one. */
export function manifestName(text: string): string | undefined {
  const top = /^name:\s*["']?([\w.-]+)["']?\s*$/m.exec(text)?.[1];
  if (top) return top;
  const dev = /^dev:\s*$\r?\n\s+([\w.-]+):\s*$/m.exec(text)?.[1];
  return dev;
}

/** A health route in C# source, when obvious: MapHealthChecks("/x"), MapGet("/self", …), [Route("self")] / [HttpGet("health")]. */
export function healthRoute(cs: string): string | undefined {
  const m = /MapHealthChecks\(\s*"([^"]+)"/.exec(cs) ?? /MapGet\(\s*"(\/?(?:health|healthz|self|ping|alive|ready|status)[^"]*)"/i.exec(cs);
  if (m) return m[1].startsWith('/') ? m[1] : `/${m[1]}`;
  const attr = /\[(?:Route|HttpGet)\(\s*"\/?((?:health|healthz|self|ping|alive|ready|status)[^"]*)"\s*\)\]/i.exec(cs);
  return attr ? `/${attr[1]}` : undefined;
}

interface Serve { command: string; proxyFile?: string; port?: number; path?: string; from: string; /** The other apps the repo can serve. */ others?: string[] }

type Targets = Record<string, Record<string, unknown>>;
const serveOpts = (target: Record<string, unknown> | undefined) => ((target?.options ?? {}) as { proxyConfig?: string; port?: number });
/** The app's baseHref from its build target, when it isn't `/`. */
const basePath = (targets: Targets | undefined): string | undefined => {
  const b = (targets?.build?.options as { baseHref?: unknown } | undefined)?.baseHref;
  return typeof b === 'string' && b.trim() && b.trim() !== '/' ? `/${b.trim().replace(/^\/+/, '')}` : undefined;
};

/**
 * Every app the UI repo can serve, in the order its files list them: angular.json's projects with a
 * serve target, then each project.json (an nx workspace has one per app under apps/) with one.
 */
export function uiApps(repo: RepoFiles): (UiApp & { proxyFile?: string; kind: 'ng' | 'nx' })[] {
  const json = (rel: string) => { const t = repo.read(rel); if (!t) return undefined; try { return readLooseJson(t); } catch { return undefined; } };
  const out: (UiApp & { proxyFile?: string; kind: 'ng' | 'nx' })[] = [];
  const ng = json('angular.json');
  if (ng) {
    const projects = (ng.projects ?? {}) as Record<string, { architect?: Targets; targets?: Targets }>;
    const names = Object.keys(projects).filter((p) => (projects[p].architect ?? projects[p].targets)?.serve);
    const first = typeof ng.defaultProject === 'string' && names.includes(ng.defaultProject) ? ng.defaultProject : undefined;
    for (const name of first ? [first, ...names.filter((n) => n !== first)] : names) {
      const t = projects[name].architect ?? projects[name].targets;
      const o = serveOpts(t?.serve);
      const path = basePath(t);
      out.push({ name, kind: 'ng', from: 'angular.json', ...(o.proxyConfig ? { proxyFile: o.proxyConfig } : {}), ...(o.port ? { port: o.port } : {}), ...(path ? { path } : {}) });
    }
  }
  for (const file of repo.files.filter((f) => /(^|\/)project\.json$/.test(f)).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))) {
    const pj = json(file);
    const targets = pj?.targets as Targets | undefined;
    if (!targets?.serve) continue;
    const name = String(pj!.name ?? (file.includes('/') ? file.split('/').at(-2) : repo.name));
    const o = serveOpts(targets.serve);
    const path = basePath(targets);
    out.push({ name, kind: 'nx', from: file, ...(o.proxyConfig ? { proxyFile: o.proxyConfig } : {}), ...(o.port ? { port: o.port } : {}), ...(path ? { path } : {}) });
  }
  return out;
}

/** What the project file says about one app of the UI repo (the one the steps serve), by name; the first app when no name. */
export function uiApp(repo: RepoFiles, name?: string): UiApp | undefined {
  const apps = uiApps(repo);
  const hit = name ? apps.find((a) => a.name.toLowerCase() === name.toLowerCase()) : apps[0];
  if (!hit) return undefined;
  const { proxyFile: _p, kind: _k, ...app } = hit;
  return app;
}

/** How the UI serves, from angular.json (ng), project.json (nx) or package.json; the proxy file the serve target names. */
export function uiServe(repo: RepoFiles): Serve | undefined {
  const json = (rel: string) => { const t = repo.read(rel); if (!t) return undefined; try { return readLooseJson(t); } catch { return undefined; } };
  const apps = uiApps(repo);
  if (apps.length) {
    const [a, ...rest] = apps;
    const command = a.kind === 'ng' ? `npx ng serve ${a.name} --proxy-config {{proxy}} --port {{uiPort}}` : `npx nx serve ${a.name} --proxyConfig={{proxy}} --port={{uiPort}}`;
    return { command, ...(a.proxyFile ? { proxyFile: a.proxyFile } : {}), ...(a.port ? { port: a.port } : {}), ...(a.path ? { path: a.path } : {}), from: a.from, ...(rest.length ? { others: rest.map((r) => r.name) } : {}) };
  }
  const pkg = json('package.json');
  if (pkg) {
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const deps = { ...(pkg.dependencies as Record<string, string> | undefined), ...(pkg.devDependencies as Record<string, string> | undefined) };
    if (deps['@angular/core'] && (scripts.start || scripts.serve)) return { command: `npm ${scripts.start ? 'start' : 'run serve'} -- --proxy-config {{proxy}} --port {{uiPort}}`, from: 'package.json' };
    const dev = ['dev', 'start', 'serve'].find((s) => scripts[s]);
    if (dev && (deps.vite || deps.next || deps['react-scripts'] || /\bvite\b|\bnext\b/.test(scripts[dev]))) return { command: `npm run ${dev} -- --port {{uiPort}}`, from: 'package.json' };
  }
  return undefined;
}

/** The repo's first project file: src/<Dir>/<X>.csproj preferred, else the shallowest one. */
function csprojDir(files: string[]): string | undefined {
  const all = files.filter((f) => f.endsWith('.csproj')).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const under = all.find((f) => /^src\/[^/]+\/[^/]+\.csproj$/.test(f)) ?? all[0];
  return under ? dirOf(under) || '.' : undefined;
}

/** Which of the proxy file's rules is this API's: its key or target names the API (its route, name or repo), longest match first. */
export function ruleFor(rules: Record<string, unknown>, api: { repo: string; name: string; route: string }): string | undefined {
  const words = [...new Set([api.route, api.name, api.repo].map((w) => w.toLowerCase()).filter((w) => w.length > 2))];
  const hit = (s: string) => words.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(s.toLowerCase()));
  const keys = Object.keys(rules).filter((k) => {
    const r = rules[k];
    const target = r && typeof r === 'object' ? String((r as { target?: unknown }).target ?? '') : typeof r === 'string' ? r : '';
    return hit(k) || hit(target);
  });
  return keys.sort((a, b) => b.length - a.length)[0];
}

/** A rule as a template: the route becomes {{route}} wherever it appears (the key, pathRewrite), the target the picked port. */
export function templateRule(key: string, rule: unknown, route: string): { key: string; rule: unknown } {
  const swap = (s: string) => s.replace(new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '{{route}}');
  const deep = (v: unknown): unknown => typeof v === 'string' ? swap(v) : Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [swap(k), deep(x)])) : v;
  const r = rule && typeof rule === 'object' && !Array.isArray(rule) ? { ...(deep(rule) as Record<string, unknown>), target: 'http://localhost:{{port}}' } : { target: 'http://localhost:{{port}}' };
  return { key: swap(key), rule: r };
}

/**
 * The stack the repos describe, and how each part was found. No API and no UI gives no stack
 * (the editor falls back to its draft).
 */
export function detectStack(repos: RepoFiles[]): Detected {
  const findings: Finding[] = [];
  const apis: { repo: RepoFiles; manifest?: string; csproj?: string; node: boolean }[] = [];
  let ui: { repo: RepoFiles; serve: Serve } | undefined;
  const uis: { repo: RepoFiles; serve: Serve }[] = [];
  for (const r of repos) {
    const manifest = ['okteto.yml', 'okteto.yaml'].find((f) => r.files.includes(f));
    const csproj = csprojDir(r.files);
    const serve = uiServe(r);
    const node = !serve && r.files.includes('package.json') && !csproj && !manifest;
    if (serve && !(csproj || manifest) && !API_NAME.test(r.name)) uis.push({ repo: r, serve });
    else if (manifest || csproj || (node && (API_NAME.test(r.name) || !UI_NAME.test(r.name)))) apis.push({ repo: r, ...(manifest ? { manifest } : {}), ...(csproj ? { csproj } : {}), node });
    else if (serve) uis.push({ repo: r, serve });
    else findings.push({ repo: r.name, role: 'other', text: 'nothing to go on (no okteto.yml, .csproj, angular.json, project.json or package.json): left out of the stack' });
  }
  // One UI: the one named like one wins; the rest are left out and said.
  uis.sort((a, b) => Number(UI_NAME.test(b.repo.name)) - Number(UI_NAME.test(a.repo.name)));
  ui = uis[0];
  for (const extra of uis.slice(1)) findings.push({ repo: extra.repo.name, role: 'other', text: `also serves a UI (${extra.serve.from}); only ${ui!.repo.name} is the stack’s UI`, from: extra.serve.from });

  // Each API's values.
  const stackApis: StackApi[] = [];
  const apiFacts: { repo: string; name: string; route: string; manifest: boolean }[] = [];
  for (const a of apis) {
    const r = a.repo;
    const text = a.manifest ? r.read(a.manifest) ?? '' : '';
    const name = (a.manifest && manifestName(text)) || r.name.toLowerCase();
    const forwards = a.manifest ? findForwards(text) : [];
    const appPort = String(forwards[0]?.remote ?? forwards[0]?.local ?? 8080);
    const route = routeGuess(r.name);
    const values: Record<string, string> = { name, appPort, route };
    if (a.csproj) values.dir = a.csproj;
    // A health route in the first source file that has one (a bounded look).
    let health: { path: string; from: string } | undefined;
    for (const f of r.files.filter((f) => f.endsWith('.cs')).slice(0, 200)) {
      const p = healthRoute(r.read(f) ?? '');
      if (p) { health = { path: p, from: f }; break; }
    }
    values.health = health?.path ?? '/';
    stackApis.push({ repo: r.name, values });
    apiFacts.push({ repo: r.name, name, route, manifest: Boolean(a.manifest) });
    if (a.manifest) findings.push({ repo: r.name, role: 'api', text: `okteto: dev name ${name}, forwards ${forwards.length ? forwards.map((f) => `${f.local}→${f.remote ?? f.local}`).join(', ') : 'nothing (8080 assumed)'}; the container port is ${appPort}`, from: a.manifest });
    else findings.push({ repo: r.name, role: 'api', text: `no okteto.yml${a.csproj ? ': runs with dotnet' : a.node ? ': runs with npm' : ''}; the container port is assumed to be 8080`, asked: true });
    if (a.csproj) findings.push({ repo: r.name, role: 'api', text: `project in ${a.csproj}`, from: `${a.csproj}/*.csproj` });
    findings.push(health ? { repo: r.name, role: 'api', text: `ready when ${health.path} answers`, from: health.from } : { repo: r.name, role: 'api', text: 'no health route found: ready when / answers (a 404 counts)', asked: true });
  }

  // The template: okteto when any API has a manifest; else dotnet or npm.
  const withManifest = apiFacts.filter((a) => a.manifest);
  const steps = withManifest.length
    ? ['wait:http:{{port}}{{health}} forward:{{port}}:{{appPort}} okteto up', 'stop: okteto down']
    : apis.some((a) => a.csproj)
      ? ['wait:http:{{port}}{{health}} ASPNETCORE_URLS=http://localhost:{{port}} dotnet run --project {{dir}}']
      : ['wait:http:{{port}}{{health}} PORT={{port}} npm start'];
  if (withManifest.length) {
    findings.push({ repo: '', role: 'stack', text: 'anything your team runs before okteto up (a helper that writes the manifest and deploys the branch) goes first in api.steps', asked: true });
    for (const a of apiFacts.filter((x) => !x.manifest)) findings.push({ repo: a.repo, role: 'api', text: 'has no okteto.yml, but the template runs okteto up there too: add one, or give the API its own steps', asked: true });
  }
  if (stackApis.length && !apis.some((a) => a.csproj) && !withManifest.length) findings.push({ repo: '', role: 'stack', text: 'the APIs are node apps: the template runs npm start with PORT set', asked: true });

  // The UI, its proxy file and the route per API from the rules it already has.
  let uiPart: Stack['ui'];
  let apiProxy: Record<string, unknown> | undefined;
  if (ui) {
    const r = ui.repo;
    const proxyFile = ui.serve.proxyFile && r.files.includes(ui.serve.proxyFile.replace(/^\.\//, '')) ? ui.serve.proxyFile.replace(/^\.\//, '') : r.files.find((f) => /(^|\/)proxy\.conf\.(json|js|mjs|cjs)$/.test(f));
    findings.push({ repo: r.name, role: 'ui', text: `serves with ${ui.serve.command.replace(/ --proxy-config \{\{proxy\}\}| --proxyConfig=\{\{proxy\}\}/, proxyFile ? '$&' : '')}${ui.serve.port ? ` (its own port is ${ui.serve.port})` : ''}`, from: ui.serve.from });
    if (ui.serve.path) findings.push({ repo: r.name, role: 'ui', text: `the app lives at ${ui.serve.path} (its baseHref): the URL opens there`, from: ui.serve.from });
    if (ui.serve.others?.length) findings.push({ repo: r.name, role: 'ui', text: `the repo can also serve ${ui.serve.others.join(', ')}: to start one of those instead, name it in the serve step`, asked: true });
    let rules: Record<string, unknown> | undefined;
    if (proxyFile && /\.json$/.test(proxyFile)) {
      try { rules = readLooseJson(r.read(proxyFile) ?? ''); findings.push({ repo: r.name, role: 'ui', text: `proxy rules: ${Object.keys(rules).join(', ') || 'none'}`, from: proxyFile }); } catch { findings.push({ repo: r.name, role: 'ui', text: `${proxyFile} couldn’t be read as JSON: the picked APIs can’t be put in it`, from: proxyFile, asked: true }); }
    } else if (proxyFile) {
      findings.push({ repo: r.name, role: 'ui', text: `${proxyFile} is code, not JSON: only JSON proxy files can be pointed at the APIs`, from: proxyFile, asked: true });
    } else {
      findings.push({ repo: r.name, role: 'ui', text: 'no proxy file found: the UI starts without one (the APIs you pick aren’t reached through it)', asked: true });
    }
    const command = proxyFile && rules ? ui.serve.command : ui.serve.command.replace(/ --proxy-config \{\{proxy\}\}| --proxyConfig=\{\{proxy\}\}/, '');
    uiPart = { repo: r.name, ...(proxyFile && rules ? { proxyFile } : {}), steps: ['if not exist node_modules npm install', command], url: 'http://localhost:{{uiPort}}', ...(ui.serve.path ? { path: ui.serve.path } : {}) };
    if (rules) {
      for (const a of apiFacts) {
        const key = ruleFor(rules, a);
        const api = stackApis.find((x) => x.repo === a.repo)!;
        if (!key) { findings.push({ repo: a.repo, role: 'api', text: `no rule in ${proxyFile} names it: it gets the template rule with route "${a.route}"`, asked: true }); continue; }
        const t = templateRule(key, rules[key], a.route);
        if (!apiProxy) { apiProxy = { [t.key]: t.rule }; findings.push({ repo: a.repo, role: 'api', text: `proxied by the rule ${key} (the template for every API)`, from: proxyFile }); continue; }
        if (JSON.stringify(apiProxy) === JSON.stringify({ [t.key]: t.rule })) { findings.push({ repo: a.repo, role: 'api', text: `proxied by the rule ${key}`, from: proxyFile }); continue; }
        // A rule of another shape: this API's own, kept as written with the port templated.
        api.proxy = { [key]: templateRule(key, rules[key], '\u0000').rule };
        findings.push({ repo: a.repo, role: 'api', text: `proxied by its own rule ${key}`, from: proxyFile });
      }
    }
  } else if (stackApis.length) {
    findings.push({ repo: '', role: 'stack', text: 'no UI found (angular.json, project.json or a package.json with a dev server): the APIs run alone', asked: true });
  }
  if (!stackApis.length && !uiPart) return { findings };
  findings.push({ repo: '', role: 'stack', text: 'environments: dev (the default) and uat; change choose.env if yours differ', asked: true });
  const stack: Stack = {
    choose: { env: ['dev', 'uat'] },
    api: { steps, proxy: apiProxy ?? { '/api/{{route}}/**': { target: 'http://localhost:{{port}}', secure: false, changeOrigin: true } } },
    apis: stackApis,
    ...(uiPart ? { ui: uiPart } : {}),
  };
  return { stack, findings };
}

/**
 * A repo added to a card later (c) joins the workspace's stack when its files say it is an API the
 * stack doesn't have, or the UI when the stack has none: the picker then offers it. Returns the
 * stack to save and one line saying so, or nothing when there is nothing to add.
 */
export function addRepoToStack(stack: Stack, repo: RepoFiles): { stack: Stack; said: string } | undefined {
  const d = detectStack([repo]);
  if (!d.stack) return undefined;
  const from = [...new Set(d.findings.filter((f) => f.repo === repo.name && f.from).map((f) => f.from!.split('/').pop()!))].join(', ');
  const api = d.stack.apis.find((a) => a.repo === repo.name);
  if (api) {
    if (stack.apis.some((a) => a.repo.toLowerCase() === repo.name.toLowerCase())) return undefined;
    return { stack: { ...stack, apis: [...stack.apis, api] }, said: `Added ${repo.name} to the workspace’s stack as an API${from ? ` (from its ${from})` : ''}: t can start it` };
  }
  if (d.stack.ui && !stack.ui) {
    return { stack: { ...stack, ui: d.stack.ui }, said: `Added ${repo.name} to the workspace’s stack as its UI${from ? ` (from its ${from})` : ''}` };
  }
  return undefined;
}

/** The %NAMES% a stack's steps read from the environment (config.env), for the doctor. */
export function envNamesIn(stack: Stack): string[] {
  const out = new Set<string>();
  for (const line of [...stack.api.steps, ...(stack.ui?.steps ?? [])]) for (const m of line.matchAll(/%([A-Za-z_][A-Za-z0-9_{}]*)%/g)) out.add(m[1]);
  return [...out];
}
