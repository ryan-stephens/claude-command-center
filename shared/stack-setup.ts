// The stack set up as a form (PLAN §83), not as JSON: the environments, the UI, each API with
// the few values the template needs, and how an API starts on the team's dev environment as
// three plain answers (the command that makes its deployment, what runs inside the container,
// whether a kubeconfig per environment is used) from which the step lines are written. Pure and
// tested; the sheet (web/components/StackSetup.tsx) draws it and the server saves the stack it makes.

import { routeGuess, validateStack, type Stack, type StackApi } from './stack.ts';

/** How an API starts on the dev environment, in plain answers. The lines are written from these. */
export interface SetupKnobs {
  /** Run before okteto up, in PowerShell: the team's command that makes the API's deployment for the branch ({{name}}, {{env}}, {{deployment}} fill in). Empty: nothing. */
  deploy: string;
  /** Lines typed into the deploy command's questions, comma-separated ("y,n"); empty: it asks nothing. */
  answers: string;
  /** What runs inside the container once okteto is up ({{dir}} fills in); empty: okteto up alone starts the app. */
  run: string;
  /** Put KUBECONFIG=%KUBECONFIG_<ENV>% before every command (a kubeconfig per environment in config.env). */
  kubeconfig: boolean;
  /** On stop, also delete the deployment from this namespace ({{env}} fills in); empty: okteto down alone. */
  teardown: string;
}

export const DEFAULT_KNOBS: SetupKnobs = { deploy: '', answers: '', run: 'cd {{dir}} && dotnet watch run', kubeconfig: true, teardown: '' };

export interface SetupApi {
  repo: string;
  /** Part of the stack (a lane repo that isn't ticked is left out). */
  on: boolean;
  name: string;
  appPort: string;
  dir: string;
  health: string;
  route: string;
}

export interface SetupForm {
  /** The environments t offers, the first the default. */
  envs: string[];
  ui?: { repo: string; proxyFile: string; start: string; url: string; path: string };
  apis: SetupApi[];
  knobs: SetupKnobs;
  /** The API's step lines: written from the knobs, or kept as they are when `custom`. */
  steps: string[];
  custom: boolean;
  /** The proxy rule each API adds, as JSON text ({{route}} and {{port}} fill in); empty: none. */
  proxyRule: string;
}

const KC = 'KUBECONFIG=%KUBECONFIG_{{ENV}}% ';

