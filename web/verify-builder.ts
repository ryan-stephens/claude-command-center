// The Verify panel's test-data section (PLAN §133): the scenario runner's list, the one chosen, a
// run and how it goes. Kept from card to card (it isn't any card's), in this page's memory only:
// loan ids and step messages are never saved, logged or given to Claude.

import { create } from 'zustand';
import { ENV_NAME, type BuilderEnv, type BuilderRun, type BuilderScenario } from '../shared/verify.ts';
import { flash } from './store.ts';
import { ARM_MS, armed, POLL_MS, runPhase, visibleScenarios, type RunPhase } from './verify-model.ts';
import { cap, fetchInLookup, toolName, useVerify } from './verify-state.ts';
import { builderList, builderStart, builderStatus } from './ws.ts';

export interface BuilderState {
  scenarios?: BuilderScenario[];
  loading: boolean;
  /** Why the list couldn't be read (the tool isn't running, say). */
  error?: string;
  /** The tool answered the last time it was asked (the tab's dot); undefined before it was. */
  up?: boolean;
  filter: string;
  /** The scenario chosen, by id. */
  sel: string | null;
  /** The first Enter on a scenario (a second within ARM_MS runs it). */
  arm: { key: string; at: number } | null;
  starting: boolean;
  /** The run started last, what it is called, and how it ended. */
  run?: BuilderRun & { name: string; startedAt: number };
  phase?: RunPhase;
  runError?: string;
}

export const useBuilder = create<BuilderState>(() => ({ loading: false, filter: '', sel: null, arm: null, starting: false }));
const put = (p: Partial<BuilderState>) => useBuilder.setState(p);

/** The scenarios the filter leaves. */
export function shownScenarios(s = useBuilder.getState()): BuilderScenario[] {
  return visibleScenarios(s.scenarios ?? [], s.filter);
}

/** The scenario chosen, or the first shown. */
export function chosenScenario(s = useBuilder.getState()): BuilderScenario | undefined {
  const shown = shownScenarios(s);
  return shown.find((x) => x.id === s.sel) ?? shown[0];
}

/** r, or the section opened the first time: read the scenarios again. */
export async function loadScenarios(): Promise<void> {
  if (useBuilder.getState().loading) return;
  put({ loading: true, error: undefined });
  try {
    const scenarios = await builderList();
    put({ scenarios, up: true });
  } catch (e) {
    put({ error: (e as Error).message, up: false });
  } finally {
    put({ loading: false });
  }
}

export function setBuilderFilter(filter: string): void { put({ filter, arm: null }); }

/** ↑ ↓ (or j k): the scenario before or after. */
export function moveScenario(delta: number): void {
  const shown = shownScenarios();
  if (!shown.length) return;
  const at = Math.max(0, shown.findIndex((x) => x.id === chosenScenario()?.id));
  put({ sel: shown[Math.max(0, Math.min(shown.length - 1, at + delta))].id, arm: null });
}

export function chooseScenario(id: string): void { put({ sel: id, arm: null }); }

/** The environment a run goes to: the panel's, Dev or UAT (never Prod). */
export function runEnv(): BuilderEnv {
  return useVerify.getState().env === 'uat' ? 'uat' : 'dev';
}

/**
 * Enter (or Run): the first press arms it and says what it will do; a second within four seconds,
 * on the same scenario, starts a run. A run creates real loans in Dev or UAT.
 */
export async function runScenarioKey(now = Date.now()): Promise<void> {
  const s = useBuilder.getState();
  const sc = chosenScenario(s);
  if (!sc) { flash(s.error ?? `No scenario to run: r reads ${toolName('builder')}’s list`); return; }
  if (s.starting || s.phase === 'poll') { flash('A run is going: wait for it to end'); return; }
  const env = runEnv();
  const key = `${sc.id}@${sc.version}@${env}`;
  if (!armed(s.arm, key, now)) {
    put({ arm: { key, at: now } });
    setTimeout(() => { if (useBuilder.getState().arm?.at === now) put({ arm: null }); }, ARM_MS);
    flash(`Enter again to create a loan in ${ENV_NAME[env]} with ${sc.name}`);
    return;
  }
  put({ arm: null, starting: true, runError: undefined, phase: undefined, run: undefined });
  try {
    const runId = await builderStart(env, sc.id, sc.version);
    const startedAt = Date.now();
    put({ run: { runId, env, status: 'running', steps: [], recordIds: [], name: sc.name, startedAt }, phase: 'poll' });
    flash(`Running ${sc.name} in ${ENV_NAME[env]}`);
    void poll(runId, startedAt, 0);
  } catch (e) {
    put({ runError: (e as Error).message });
  } finally {
    put({ starting: false });
  }
}

/** Ask how the run is going every POLL_MS until it ends, times out or the tool stops answering. */
async function poll(runId: string, startedAt: number, errors: number): Promise<void> {
  await new Promise((r) => setTimeout(r, POLL_MS));
  if (useBuilder.getState().run?.runId !== runId) return;
  let status: BuilderRun['status'] | undefined;
  try {
    const run = await builderStatus(runId);
    if (useBuilder.getState().run?.runId !== runId) return;
    const was = useBuilder.getState().run!;
    put({ run: { ...run, name: was.name, startedAt: was.startedAt } });
    status = run.status;
    errors = 0;
  } catch (e) {
    errors += 1;
    put({ runError: (e as Error).message });
  }
  const phase = runPhase(status, errors, startedAt, Date.now());
  put({ phase, ...(phase === 'poll' || phase === 'error' ? {} : { runError: undefined }) });
  if (phase === 'poll') { void poll(runId, startedAt, errors); return; }
  const run = useBuilder.getState().run;
  if (phase === 'succeeded') flash(`${run?.name}: done, ${run?.recordIds.length ?? 0} loan${run?.recordIds.length === 1 ? '' : 's'} in ${ENV_NAME[run?.env ?? 'dev']}. f fetches it in ${toolName('lookup')}`);
  else if (phase === 'failed') flash(`${run?.name}: failed`);
  else if (phase === 'timeout') flash(`${run?.name}: still running after 15 minutes; see ${toolName('builder')}’s page (o)`);
}

/** Shift+Y: the loan ids the run made, to the clipboard. */
export function copyRunIds(): void {
  const ids = useBuilder.getState().run?.recordIds ?? [];
  if (!ids.length) { flash('No loan yet: run a scenario first'); return; }
  navigator.clipboard?.writeText(ids.join('\n')).then(() => flash(`Copied ${ids.length} loan id${ids.length === 1 ? '' : 's'}`), () => flash('The clipboard said no'));
}

/** f: the loan the run made, fetched in the record lookup (its environment, the current list). */
export function fetchRunLoan(i = 0): void {
  const run = useBuilder.getState().run;
  const id = run?.recordIds[i];
  if (!run || !id) { flash(`No loan yet: run a scenario first, then f fetches it in ${toolName('lookup')}`); return; }
  fetchInLookup(id, run.env, run.name);
  flash(`${cap(toolName('lookup'))}: ${run.name}’s loan in ${ENV_NAME[run.env]}`);
}
