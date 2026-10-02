// A card follows its terminal session through Claude Code's hooks: each event moves its live line,
// its stage on the board, its to-do list and the files it changed. Pure (tested in
// card-events.test.ts). Stages the hooks never leave: Ship and Done belong to you.

import { cardRepos, reportIn, type Card, type CardLive, type CardReport, type Stage } from '../shared/cards.ts';
import { readQuestions } from '../shared/questions.ts';
import { isInside } from '../shared/workspaces.ts';
import { applyTodos, NO_TODOS } from './todos.ts';

/** The hook events a card session sends besides SessionStart (all async but UserPromptSubmit, which may carry context added since). */
export const TRACKED_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'] as const;

/** What a hook sends on stdin; only the fields used here. */
export interface HookInput {
  session_id?: string;
  source?: string;
  permission_mode?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  tool_response?: unknown;
  notification_type?: string;
  message?: string;
  last_assistant_message?: string;
  reason?: string;
  prompt?: string;
  /** Set when a subagent sent it. */
  agent_id?: string;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const s = (v: unknown) => (typeof v === 'string' ? v : '');
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const firstLine = (t: string, max = 90) => {
  const line = t.trim().split(/\r?\n/).find((l) => l.trim()) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** "editing CheckoutForm.tsx", "running: pnpm test", in the words of the live line. */
export function describeTool(name: string, input: Record<string, unknown> = {}): string {
  const file = s(input.file_path) || s(input.notebook_path);
  switch (name) {
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `editing ${base(file)}`;
    case 'Write': return /[\\/]\.claude[\\/]plans[\\/]/.test(file) ? 'writing the plan' : `writing ${base(file)}`;
    case 'Read': return `reading ${base(file)}`;
    case 'Bash': case 'PowerShell': return `running: ${firstLine(s(input.description) || s(input.command), 70)}`;
    case 'Grep': case 'Glob': return `searching for ${firstLine(s(input.pattern), 50)}`;
    case 'WebFetch': return `reading ${s(input.url).replace(/^https?:\/\//, '').split('/')[0]}`;
    case 'WebSearch': return `searching the web: ${firstLine(s(input.query), 60)}`;
    case 'Task': case 'Agent': return `a subagent: ${firstLine(s(input.description), 60)}`;
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return 'updating its to-do list';
    case 'ExitPlanMode': return 'presenting its plan';
    case 'AskUserQuestion': return 'asking you a question';
    default: return `using ${name}`;
  }
}

/**
 * The question a message ends on, if its last paragraph asks one: "Should it be X or Y?".
 * Markdown emphasis is dropped; a question earlier in the message doesn't count.
 */
export function endingQuestion(message: string): string | null {
  const paras = message.trim().split(/\n\s*\n/).map((p) => p.replace(/[*_`]/g, '').trim()).filter(Boolean);
  // "Once you answer, I'll…" often follows the question itself.
  for (const p of paras.slice(-2).reverse()) {
    const q = p.match(/[^.!?\n]*\?/g);
    if (q?.length) return q[q.length - 1].trim().replace(/^[-:\s]+/, '');
  }
  return null;
}

/** Plan while Claude Code is in plan mode, Build otherwise. */
const workingStage = (mode: string | undefined): Stage => (mode === 'plan' ? 'plan' : 'build');

/** Apply one hook event. Unknown events and events after the card left the loop change only what they must. */
export function applyEvent(card: Card, event: string, input: HookInput, now: number): Card {
  const locked = card.stage === 'ship' || card.stage === 'done' || card.stage === 'inbox';
  const mode = input.permission_mode || card.live?.mode;
  let live: CardLive = { ...(card.live ?? { phase: 'working', text: '' }), at: now, ...(mode ? { mode } : {}) };
  let stage = card.stage;
  let files = card.files ?? [];
  let round = card.round ?? 1;
  let report: CardReport | undefined = card.report;
  const testing = card.kind === 'qa' || card.kind === 'review';
  let todoState = { todos: card.todos ?? NO_TODOS.todos, creating: card.creating ?? NO_TODOS.creating };
  const move = (to: Stage) => { if (!locked) stage = to; };
  const tool = s(input.tool_name);
  const toolInput = input.tool_input ?? {};
  const sub = Boolean(input.agent_id);

  switch (event) {
    case 'UserPromptSubmit':
      if (stage === 'try') round += 1;
      live = { ...live, phase: 'working', text: round > 1 && stage === 'try' ? `Round ${round}: working on your message` : 'Working on your message', ask: undefined, turnSince: now };
      move(workingStage(mode));
      break;
    case 'PreToolUse':
      // A helper working in parallel doesn't answer a prompt that is waiting in the tab: the card still needs you.
      if (sub && live.ask) break;
      live = { ...live, phase: 'working', text: sub ? `subagent ${describeTool(tool, toolInput)}` : describeTool(tool, toolInput), ask: sub ? live.ask : undefined };
      if (!sub) {
        if (stage === 'needs') move(workingStage(mode));
        todoState = applyTodos(todoState, { type: 'assistant', message: { content: [{ type: 'tool_use', id: input.tool_use_id, name: tool, input: toolInput }] } });
      }
      break;
    case 'PermissionRequest':
      if (tool === 'ExitPlanMode') {
        live = { ...live, phase: 'needs', text: 'Plan ready: approve it in the tab', ask: { kind: 'plan', tool, plan: s(toolInput.plan) } };
        move('plan');
      } else if (tool === 'AskUserQuestion') {
        // The whole form (§91): the page draws its questions and answers them through the tab's launcher.
        const questions = readQuestions(toolInput.questions);
        const q = questions?.[0]?.question ?? '';
        live = { ...live, phase: 'needs', text: `Asking: ${firstLine(q) || 'a question'}`, ask: { kind: 'question', tool, detail: q, ...(questions ? { questions } : {}) } };
        move('needs');
      } else {
        const what = describeTool(tool, toolInput);
        live = { ...live, phase: 'needs', text: `Waiting for you to allow ${what}`, ask: { kind: 'tool', tool, detail: what } };
        move('needs');
      }
      break;
    case 'PostToolUse': {
      const path = s(toolInput.file_path) || s(toolInput.notebook_path);
      // Only the card's own repos count: a plan written to ~/.claude/plans is not a change to try.
      const ours = [card.cwd, ...cardRepos(card), ...(card.folders ?? []).map((f) => f.dir)].some((r) => r && isInside(path, r));
      if (EDIT_TOOLS.has(tool) && path && ours && !files.includes(path)) files = [...files, path];
      if (!sub) {
        const content = typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response ?? '');
        todoState = applyTodos(todoState, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: input.tool_use_id, content }] } });
      }
      if (live.ask && live.ask.tool === tool) {
        // It ran, so you allowed it; an approved plan starts the build.
        live = { ...live, phase: 'working', text: tool === 'ExitPlanMode' ? 'Plan approved: building' : describeTool(tool, toolInput), ask: undefined };
        move(tool === 'ExitPlanMode' ? 'build' : workingStage(mode));
      }
      break;
    }
    case 'Notification':
      if (input.notification_type === 'permission_prompt' || input.notification_type === 'elicitation_dialog') {
        // Usually PermissionRequest came first and said more; this is the fallback.
        if (live.phase !== 'needs') { live = { ...live, phase: 'needs', text: firstLine(s(input.message)) || 'Waiting for you in the tab' }; move('needs'); }
      } else if (input.notification_type === 'idle_prompt' && live.phase === 'working') {
        live = { ...live, phase: 'waiting', text: 'Waiting for you in the tab' };
      }
      break;
    case 'Stop': {
      if (sub) break;
      const said = s(input.last_assistant_message);
      const planning = stage === 'plan' || (stage === 'needs' && mode === 'plan');
      live = { ...live, phase: 'waiting', ask: undefined, turnSince: undefined, ...(said ? { lastMessage: said.slice(0, 4000) } : {}) };
      const question = endingQuestion(said);
      // Its turn ended on a question: that waits on you as much as a permission prompt does. Except
      // after changes, where "Anything else?" is manners and the change is ready to try.
      const asking = (q: string) => { live = { ...live, phase: 'needs', text: `Asking: ${firstLine(q)}`, ask: { kind: 'question', tool: 'reply', detail: q } }; };
      // A QA or review card ends with its report: the card moves to Ship, where s copies it.
      const found = testing ? reportIn(said, now) : undefined;
      if (found) {
        report = found;
        live.text = `${card.kind === 'qa' ? 'QA report' : 'Review'} ready${found.result ? `: ${found.result}` : ''}. s copies it`;
        if (stage !== 'done') stage = 'ship';
      } else if (planning) {
        if (question) asking(question);
        else live.text = 'Waiting for you in the tab';
        move('plan');
      } else if (!testing && files.length && (stage === 'build' || stage === 'needs')) { live.text = round > 1 ? `Round ${round} done. Ready to try` : 'Done. Ready to try'; move('try'); }
      else if (question) { asking(question); move('needs'); }
      else { live.text = said ? `Replied: ${firstLine(said, 80)}` : 'Waiting for you in the tab'; if (stage === 'needs') move(workingStage(mode)); }
      break;
    }
    case 'SessionEnd':
      live = { ...live, phase: 'ended', text: `Session ended${input.reason && input.reason !== 'other' ? ` (${input.reason.replace(/_/g, ' ')})` : ''}`, ask: undefined, turnSince: undefined };
      break;
    default:
      return card;
  }
  return { ...card, stage, live, files, round, todos: todoState.todos, creating: todoState.creating, ...(report ? { report } : {}) };
}
