// What Claude is doing, from the hooks a v2 session reports (v2/hooks/hook.mjs). Claude runs in the
// user's own terminal or editor; these events are the only way the app hears about it. Pure.

import { describeTool, endingQuestion, type HookInput } from '../../server/card-events.ts';
import type { ClaudeStatus } from '../shared/types.ts';

/** The events the session's settings send here. SessionStart and the rest all only report. */
export const V2_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'] as const;

const first = (t: string, max = 100) => {
  const line = t.trim().split(/\r?\n/).find((l) => l.trim())?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** The next status after one event. A subagent's events don't change the main session's state. */
export function applyHook(prev: ClaudeStatus, event: string, input: HookInput, now: number): ClaudeStatus {
  const claudeId = input.session_id && !input.agent_id ? input.session_id : prev.claudeId;
  const keep = { ...(claudeId ? { claudeId } : {}) };
  if (input.agent_id && event !== 'PermissionRequest') return { ...prev, ...keep };
  switch (event) {
    case 'SessionStart':
      return { state: 'done', text: input.source === 'resume' ? 'resumed, waiting for you' : 'started, waiting for its first message', at: now, ...keep };
    case 'UserPromptSubmit':
      return { state: 'working', text: 'thinking', at: now, ...keep };
    case 'PreToolUse':
      if (input.tool_name === 'AskUserQuestion') return { state: 'needs-you', text: 'asking you a question', at: now, ...keep };
      if (input.tool_name === 'ExitPlanMode') return { state: 'needs-you', text: 'has a plan for you to approve', at: now, ...keep };
      return { state: 'working', text: describeTool(input.tool_name ?? 'a tool', input.tool_input), at: now, ...keep };
    case 'PostToolUse':
      return prev.state === 'needs-you' ? { state: 'working', text: 'carrying on', at: now, ...keep } : { ...prev, ...keep };
    case 'PermissionRequest':
      return { state: 'needs-you', text: `wants to ${describeTool(input.tool_name ?? 'a tool', input.tool_input).replace(/^running: /, 'run: ')}`, at: now, ...keep };
    case 'Notification': {
      const msg = first(input.message ?? '');
      // "Claude needs your permission to use Bash": a prompt in the terminal. "waiting for your input": its turn is over.
      if (/permission/i.test(msg)) return { state: 'needs-you', text: prev.state === 'needs-you' ? prev.text : msg, at: prev.state === 'needs-you' ? prev.at : now, ...keep };
      if (prev.state === 'done' || prev.state === 'needs-you') return { ...prev, ...keep };
      return { state: 'done', text: msg || 'waiting for you', at: now, ...keep };
    }
    case 'Stop': {
      const q = endingQuestion(input.last_assistant_message ?? '');
      return q ? { state: 'needs-you', text: `asks: ${first(q, 90)}`, at: now, ...keep } : { state: 'done', text: 'turn ended', at: now, ...keep };
    }
    case 'SessionEnd':
      return { state: 'ended', text: 'session closed', at: now, ...keep };
    default:
      return { ...prev, ...keep };
  }
}
