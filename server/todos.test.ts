import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyTodos, createdId, NO_TODOS } from './todos.ts';

const use = (name: string, input: Record<string, unknown>, id = 'tu1', parent: string | null = null) =>
  ({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id: string, text: string) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });

test('TodoWrite replaces the whole list', () => {
  const s = applyTodos(NO_TODOS, use('TodoWrite', { todos: [
    { content: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
    { content: 'Fix the bug', status: 'in_progress', activeForm: 'Fixing the bug' },
    { content: 'bogus', status: 'weird' },
  ] }));
  assert.deepEqual(s.todos.map((t) => [t.content, t.status]), [['Read the code', 'completed'], ['Fix the bug', 'in_progress']]);
  const s2 = applyTodos(s, use('TodoWrite', { todos: [{ content: 'Only this', status: 'pending' }] }));
  assert.equal(s2.todos.length, 1);
});

test('TaskCreate adds a task once its id comes back; TaskUpdate changes or deletes it', () => {
  let s = applyTodos(NO_TODOS, use('TaskCreate', { subject: 'Write tests', description: '...', activeForm: 'Writing tests' }, 'tc1'));
  assert.equal(s.todos.length, 0, 'waits for the id');
  s = applyTodos(s, result('tc1', 'Task #7 created successfully: Write tests'));
  assert.deepEqual(s.todos, [{ id: '7', content: 'Write tests', status: 'pending', activeForm: 'Writing tests' }]);
  s = applyTodos(s, use('TaskUpdate', { taskId: '7', status: 'in_progress' }, 'tu2'));
  assert.equal(s.todos[0].status, 'in_progress');
  s = applyTodos(s, use('TaskUpdate', { taskId: '7', status: 'deleted' }, 'tu3'));
  assert.deepEqual(s.todos, []);
});

test('createdId reads JSON or text', () => {
  assert.equal(createdId('{"task":{"id":"12","subject":"x"}}'), '12');
  assert.equal(createdId('Task #3 created'), '3');
  assert.equal(createdId('nothing here'), undefined);
});

test('subagent lists and unrelated messages change nothing', () => {
  const s = applyTodos(NO_TODOS, use('TodoWrite', { todos: [{ content: 'x', status: 'pending' }] }, 'a', 'parent-1'));
  assert.equal(s, NO_TODOS);
  assert.equal(applyTodos(NO_TODOS, { type: 'system' }), NO_TODOS);
  assert.equal(applyTodos(NO_TODOS, use('Read', { file_path: 'a' })), NO_TODOS);
});
