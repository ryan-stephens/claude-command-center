// Run recipes: how to start the app so a card's change can be tried (the Try it column). A repo's
// recipe is detected from package.json / compose.yaml (server/recipes.ts) or written by hand; a
// workspace can have its own, spanning its repos (an Okteto backend, then the UI pointed at it).
// The server runs it as child processes. Pure and shared, so the drawer, the packet text and the
// server say the same thing.
//
// A step is one line: `[stop:] [ps:] [wait:…] [forward:…] [answers:…] [@repo] [NAME=value …] command`,
// or `! something to do by hand`. The prefixes come in any order. @repo runs it in that repo (the
// card's folder for its own repo); NAME=value sets the step's environment (parsed here, so it works
// in cmd.exe too); stop: lines run when the app is stopped; ps: runs it in PowerShell instead of cmd;
// wait:"text", wait:port:8080 or wait:http:8080/health says when a step that keeps running is ready;
// forward:18000:8080 runs an okteto command with a copy of the folder's okteto.yml whose forward of
// container port 8080 is local port 18000 (shared/okteto.ts), so two runs of one API never want the
// same port (a stack's okteto up gets it on its own when a port is picked; forward:no keeps the
// manifest's own forward); answers:"y,n" types those lines into the questions it asks; lines
// starting with # are comments.

import { stackText, type Stack } from './stack.ts';
import { repoName, samePath } from './workspaces.ts';

export interface RunRecipe {
  /** The repo it belongs to (absolute path); empty for a workspace's recipe. */
  repo: string;
  /** Set for a workspace's recipe. */
  workspaceId?: string;
  /** The step lines, as written (see parseStep). */
  steps: string[];
  /** Where the app will be, when it can be told in advance; otherwise read from the app's output. */
  url?: string;
  /** "detected from package.json", "written by you". */
  source: string;
  /** True when you wrote or edited it (saved on the server, kept over what is detected). */
  edited?: boolean;
  /** Set when the workspace's recipe is its stack: the steps come from what t picks (shared/stack.ts). */
  stack?: Stack;
}

/**
 * One step of a run. wait: not started · go: running · ok: finished well · up: still running and
 * serving (the app) · bad: failed · off: stopped, or the app exited.
 */
export interface RunStep {
  cmd: string;
  /** note: something you do by hand; shown, never run. */
  state: 'wait' | 'go' | 'ok' | 'up' | 'bad' | 'off' | 'note';
  /** The repo it runs in, when the line named one. */
  repo?: string;
  /** Names of the variables the line sets (never the values: they can be secrets). */
  env?: string[];
  /** Runs when the app is stopped. */
  stop?: boolean;
  /** What it waits for before the next step starts: "Now listening on", "port 8080", "http://localhost:8080/self". */
  waitFor?: string;
  /** While it waits on an address: what the last try got ("no answer yet", "answered 503"). */
  waitNote?: string;
  /** Exit code, once it exited. */
  code?: number | null;
  /** The last lines it printed. */
  tail: string[];
}

/** A card's run of its recipe: running · up (the app is serving) · done (every step finished) · failed · stopped. */
export interface CardRun {
  cardId: string;
  repo: string;
  cwd: string;
  steps: RunStep[];
  state: 'running' | 'up' | 'done' | 'failed' | 'stopped';
  url?: string;
  startedAt: number;
  /** One line for the drawer and the tile: "Running at http://localhost:5173", "pnpm install failed (exit 1)". */
  text: string;
  /** What was picked when it started, for a workspace's stack: "dev · orders-api, fees-api". */
  choice?: string;
}

/** The page keeps workspaces' recipes in the same map, under this key. */
export const wsRecipeKey = (workspaceId: string) => `ws:${workspaceId}`;

/** The recipe a card runs: its workspace's when there is one, else the one for the repo it starts in. */
export function cardRecipe(recipes: Record<string, RunRecipe>, workspaceId: string | null, home: string | undefined): RunRecipe | undefined {
  return (workspaceId ? recipes[wsRecipeKey(workspaceId)] : undefined) ?? recipeFor(recipes, home);
}

