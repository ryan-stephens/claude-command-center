// A service's health on the Switchboard, from its run and a probe of its port every few seconds:
// starting while its steps run, up while its port answers, unhealthy once a service that was up
// stops answering twice in a row, failed when its run failed, stopped when it was stopped. Pure.

import type { CardRun } from '../../shared/recipes.ts';
import type { Health } from '../shared/types.ts';

export interface Track {
  health: Health;
  since: number;
  /** Probes in a row that found nothing listening. */
  misses: number;
  /** When the port last answered. */
  lastOk?: number;
  note?: string;
}

export const MISSES_FOR_UNHEALTHY = 2;

/** The next health of a service: its run as it is now, and the probe's answer when one was made (undefined: not probed). */
export function nextHealth(prev: Track | undefined, run: Pick<CardRun, 'state' | 'text' | 'steps'> | undefined, answered: boolean | undefined, now: number): Track {
  const to = (health: Health, extra: Partial<Track> = {}): Track => ({
    health, since: prev?.health === health ? prev.since : now, misses: 0, ...(prev?.lastOk ? { lastOk: prev.lastOk } : {}), ...extra,
  });
  if (!run) return to('stopped');
  if (run.state === 'failed') return to('failed', { note: run.text });
  if (run.state === 'stopped' || run.state === 'done') return to('stopped');
  if (run.state === 'running') {
    const compiling = run.steps.some((s) => s.waitNote === 'compiling…');
    return to('starting', compiling ? { note: 'compiling' } : {});
  }
  // up: the probe says whether it still answers.
  if (answered === undefined || answered) return to('up', answered ? { lastOk: now } : {});
  const misses = (prev?.misses ?? 0) + 1;
  const quiet = prev?.lastOk ? Math.round((now - prev.lastOk) / 1000) : undefined;
  if (misses >= MISSES_FOR_UNHEALTHY) return { ...to('unhealthy', { note: quiet ? `no answer ${quiet} s` : 'no answer' }), misses };
  return { ...(prev ?? to('up')), misses };
}
