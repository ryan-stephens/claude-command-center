// Run recipes: how to start a repo's app so a card's change can be tried (the Try it column).
// Detected from package.json / compose.yaml (server/recipes.ts) or written by hand, and run by the
// server as child processes in the card's folder. Pure and shared, so the drawer, the packet text
// and the server say the same thing.

import { repoName, samePath } from './workspaces.ts';

export interface RunRecipe {
  /** The repo it belongs to (absolute path). */
  repo: string;
  /** Shell commands, run in order in the card's folder. */
  steps: string[];
  /** Where the app will be, when it can be told in advance; otherwise read from the app's output. */
  url?: string;
  /** "detected from package.json", "written by you". */
  source: string;
  /** True when you wrote or edited it (saved on the server, kept over what is detected). */
  edited?: boolean;
}

/**
 * One step of a run. wait: not started · go: running · ok: finished well · up: still running and
 * serving (the app) · bad: failed · off: stopped, or the app exited.
 */
export interface RunStep {
  cmd: string;
  state: 'wait' | 'go' | 'ok' | 'up' | 'bad' | 'off';
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
}

/** The recipe for a repo, from a map keyed by path (paths compared as Windows does). */
export function recipeFor(recipes: Record<string, RunRecipe>, repo: string | undefined): RunRecipe | undefined {
  if (!repo) return undefined;
  return recipes[repo] ?? Object.values(recipes).find((r) => samePath(r.repo, repo));
}

/** The line in the workspace layer of the packet: "Run recipe: pnpm install, pnpm dev". */
export function recipeLabel(r: RunRecipe): string {
  return `Run recipe: ${r.steps.join(', ')}`;
}

/** What Claude is told about running the app, under "## Running the app". */
export function recipeText(r: RunRecipe): string {
  return `In ${repoName(r.repo)}: ${r.steps.join(' && ')}${r.url ? `, then open ${r.url}` : ''}. cc-control runs this when you press Try it; don't leave a copy of the app running.`;
}

/**
 * A URL the app printed: "Local: http://localhost:5173/". 0.0.0.0 and [::] mean this machine, so
 * they become localhost. Colour codes are stripped first.
 */
export function findUrl(line: string): string | undefined {
  // eslint-disable-next-line no-control-regex
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

/** A recipe typed in the editor: one command per line, blank lines dropped. */
export function parseSteps(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 12);
}
