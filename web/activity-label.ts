import type { ActivityTask, SessionActivity } from '../shared/protocol.ts';

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

/** The main line, or null when the session is idle with nothing running. */
export function activityLine(a: SessionActivity | undefined, now: number): ActivityLine | null {
  if (!a) return null;
  const elapsed = duration(now - a.phaseSince);
  const turn = a.turnStartedAt !== undefined ? duration(now - a.turnStartedAt) : undefined;
  switch (a.phase) {
    case 'requesting': return { text: 'Working…', elapsed, turn, tone: 'busy' };
    case 'thinking': return { text: `Thinking…${a.thinkingTokens ? ` · ~${tokens(a.thinkingTokens)} tokens` : ''}`, elapsed, turn, tone: 'busy' };
    case 'writing': return { text: 'Writing…', elapsed, turn, tone: 'busy' };
    case 'tool': return { text: a.tool?.detail ? `${a.tool.name} · ${clip(a.tool.detail)}` : `Running ${a.tool?.name ?? 'a tool'}…`, elapsed, turn, tone: 'busy' };
    case 'compacting': return { text: 'Compacting the conversation…', elapsed, turn, tone: 'busy' };
    case 'retrying': {
      const r = a.retry;
      const wait = r ? Math.max(0, Math.ceil((r.resumeAt - now) / 1000)) : 0;
      return { text: `API ${r?.status ?? 'error'} · retrying in ${wait}s (attempt ${r?.attempt ?? '?'}/${r?.max ?? '?'})`, turn, tone: 'warn' };
    }
    case 'approval': return { text: `Waiting for your approval${a.tool ? ` to run ${a.tool.name}` : ''}`, elapsed, turn, tone: 'attention' };
    case 'idle': {
      const bg = a.tasks.filter((t) => t.background && t.status === 'running').length;
      return bg ? { text: `Idle · ${bg} running in the background`, tone: 'busy' } : null;
    }
  }
}

/** A few words for the session list. */
export function activityShort(a: SessionActivity | undefined, now: number): string | null {
  if (!a || a.phase === 'idle' || a.phase === 'approval') return null;
  const turn = a.turnStartedAt !== undefined ? ` ${duration(now - a.turnStartedAt)}` : '';
  switch (a.phase) {
    case 'tool': return `${a.tool?.name ?? 'tool'}${turn}`;
    case 'retrying': return `retrying${turn}`;
    default: return `${a.phase === 'requesting' ? 'working' : a.phase}${turn}`;
  }
}

const KIND: Record<string, string> = { local_agent: 'subagent', local_bash: 'shell', local_workflow: 'workflow', mcp_task: 'MCP task' };
export const taskKind = (t: ActivityTask): string => KIND[t.kind] ?? t.kind.replace(/^local_/, '');

export function taskRunning(t: ActivityTask): boolean {
  return t.status === 'running' || t.status === 'pending' || t.status === 'paused';
}
