import type { ActivityPhase, ActivityTask, SessionActivity } from '../shared/protocol.ts';
import { summarizeToolInput, toolFields } from './transcript.ts';

// Folds the SDK's event stream into "what is this session doing right now", the same things
// Claude Code shows on its spinner line: thinking, writing, which tool is running, compacting,
// API retries, and subagents / background shells that outlive the turn.
// Pure (state + event → state), so it's unit-tested without a live session.

type Msg = { type: string; subtype?: string; parent_tool_use_id?: string | null; [k: string]: unknown };

/** Finished tasks stay listed this long so you can see what just happened. */
const FINISHED_TASK_TTL_MS = 2 * 60_000;
const MAX_FINISHED_TASKS = 5;

export function idleActivity(now: number): SessionActivity {
  return { phase: 'idle', phaseSince: now, tasks: [] };
}

function withPhase(a: SessionActivity, phase: ActivityPhase, now: number, extra: Partial<SessionActivity> = {}): SessionActivity {
  const since = a.phase === phase && !extra.tool ? a.phaseSince : now;
  return { ...a, phase, phaseSince: since, retry: phase === 'retrying' ? a.retry : undefined, ...extra };
}

function updateTask(a: SessionActivity, id: string, patch: Partial<ActivityTask>): SessionActivity {
  return { ...a, tasks: a.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

function prune(a: SessionActivity, now: number): SessionActivity {
  const running = a.tasks.filter((t) => t.status === 'running' || t.status === 'pending' || t.status === 'paused');
  const finished = a.tasks
    .filter((t) => !running.includes(t) && now - (t.endedAt ?? now) < FINISHED_TASK_TTL_MS)
    .slice(-MAX_FINISHED_TASKS);
  return { ...a, tasks: [...running, ...finished].sort((x, y) => x.startedAt - y.startedAt) };
}

/** A new turn was sent. */
export function startTurn(a: SessionActivity, now: number): SessionActivity {
  return { ...withPhase(a, 'requesting', now), turnStartedAt: now, tool: undefined, thinkingTokens: undefined };
}

/** The permission broker opened or closed a card for this session. */
export function setApproval(a: SessionActivity, waiting: boolean, now: number): SessionActivity {
  if (waiting) return withPhase(a, 'approval', now, { tool: a.tool });
  if (a.phase !== 'approval') return a;
  // Answered: the tool now runs (or was denied, and the model carries on).
  return withPhase(a, a.tool ? 'tool' : 'requesting', now, { tool: a.tool });
}

export function applyEvent(a: SessionActivity, m: Msg, now: number): SessionActivity {
  const sub = Boolean(m.parent_tool_use_id); // subagent traffic: reported through its task, not the main phase

  if (m.type === 'stream_event' && !sub) {
    const ev = m.event as { type: string; content_block?: { type: string; name?: string } };
    if (ev.type !== 'content_block_start' || !ev.content_block) return a;
    switch (ev.content_block.type) {
      case 'thinking':
      case 'redacted_thinking':
        return withPhase(a, 'thinking', now);
      case 'text':
        return withPhase(a, 'writing', now);
      case 'tool_use':
      case 'server_tool_use':
        return withPhase(a, 'tool', now, { tool: { name: ev.content_block.name ?? 'tool' } });
    }
    return a;
  }

  if (m.type === 'assistant' && !sub) {
    // The complete block carries the tool's input, so the line can say *what* it's running.
    const content = (m.message as { content?: { type: string; name?: string; input?: unknown }[] })?.content ?? [];
    const toolUse = [...content].reverse().find((c) => c.type === 'tool_use');
    if (toolUse && a.phase === 'tool') {
      const name = toolUse.name ?? 'tool';
      return { ...a, tool: { name, detail: summarizeToolInput(name, toolUse.input), fields: toolFields(name, toolUse.input) } };
    }
    return a;
  }

  if (m.type === 'user' && !sub) {
    const content = (m.message as { content?: unknown })?.content;
    const hasResult = Array.isArray(content) && content.some((c: { type: string }) => c.type === 'tool_result');
    // Tool finished; the model picks up again.
    return hasResult && a.turnStartedAt !== undefined ? withPhase(a, 'requesting', now, { tool: undefined }) : a;
  }

  if (m.type === 'tool_progress') {
    if (m.task_id) return updateTask(a, String(m.task_id), { lastTool: String(m.tool_name) });
    return a;
  }

  if (m.type === 'result') {
    return prune({ ...withPhase(a, 'idle', now), turnStartedAt: undefined, tool: undefined, thinkingTokens: undefined, retry: undefined }, now);
  }

  if (m.type !== 'system') return a;
  switch (m.subtype) {
    case 'status': {
      if (m.status === 'compacting') return withPhase(a, 'compacting', now);
      if (m.status === 'requesting') return withPhase(a, 'requesting', now, { tool: undefined });
      return a.phase === 'compacting' ? withPhase(a, a.turnStartedAt !== undefined ? 'requesting' : 'idle', now) : a;
    }
    case 'api_retry':
      return withPhase(a, 'retrying', now, {
        retry: {
          attempt: Number(m.attempt),
          max: Number(m.max_retries),
          resumeAt: now + Number(m.retry_delay_ms ?? 0),
          status: (m.error_status as number | null) ?? null,
        },
      });
    case 'thinking_tokens':
      return { ...a, thinkingTokens: Number(m.estimated_tokens) };
    case 'task_started': {
      const task: ActivityTask = {
        id: String(m.task_id),
        kind: String(m.task_type ?? (m.subagent_type ? 'local_agent' : 'task')),
        description: String(m.description ?? m.subagent_type ?? 'Task'),
        status: 'running',
        background: Boolean(m.is_backgrounded),
        startedAt: now,
      };
      return prune({ ...a, tasks: [...a.tasks.filter((t) => t.id !== task.id), task] }, now);
    }
    case 'task_progress': {
      const usage = m.usage as { tool_uses?: number } | undefined;
      return updateTask(a, String(m.task_id), {
        lastTool: (m.last_tool_name as string | undefined) ?? undefined,
        toolUses: usage?.tool_uses,
        summary: (m.summary as string | undefined) ?? undefined,
      });
    }
    case 'task_updated': {
      const patch = (m.patch ?? {}) as { status?: ActivityTask['status']; description?: string; end_time?: number; is_backgrounded?: boolean };
      return prune(updateTask(a, String(m.task_id), {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.description ? { description: patch.description } : {}),
        ...(patch.end_time ? { endedAt: patch.end_time } : {}),
        ...(patch.is_backgrounded !== undefined ? { background: patch.is_backgrounded } : {}),
      }), now);
    }
    case 'task_notification': {
      const usage = m.usage as { tool_uses?: number } | undefined;
      return prune(updateTask(a, String(m.task_id), {
        status: m.status as ActivityTask['status'],
        endedAt: now,
        summary: (m.summary as string | undefined) || undefined,
        ...(usage?.tool_uses !== undefined ? { toolUses: usage.tool_uses } : {}),
      }), now);
    }
    case 'background_tasks_changed': {
      // Authoritative list of what's still running in the background.
      const live = (m.tasks as { task_id: string; task_type: string; description: string }[]) ?? [];
      const ids = new Set(live.map((t) => t.task_id));
      let tasks = a.tasks.map((t) => (t.background && t.status === 'running' && !ids.has(t.id) ? { ...t, status: 'completed' as const, endedAt: t.endedAt ?? now } : t));
      for (const t of live) {
        if (!tasks.some((x) => x.id === t.task_id)) {
          tasks.push({ id: t.task_id, kind: t.task_type, description: t.description, status: 'running', background: true, startedAt: now });
        }
      }
      tasks = tasks.map((t) => (ids.has(t.id) ? { ...t, background: true } : t));
      return prune({ ...a, tasks }, now);
    }
  }
  return a;
}

/** Running work that isn't part of the current turn: what keeps an "idle" session busy. */
export function backgroundRunning(a: SessionActivity): number {
  return a.tasks.filter((t) => t.background && t.status === 'running').length;
}