/** The recipe for a repo, from a map keyed by path (paths compared as Windows does). */
export function recipeFor(recipes: Record<string, RunRecipe>, repo: string | undefined): RunRecipe | undefined {
  if (!repo) return undefined;
  return recipes[repo] ?? Object.values(recipes).find((r) => r.repo && samePath(r.repo, repo));
}

/** One step line, read. */
export interface StepSpec {
  line: string;
  /** The command (or, for a note, what to do). */
  cmd: string;
  repo?: string;
  env: Record<string, string>;
  stop: boolean;
  note: boolean;
  /** Run in PowerShell rather than cmd. */
  ps?: boolean;
  /**
   * When a step that keeps running is ready: a line containing this text, its port open, or this
   * address answering below 500 (a forwarded port can be open before the app behind it is).
   */
  wait?: { text: string } | { port: number } | { url: string };
  /** Run with a copy of the folder's okteto manifest forwarding `local` to the container's `remote` port (the first forward when unset); `false` (forward:no) keeps the manifest as it is. */
  forward?: { local: number; remote?: number } | false;
  /** Lines typed into the step's input, one per question it asks. */
  answers?: string[];
}

const ENV = /^([A-Za-z_][A-Za-z0-9_]*)=("([^"]*)"|'([^']*)'|(\S*))(\s+|$)/;

/** Read a step line: `[stop:] [ps:] [wait:…] [answers:…] [@repo] [NAME=value …] command`, or `! a note`. Comments (#) and blank lines give undefined. */
export function parseStep(line: string): StepSpec | undefined {
  let rest = line.trim();
  if (!rest || rest.startsWith('#')) return undefined;
  if (rest.startsWith('!')) return { line, cmd: rest.slice(1).trim(), env: {}, stop: false, note: true };
  let stop = false;
  let ps = false;
  let repo: string | undefined;
  let wait: StepSpec['wait'];
  let forward: StepSpec['forward'];
  let answers: string[] | undefined;
  // The prefixes, in any order, so a stack can put @repo in front of a line that starts with stop:.
  for (;;) {
    let m: RegExpExecArray | null;
    if ((m = /^stop:\s*/i.exec(rest))) stop = true;
    else if ((m = /^ps:\s*/i.exec(rest))) ps = true;
    else if ((m = /^wait:port:(\d{2,5})\s+/i.exec(rest))) wait = { port: Number(m[1]) };
    else if ((m = /^wait:http:(\d{2,5})(\/\S*)?\s+/i.exec(rest))) wait = { url: `http://localhost:${m[1]}${m[2] ?? '/'}` };
    else if ((m = /^wait:"([^"]+)"\s+/i.exec(rest))) wait = { text: m[1] };
    else if ((m = /^forward:(\d{2,5})(?::(\d{2,5}))?\s+/i.exec(rest))) forward = { local: Number(m[1]), ...(m[2] ? { remote: Number(m[2]) } : {}) };
    else if ((m = /^forward:no\s+/i.exec(rest))) forward = false;
    else if ((m = /^answers:"([^"]*)"\s+/i.exec(rest))) answers = m[1].split(',').map((a) => a.trim());
    else if ((m = /^@(\S+)\s+/.exec(rest))) repo = m[1];
    else break;
    rest = rest.slice(m[0].length);
  }
  const env: Record<string, string> = {};
  for (let m = ENV.exec(rest); m; m = ENV.exec(rest)) {
    env[m[1]] = m[3] ?? m[4] ?? m[5] ?? '';
    rest = rest.slice(m[0].length);
  }
  return {
    line, cmd: rest.trim(), ...(repo ? { repo } : {}), env, stop, note: false,
    ...(ps ? { ps } : {}), ...(wait ? { wait } : {}), ...(forward !== undefined ? { forward } : {}), ...(answers ? { answers } : {}),
  };
}

