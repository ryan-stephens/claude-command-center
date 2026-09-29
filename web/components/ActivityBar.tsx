import { useEffect, useState } from 'react';
import type { ActivityTask } from '../../shared/protocol.ts';
import { activityLine, duration, taskKind, taskRunning } from '../activity-label.ts';
import { NO_BINDINGS, useStore } from '../store.ts';
import { bindingsFor, displayCombo } from '../bindings.ts';
import { interrupt } from '../keys.ts';
import { send } from '../ws.ts';

/** Re-render every second while something is ticking. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const TONE = {
  busy: 'text-sky-300',
  attention: 'text-amber-300',
  warn: 'text-orange-300',
};

/**
 * What the session is doing right now, like Claude Code's spinner line, plus the subagents and
 * background shells it has running. Sits between the transcript and the composer.
 */
export function ActivityBar({ id }: { id: string }) {
  const activity = useStore((s) => s.activity[id]);
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  const backgroundKey = displayCombo(bindingsFor('background', bindings)[0] ?? '');
  const busy = Boolean(activity && (activity.phase !== 'idle' || activity.tasks.some(taskRunning)));
  const now = useNow(busy);
  const line = activityLine(activity, now);
  const tasks = activity?.tasks ?? [];
  if (!line && !tasks.length) return null;

  return (
    <div className="border-t border-zinc-800 px-4 py-2 text-xs" aria-live="polite">
      {tasks.length > 0 && (
        <ul className="mb-1.5 space-y-1">
          {tasks.map((t) => <TaskRow key={t.id} t={t} now={now} onStop={() => send({ type: 'task.stop', id, taskId: t.id })} />)}
        </ul>
      )}
      {line && (
        <div className="flex items-center gap-2">
          {line.tone === 'busy' && activity?.phase !== 'idle' ? <span className={`spinner ${TONE.busy}`} /> : <span className={TONE[line.tone]}>●</span>}
          <span className={`truncate ${TONE[line.tone]}`}>{line.text}</span>
          {line.elapsed && <span className="shrink-0 text-zinc-500">{line.elapsed}</span>}
          {line.turn && line.turn !== line.elapsed && <span className="shrink-0 text-zinc-600">· turn {line.turn}</span>}
          {activity && activity.phase !== 'idle' && (
            <span className="ml-auto flex shrink-0 gap-1.5">
              {activity.phase === 'tool' && (
                <button className="btn text-xs" onClick={() => send({ type: 'session.background', id })} title={`Let it keep running in the background and carry on (${backgroundKey})`}>
                  ⇲ Background <kbd className="hidden md:inline-block">{backgroundKey}</kbd>
                </button>
              )}
              <button className="btn text-xs text-red-300" onClick={() => interrupt(id)} title="Stop this turn, like Esc in Claude Code">
                ■ Stop <kbd className="hidden md:inline-block">Esc</kbd>
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({ t, now, onStop }: { t: ActivityTask; now: number; onStop: () => void }) {
  const running = taskRunning(t);
  const took = duration((t.endedAt ?? now) - t.startedAt);
  const icon = running ? <span className="spinner text-violet-300" />
    : t.status === 'completed' ? <span className="text-emerald-500">✓</span>
    : <span className="text-red-400">✗</span>;
  return (
    <li className={`flex items-center gap-2 ${running ? 'text-zinc-300' : 'text-zinc-500'}`}>
      {icon}
      <span className="shrink-0 rounded bg-zinc-800 px-1 text-[10px] uppercase text-violet-300">{taskKind(t)}{t.background ? ' · bg' : ''}</span>
      <span className="truncate">{t.description}</span>
      {running && t.lastTool && <span className="shrink-0 text-zinc-500">· {t.lastTool}{t.toolUses ? ` (${t.toolUses} tools)` : ''}</span>}
      {!running && t.summary && t.summary !== t.description && <span className="truncate text-zinc-600">· {t.summary}</span>}
      <span className="ml-auto shrink-0 text-zinc-500">{running ? took : `${t.status} in ${took}`}</span>
      {running && (
        <button className="shrink-0 rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-300" onClick={onStop} title="Stop this task (also in Ctrl+K)" aria-label={`Stop ${t.description}`}>✕</button>
      )}
    </li>
  );
}
