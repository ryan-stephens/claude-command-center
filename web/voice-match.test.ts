import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CommandGroup } from '../shared/protocol.ts';
import { matchUtterance } from './voice-match.ts';

const group = (name: string, labels: string[]): CommandGroup => ({
  name,
  scope: 'global',
  commands: labels.map((label, i) => ({ slot: i + 1, label, body: label, mode: 'send' })),
});
const everyday = group('Everyday', ['Continue', 'Summarise', 'Unpushed?', 'Build errors', 'Test failures', 'Explain…', 'Code review', 'Simplify', 'Commit']);
const skills = group('Skills', ['code-review', 'simplify', 'security-review']);
const groups = [everyday, skills];

const label = (said: string) => {
  const m = matchUtterance(said, groups, everyday);
  return m.kind === 'text' ? 'text' : m.command.label;
};

test('matches spoken labels, forgiving punctuation, filler and spelling', () => {
  assert.equal(label('code review'), 'Code review');
  assert.equal(label('Code review.'), 'Code review');
  assert.equal(label('run build errors please'), 'Build errors');
  assert.equal(label('summarize'), 'Summarise');
  assert.equal(label('test failure'), 'Test failures');
  assert.equal(label('security review'), 'security-review');
});

test('prefers the current group when labels collide', () => {
  assert.equal(label('simplify'), 'Simplify');
});

test('"slot N" fires slot N of the current group', () => {
  assert.equal(label('slot three'), 'Unpushed?');
  assert.equal(label('command 7'), 'Code review');
});

test('dictation and unrelated phrases are sent as text', () => {
  assert.equal(label('please refactor the login handler so it uses the new session store'), 'text');
  assert.equal(label('hello there'), 'text');
  assert.equal(label('what is the codeword'), 'text');
  assert.equal(label(''), 'text');
});

test('near misses are matches that ask first', () => {
  const m = matchUtterance('summary', groups, everyday);
  assert.equal(m.kind, 'command');
  assert.equal(m.kind === 'command' && m.confident, false);
});