/** Does this command run `okteto up` (at its start, or after a `;`, `&&` or `|` in a one-line script)? */
export const OKTETO_UP = /(^|[\\/\s;&|])okteto(?:\.exe)?\s+up\b/i;

/** What a step waits for, as the drawer says it: "Now listening on", "port 8080", "http://localhost:8080/self". */
export function waitLabel(s: Pick<StepSpec, 'wait'>): string | undefined {
  if (!s.wait) return undefined;
  return 'port' in s.wait ? `port ${s.wait.port}` : 'url' in s.wait ? s.wait.url : s.wait.text;
}

/** The recipe's steps, read (comments dropped). */
export function specsOf(r: Pick<RunRecipe, 'steps'>): StepSpec[] {
  return r.steps.map(parseStep).filter((s): s is StepSpec => Boolean(s));
}

/** A step as the drawer and the packet show it: "@api okteto up", env values hidden. */
export function stepLabel(s: StepSpec): string {
  if (s.note) return s.cmd;
  const env = Object.keys(s.env).map((k) => `${k}=…`).join(' ');
  return [s.repo ? `@${s.repo}` : '', env, s.cmd].filter(Boolean).join(' ');
}

/** The line in the workspace layer of the packet: "Run recipe: pnpm install, pnpm dev". */
export function recipeLabel(r: RunRecipe): string {
  if (r.stack) return `Run: the workspace’s stack (APIs ${r.stack.apis.map((a) => a.repo).join(', ') || 'none'}${r.stack.ui ? `; UI ${r.stack.ui.repo}` : ''})`;
  return `Run recipe: ${specsOf(r).filter((s) => !s.stop && !s.note).map(stepLabel).join(', ')}`;
}

/** What Claude is told about running the app, under "## Running the app". */
export function recipeText(r: RunRecipe): string {
  if (r.stack) return stackText(r.stack);
  const specs = specsOf(r);
  const run = specs.filter((s) => !s.stop);
  const stop = specs.filter((s) => s.stop);
  const after = `${r.url ? `, then open ${r.url}` : ''}. cc-control runs this when you press Try it; don't leave a copy of the app running.`;
  if (!r.workspaceId && run.every((s) => !s.repo && !s.note && !Object.keys(s.env).length) && !stop.length) {
    return `In ${repoName(r.repo)}: ${run.map((s) => s.cmd).join(' && ')}${after}`;
  }
  const L = ['The workspace’s run recipe, in order:'];
  for (const s of run) L.push(s.note ? `- By hand: ${s.cmd}` : `- ${s.repo ? `in ${s.repo}: ` : ''}${Object.keys(s.env).length ? `(with ${Object.keys(s.env).join(', ')} set) ` : ''}${s.cmd}`);
  for (const s of stop) L.push(`- When stopping: ${s.repo ? `in ${s.repo}: ` : ''}${s.cmd}`);
  L.push(`Most of these keep running (the app)${after.replace(/^, then open/, '; then open')}`);
  return L.join('\n');
}

/**
 * A URL the app printed: "Local: http://localhost:5173/". 0.0.0.0 and [::] mean this machine, so
 * they become localhost. Colour codes are stripped first.
 */
export function findUrl(line: string): string | undefined {
  const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
  const m = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{2,5})?(?:\/[^\s'"`)\]]*)?/i.exec(clean);
  return m ? m[0].replace(/0\.0\.0\.0|\[::1?\]/, 'localhost').replace(/\/$/, '') : undefined;
}

/** The port in a URL, for checking the app is listening. */
export function portOf(url: string | undefined): number | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  } catch {
    return undefined;
  }
}

/** The most steps a recipe (or a stack's template) keeps: the editor, the server and the workspace file agree. */
export const MAX_STEPS = 20;

/** A recipe typed in the editor: one command per line, blank lines dropped. */
export function parseSteps(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, MAX_STEPS);
}
