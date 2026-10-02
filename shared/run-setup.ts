// How a single repo runs, as a form (PLAN §86): the command that starts it, an optional install
// step before it, where it serves, and what runs when it is stopped. The step lines are written
// from these four answers; lines that don't fit that shape (a @repo prefix, a wait:, several
// commands) are kept as they are and marked custom, so nothing anyone wrote is lost. Pure and
// tested; the sheet (web/components/RunSetup.tsx) draws it.

import { parseStep, type RunRecipe } from './recipes.ts';

export interface RunForm {
  /** Runs first, once (an install); empty: nothing. */
  install: string;
  /** The command that starts the app and keeps running. */
  start: string;
  /** Where it serves, when it can be said in advance; empty: read from what it prints. */
  url: string;
  /** Runs when the app is stopped; empty: nothing. */
  stop: string;
  /** The step lines as they are (written from the answers, or kept when `custom`). */
  steps: string[];
  custom: boolean;
}

/** The step lines the answers mean. */
export function stepsFromRun(f: Pick<RunForm, 'install' | 'start' | 'stop'>): string[] {
  const out: string[] = [];
  if (f.install.trim()) out.push(f.install.trim());
  if (f.start.trim()) out.push(f.start.trim());
  if (f.stop.trim()) out.push(`stop: ${f.stop.trim()}`);
  return out;
}

/** A line the form can show as an answer: a bare command, nothing else on it. */
function plain(line: string): boolean {
  const s = parseStep(line);
  return Boolean(s && !s.note && !s.repo && !s.ps && !s.wait && !s.answers && s.forward === undefined && !Object.keys(s.env).length);
}

/**
 * The answers these lines mean, or undefined when they weren't written that way: more than two
 * commands before the app, more than one stop line, or anything on a line besides the command.
 */
export function runFromSteps(steps: string[]): Pick<RunForm, 'install' | 'start' | 'stop'> | undefined {
  const lines = steps.map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  if (!lines.length || !lines.every(plain)) return undefined;
  const run = lines.filter((l) => !parseStep(l)!.stop);
  const stop = lines.filter((l) => parseStep(l)!.stop);
  if (run.length > 2 || stop.length > 1 || !run.length) return undefined;
  // The stop line comes after the others, or the shape isn't the form's.
  if (stop.length && lines[lines.length - 1] !== stop[0]) return undefined;
  return { install: run.length === 2 ? run[0] : '', start: run[run.length - 1], stop: stop[0] ? parseStep(stop[0])!.cmd : '' };
}

/** The form for a repo: from what it has (written, or detected), else empty. */
export function runFormFrom(recipe: RunRecipe | undefined): RunForm {
  const steps = recipe?.steps ?? [];
  const answers = steps.length ? runFromSteps(steps) : undefined;
  return {
    install: answers?.install ?? '',
    start: answers?.start ?? '',
    url: recipe?.url ?? '',
    stop: answers?.stop ?? '',
    steps,
    custom: steps.length > 0 && !answers,
  };
}

/** What to save for the form: the lines and the address, checked. Throws what's wrong, in the form's words. */
export function runFromForm(f: RunForm): { steps: string[]; url?: string } {
  const steps = f.custom ? f.steps.map((s) => s.trim()).filter(Boolean) : stepsFromRun(f);
  if (!steps.some((s) => { const p = parseStep(s); return p && !p.stop && !p.note; })) throw new Error('Say what starts the app.');
  const url = f.url.trim();
  if (url && !/^https?:\/\/\S+$/.test(url)) throw new Error('Where it serves should look like http://localhost:5173.');
  return { steps, ...(url ? { url } : {}) };
}
