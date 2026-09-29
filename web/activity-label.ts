import type { ActivityTask, SessionActivity } from '../shared/protocol.ts';
import { explainPermission, toolStep } from './plain.ts';

// Human text for a session's activity, in the spirit of Claude Code's spinner line.
// Pure, so it is tested directly and shared by the session view and the list.

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function clip(s: string, max = 90): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export interface ActivityLine {
  text: string;
  /** Seconds in this phase, and in the whole turn. */
  elapsed?: string;
  turn?: string;
  tone: 'busy' | 'attention' | 'warn';
}

/** The main line, or null when the session is idle with nothing running. `cwd` shortens file names. */
export function activityLine(a: SessionActivity | undefined, now: number, cwd?: string): ActivityLine | null {
  if (!a) return null;
  const elapsed = duration(now - a.phaseSince);
  const turn = a.turnStartedAt !== undefined ? duration(now - a.turnStartedAt) : undefined;
  switch (a.phase) {
    case 'requesting': return { text: 'Working on it…', elapsed, turn, tone: 'busy' };
    case 'thinking': return { text: `Thinking…${a.thinkingTokens ? ` · ~${tokens(a.thinkingTokens)} tokens` : ''}`, elapsed, turn, tone: 'busy' };
    case 'writing': return { text: 'Writing a reply…', elapsed, turn, tone: 'busy' };
    case 'tool': {
      if (!a.tool) return { text: 'Working on it…', elapsed, turn, tone: 'busy' };
      const step = clip(toolStep(a.tool.name, a.tool.fields, a.tool.detail ?? '', true, cwd).text);
      return { text: step.endsWith('…') ? step : `${step}…`, elapsed, turn, tone: 'busy' };
    }
    case 'compacting': return { text: 'Tidying up its memory of this conversation…', elapsed, turn, tone: 'busy' };
    case 'retrying': {
      const r = a.retry;
      const wait = r ? Math.max(0, Math.ceil((r.resumeAt - now) / 1000)) : 0;
      return { text: `Claude's servers are busy (${r?.status ?? 'error'}) · trying again in ${wait}s (attempt ${r?.attempt ?? '?'} of ${r?.max ?? '?'})`, turn, tone: 'warn' };
    }
    case 'approval': {
      if (a.tool?.name === 'AskUserQuestion') return { text: 'Claude has a question for you', elapsed, turn, tone: 'attention' };
      if (a.tool?.name === 'ExitPlanMode') return { text: 'Claude has a plan: waiting for you to approve it', elapsed, turn, tone: 'attention' };
      const want = a.tool ? explainPermission({ tool: a.tool.name, input: a.tool.detail ?? '', fields: a.tool.fields }, cwd).want : '';
      return { text: `Waiting for your OK${want ? ` to ${clip(want, 70)}` : ''}`, elapsed, turn, tone: 'attention' };
    }
    case 'idle': {
      const bg = a.tasks.filter((t) => t.background && t.status === 'running').length;
      return bg ? { text: `Done · ${bg} still running in the background`, tone: 'busy' } : null;
    }
  }
}

/** A few words for a session row: what it is doing now. */
export function activityShort(a: SessionActivity | undefined, cwd?: string): string | null {
  if (!a || a.phase === 'idle' || a.phase === 'approval') return null;
  switch (a.phase) {
    case 'tool': return a.tool ? clip(toolStep(a.tool.name, a.tool.fields, a.tool.detail ?? '', true, cwd).text, 48) : 'Working';
    case 'retrying': return 'Retrying';
    case 'thinking': return 'Thinking';
    case 'writing': return 'Writing a reply';
    case 'compacting': return 'Tidying up';
    default: return 'Working';
  }
}

/** Time since the turn began, for rows: "0:42", "12:05". */
export function turnClock(a: SessionActivity | undefined, now: number): string | null {
  if (!a || a.turnStartedAt === undefined || a.phase === 'idle') return null;
  const s = Math.max(0, Math.floor((now - a.turnStartedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const KIND: Record<string, string> = { local_agent: 'helper', local_bash: 'command', local_workflow: 'workflow', mcp_task: 'tool task' };
export const taskKind = (t: ActivityTask): string => KIND[t.kind] ?? t.kind.replace(/^local_/, '');

export function taskRunning(t: ActivityTask): boolean {
  return t.status === 'running' || t.status === 'pending' || t.status === 'paused';
}
