// Claude's to-do list, as Claude Code shows it: followed from TodoWrite (the whole list each time)
// and the newer TaskCreate / TaskUpdate tools (one task at a time; ids arrive in the tool result).
// Pure (tested in todos.test.ts). Subagents' lists are theirs, not the session's.

import type { Todo } from '../shared/protocol.ts';

export interface TodoState {
  todos: Todo[];
  /** TaskCreate calls waiting for their result, which carries the new task's id. */
  creating: Record<string, { content: string; activeForm?: string }>;
}

export const NO_TODOS: TodoState = { todos: [], creating: {} };

type Block = { type: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown };
type Msg = { type: string; parent_tool_use_id?: string | null; message?: { content?: unknown } };

const STATUSES = new Set(['pending', 'in_progress', 'completed']);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === 'object' && 'text' in c ? String(c.text) : '')).join('\n');
  return '';
}

/** The id TaskCreate reports: JSON `{ task: { id } }`, or text like "Task #3 created". */
export function createdId(text: string): string | undefined {
  try {
    const id = (JSON.parse(text) as { task?: { id?: unknown } })?.task?.id;
    if (typeof id === 'string' || typeof id === 'number') return String(id);
  } catch { /* plain text */ }
  return /#([\w-]+)/.exec(text)?.[1] ?? /\btask\s+(?:id\s*[:=]?\s*)?([\w-]+)/i.exec(text)?.[1];
}

/** Fold one SDK message into the list; unchanged state comes back as the same object. */
export function applyTodos(s: TodoState, m: Msg): TodoState {
  if (m.parent_tool_use_id) return s;
  const content = m.message?.content;
  if (!Array.isArray(content)) return s;
  let next = s;
  const change = (patch: Partial<TodoState>) => { next = { ...next, ...patch }; };
  for (const b of content as Block[]) {
    if (m.type === 'assistant' && b.type === 'tool_use' && b.input) {
      if (b.name === 'TodoWrite' && Array.isArray(b.input.todos)) {
        const todos = (b.input.todos as Record<string, unknown>[]).flatMap((t, i): Todo[] => {
          const content = str(t?.content);
          const status = str(t?.status);
          if (!content || !status || !STATUSES.has(status)) return [];
          return [{ id: `todo-${i}`, content, status: status as Todo['status'], activeForm: str(t.activeForm) }];
        });
        change({ todos });
      } else if (b.name === 'TaskCreate' && b.id && str(b.input.subject)) {
        change({ creating: { ...next.creating, [b.id]: { content: str(b.input.subject)!, activeForm: str(b.input.activeForm) } } });
      } else if (b.name === 'TaskUpdate' && str(b.input.taskId)) {
        const id = str(b.input.taskId)!;
        const status = str(b.input.status);
        if (status === 'deleted') change({ todos: next.todos.filter((t) => t.id !== id) });
        else {
          change({
            todos: next.todos.map((t) => (t.id !== id ? t : {
              ...t,
              ...(status && STATUSES.has(status) ? { status: status as Todo['status'] } : {}),
              ...(str(b.input!.subject) ? { content: str(b.input!.subject)! } : {}),
              ...(str(b.input!.activeForm) ? { activeForm: str(b.input!.activeForm) } : {}),
            })),
          });
        }
      }
    } else if (m.type === 'user' && b.type === 'tool_result' && b.tool_use_id && next.creating[b.tool_use_id]) {
      const { [b.tool_use_id]: made, ...creating } = next.creating;
      const id = createdId(resultText(b.content)) ?? b.tool_use_id;
      change({ creating, todos: [...next.todos, { id, content: made.content, status: 'pending', activeForm: made.activeForm }] });
    }
  }
  return next;
}
