import { useEffect, useState } from 'react';
import type { ActivityTask } from '../../shared/protocol.ts';
import { activityLine, duration, taskKind, taskRunning } from '../activity-label.ts';
import { NO_BINDINGS, useStore } from '../store.ts';
import { bindingsFor, displayCombo } from '../bindings.ts';
import { interrupt } from '../keys.ts';
import { send } from '../ws.ts';
import { Icon, Key } from './ui.tsx';

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

const TONE = { busy: 'text-busy', attention: 'text-attn', warn: 'text-calm' };

/**
 * What the session is doing right now, like Claude Code's spinner line, plus the helpers and
 * background commands it has running. Sits between the conversation and the message box.
 */
export function ActivityBar({ id }: { id: string }) {
  const activity = useStore((s) => s.activity[id]);
  const cwd = useStore((s) => s.sessions.find((x) => x.id === id)?.cwd);
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  const backgroundKey = displayCombo(bindingsFor('background', bindings)[0] ?? '');
  const busy = Boolean(activity && (activity.phase !== 'idle' || activity.tasks.some(taskRunning)));
  const now = useNow(busy);
  const line = activityLine(activity, now, cwd);
  const tasks = activity?.tasks ?? [];
  if (!line && !tasks.length) return null;

  return (
    <div className="border-t border-line px-4 py-2 text-sm md:px-6" aria-live="polite">
      <div className="mx-auto max-w-3xl">
        {tasks.length > 0 && (
          <ul className="mb-1.5 space-y-1">
            {tasks.map((t) => <TaskRow key={t.id} t={t} now={now} onStop={() => send({ type: 'task.stop', id, taskId: t.id })} />)}
          </ul>
        )}
        {line && (
          <div className="flex items-center gap-2.5">
            {line.tone === 'busy' && activity?.phase !== 'idle' ? <span className={`spinner ${TONE.busy}`} /> : <span className={`h-2 w-2 rounded-full bg-current ${TONE[line.tone]}`} />}
            <span className={`truncate ${TONE[line.tone]}`}>{line.text}</span>
            {line.elapsed && <span className="shrink-0 tabular-nums text-faint">{line.elapsed}</span>}
            {line.turn && line.turn !== line.elapsed && <span className="shrink-0 tabular-nums text-faint">· whole turn {line.turn}</span>}
            {activity && activity.phase !== 'idle' && (
              <span className="ml-auto flex shrink-0 gap-2">
                {activity.phase === 'tool' && (
                  <button className="btn min-h-8 py-0 pl-1.5 text-sm" onClick={() => send({ type: 'session.background', id })} title="Let this keep running in the background while Claude carries on">
                    <Key k={backgroundKey} size="sm" />Background
                  </button>
                )}
                <button className="btn min-h-8 py-0 pl-1.5 text-sm text-bad" onClick={() => interrupt(id)} title="Stop Claude now, like Esc in Claude Code">
                  <Key k="Esc" size="sm" tone="bad" />Stop
                </button>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({ t, now, onStop }: { t: ActivityTask; now: number; onStop: () => void }) {
  const running = taskRunning(t);
  const took = duration((t.endedAt ?? now) - t.startedAt);
  const icon = running ? <span className="spinner text-calm" />
    : t.status === 'completed' ? <Icon name="check" size={15} className="text-ok" />
    : <Icon name="x" size={15} className="text-bad" />;
  return (
    <li className={`flex items-center gap-2 ${running ? '' : 'text-faint'}`}>
      {icon}
      <span className="shrink-0 rounded bg-calm-bg px-1.5 text-[11px] font-semibold text-calm">{taskKind(t)}{t.background ? ' · background' : ''}</span>
      <span className="truncate">{t.description}</span>
      {running && t.lastTool && <span className="shrink-0 text-faint">· {t.lastTool}{t.toolUses ? ` (${t.toolUses} steps)` : ''}</span>}
      {!running && t.summary && t.summary !== t.description && <span className="truncate text-faint">· {t.summary}</span>}
      <span className="ml-auto shrink-0 tabular-nums text-faint">{running ? took : `${t.status} after ${took}`}</span>
      {running && (
        <button className="shrink-0 rounded p-0.5 text-faint hover:bg-raise hover:text-bad" onClick={onStop} title="Stop this (also in Search)" aria-label={`Stop ${t.description}`}><Icon name="x" size={15} /></button>
      )}
    </li>
  );
}
