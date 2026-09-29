import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize, toolFields } from './transcript.ts';

test('toolFields keeps what plain language needs and drops the rest', () => {
  assert.deepEqual(toolFields('Bash', { command: 'node --check app.js', description: 'Check app.js for syntax errors', timeout: 5000 }), {
    command: 'node --check app.js',
    description: 'Check app.js for syntax errors',
  });
  assert.deepEqual(toolFields('Read', { file_path: 'C:\repo\index.html' }), { filePath: 'C:\repo\index.html' });
  assert.equal(toolFields('Bash', 'not an object'), undefined);
  assert.equal(toolFields('TodoWrite', { todos: [] }), undefined);
});

test('edits carry their before and after, trimmed', () => {
  const edit = toolFields('Edit', { file_path: 'a.html', old_string: '<p>old</p>', new_string: '<p>new</p>' });
  assert.deepEqual(edit?.edit, { before: '<p>old</p>', after: '<p>new</p>' });
  assert.deepEqual(toolFields('Write', { file_path: 'b.txt', content: 'hi' })?.edit, { before: '', after: 'hi' });
  const long = toolFields('Write', { file_path: 'c.txt', content: 'x'.repeat(5000) })!;
  assert.ok(long.edit!.after.length < 1600 && long.edit!.after.endsWith('…'));
});

test('normalize attaches fields to tool items', () => {
  const items = normalize({ type: 'assistant', uuid: 'u1', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls', description: 'List files' } }] } });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'tool');
  assert.deepEqual(items[0].kind === 'tool' && items[0].fields, { command: 'ls', description: 'List files' });
});