/** The step lines the knobs mean. */
export function apiStepsFrom(k: SetupKnobs): string[] {
  const kc = k.kubeconfig ? KC : '';
  const out: string[] = [];
  const deploy = k.deploy.trim();
  const run = k.run.trim();
  const answers = k.answers.split(',').map((a) => a.trim()).filter(Boolean);
  if (deploy) out.push(`ps: ${answers.length ? `answers:"${answers.join(',')}" ` : ''}${kc}${deploy}`);
  out.push(run ? `wait:port:{{port}} ${kc}okteto up` : `wait:http:{{port}}{{health}} ${kc}okteto up`);
  if (run) out.push(`wait:http:{{port}}{{health}} ${kc}okteto exec -- sh -c "${run.replace(/"/g, '\\"')}"`);
  out.push(`stop: ${kc}okteto down`);
  const ns = k.teardown.trim();
  if (ns) out.push(`stop: ${kc}kubectl delete deployment {{deployment}} -n ${ns}`);
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KC_RE = esc(KC.trim()) + '\\s+';

/** The knobs that wrote these lines, or undefined when they weren't written by apiStepsFrom (edited by hand, or an older stack). */
export function knobsFromSteps(steps: string[]): SetupKnobs | undefined {
  const lines = steps.map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return undefined;
  let i = 0;
  const k: SetupKnobs = { deploy: '', answers: '', run: '', kubeconfig: false, teardown: '' };
  let kcSeen: boolean | undefined;
  const kc = (m: string | undefined) => { const has = Boolean(m); if (kcSeen === undefined) kcSeen = has; else if (kcSeen !== has) throw new Error('mixed'); };
  try {
    let m = new RegExp(`^ps:\\s+(?:answers:"([^"]*)"\\s+)?(${KC_RE})?(.+)$`).exec(lines[i]);
    if (m && !/okteto up/.test(m[3])) { k.answers = m[1] ?? ''; kc(m[2]); k.deploy = m[3].trim(); i++; }
    m = new RegExp(`^wait:(port:\\{\\{port\\}\\}|http:\\{\\{port\\}\\}\\{\\{health\\}\\})\\s+(${KC_RE})?okteto up$`).exec(lines[i] ?? '');
    if (!m) return undefined;
    kc(m[2]);
    const hasRun = m[1].startsWith('port');
    i++;
    if (hasRun) {
      m = new RegExp(`^wait:http:\\{\\{port\\}\\}\\{\\{health\\}\\}\\s+(${KC_RE})?okteto exec -- sh -c "(.*)"$`).exec(lines[i] ?? '');
      if (!m) return undefined;
      kc(m[1]);
      k.run = m[2].replace(/\\"/g, '"');
      i++;
    }
    m = new RegExp(`^stop:\\s+(${KC_RE})?okteto down$`).exec(lines[i] ?? '');
    if (!m) return undefined;
    kc(m[1]);
    i++;
    if (i < lines.length) {
      m = new RegExp(`^stop:\\s+(${KC_RE})?kubectl delete deployment \\{\\{deployment\\}\\} -n (\\S+)$`).exec(lines[i]);
      if (!m) return undefined;
      kc(m[1]);
      k.teardown = m[2];
      i++;
    }
    if (i !== lines.length) return undefined;
  } catch { return undefined; }
  k.kubeconfig = Boolean(kcSeen);
  return k;
}

const DEFAULT_RULE = { '/api/{{route}}/**': { target: 'http://localhost:{{port}}', secure: false, changeOrigin: true } };

function apiRow(a: StackApi | undefined, repo: string, on: boolean): SetupApi {
  const v = a?.values ?? {};
  return { repo, on, name: v.name ?? repo.toLowerCase(), appPort: v.appPort ?? v.port ?? '8080', dir: v.dir ?? '', health: v.health ?? '/', route: v.route ?? routeGuess(repo) };
}

/**
 * The form for a lane: from its saved stack when it has one (every lane repo listed, the ones in
 * the stack ticked), else from what the repos say (`detected`), else a bare draft. The knobs are
 * read back from the steps when the steps were written by them; otherwise the lines are kept as
 * they are and marked custom.
 */
export function formFromStack(stack: Stack | undefined, detected: Stack | undefined, laneRepos: string[]): SetupForm {
  const base = stack ?? detected;
  const uiRepo = base?.ui?.repo;
  const byRepo = new Map((base?.apis ?? []).map((a) => [a.repo.toLowerCase(), a]));
  const det = new Map((detected?.apis ?? []).map((a) => [a.repo.toLowerCase(), a]));
  const names = [...new Set([...laneRepos, ...(base?.apis ?? []).map((a) => a.repo)])].filter((r) => r.toLowerCase() !== uiRepo?.toLowerCase());
  const apis = names.map((r) => apiRow(byRepo.get(r.toLowerCase()) ?? det.get(r.toLowerCase()), r, byRepo.has(r.toLowerCase()) || (!stack && det.has(r.toLowerCase()))));
  const steps = base?.api.steps ?? [];
  const knobs = steps.length ? knobsFromSteps(steps) : undefined;
  const envs = base ? Object.values(base.choose)[0] ?? ['dev', 'uat'] : ['dev', 'uat'];
  const rule = base?.api.proxy ?? (base ? undefined : DEFAULT_RULE);
  return {
    envs,
    ...(base?.ui ? { ui: { repo: base.ui.repo, proxyFile: base.ui.proxyFile ?? '', start: base.ui.steps.join('\n'), url: base.ui.url ?? '', path: base.ui.path ?? '' } } : {}),
    apis,
    knobs: knobs ?? (steps.length ? { ...DEFAULT_KNOBS, run: '' } : DEFAULT_KNOBS),
    steps: steps.length ? steps : apiStepsFrom(DEFAULT_KNOBS),
    custom: steps.length > 0 && !knobs,
    proxyRule: rule ? JSON.stringify(rule, null, 2) : '',
  };
}

/** The stack the form means, checked (throws what's wrong, in the form's words). */
export function stackFromForm(f: SetupForm): Stack {
  const envs = f.envs.map((e) => e.trim()).filter(Boolean);
  if (!envs.length) throw new Error('Name at least one environment (dev, uat).');
  const apis = f.apis.filter((a) => a.on);
  if (!apis.length && !f.ui) throw new Error('Tick at least one API, or pick the UI repo.');
  for (const a of apis) {
    if (!a.name.trim()) throw new Error(`${a.repo} needs its name on the dev environment.`);
    if (!/^\d{2,5}$/.test(a.appPort.trim())) throw new Error(`${a.repo}’s container port should be a number (8080).`);
  }
  let proxy: Record<string, unknown> | undefined;
  if (f.proxyRule.trim()) {
    try { proxy = JSON.parse(f.proxyRule) as Record<string, unknown>; } catch (e) { throw new Error(`The proxy rule isn’t valid JSON: ${(e as Error).message}`); }
  }
  const steps = f.custom ? f.steps : apiStepsFrom(f.knobs);
  if (apis.length && !steps.length) throw new Error('Say how an API starts.');
  if (steps.some((s) => /\{\{\s*dir\s*\}\}/.test(s)) && apis.some((a) => !a.dir.trim())) throw new Error(`${apis.find((a) => !a.dir.trim())!.repo} needs its project folder: the steps use {{dir}}.`);
  const raw = {
    choose: { env: envs },
    api: { steps, ...(proxy ? { proxy } : {}) },
    apis: apis.map((a) => ({ repo: a.repo, values: { name: a.name.trim(), appPort: a.appPort.trim(), ...(a.dir.trim() ? { dir: a.dir.trim() } : {}), health: a.health.trim() ? (a.health.trim().startsWith('/') ? a.health.trim() : `/${a.health.trim()}`) : '/', route: a.route.trim() || routeGuess(a.repo) } })),
    ...(f.ui && f.ui.repo ? { ui: { repo: f.ui.repo, ...(f.ui.proxyFile.trim() ? { proxyFile: f.ui.proxyFile.trim() } : {}), steps: f.ui.start.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), ...(f.ui.url.trim() ? { url: f.ui.url.trim() } : {}), ...(f.ui.path.trim() ? { path: f.ui.path.trim() } : {}) } } : {}),
  };
  return validateStack(raw);
}
