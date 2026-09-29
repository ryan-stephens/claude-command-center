import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SlashInfo } from '../shared/protocol.ts';
import { argQuery, exactCommand, hintChoices, matchSlash, runsAlone, slashQuery } from './slash.ts';

const cmds: SlashInfo[] = [
  { name: 'clear', description: 'Start a new session', aliases: ['reset', 'new'] },
  { name: 'compact', description: 'Free up context', argumentHint: '<optional instructions>' },
  { name: 'claude-api', description: 'Claude API reference' },
  { name: 'code-review', description: 'Review the diff', aliases: ['review'] },
  { name: 'model', description: 'Set the model', argumentHint: '<model>' },
  { name: 'context', description: 'Show context usage' },
];
const names = (list: SlashInfo[]) => list.map((c) => c.name);

test('slashQuery only fires for a command at the very start, before any space', () => {
  assert.equal(slashQuery('/'), '');
  assert.equal(slashQuery('/cl'), 'cl');
  assert.equal(slashQuery('/clear now'), null);
  assert.equal(slashQuery('say /cl'), null);
  assert.equal(slashQuery('/cl\nmore'), null);
  assert.equal(slashQuery('//'), null);
  assert.equal(slashQuery(''), null);
});

test('matchSlash: /cl offers clear first, like Claude Code', () => {
  assert.deepEqual(names(matchSlash(cmds, 'cl')), ['clear', 'claude-api']);
  assert.equal(matchSlash(cmds, 'co')[0].name, 'compact');
});

test('matchSlash finds commands by alias, then fuzzily', () => {
  assert.equal(matchSlash(cmds, 'res')[0].name, 'clear');
  assert.equal(matchSlash(cmds, 'rev')[0].name, 'code-review');
  assert.ok(names(matchSlash(cmds, 'cr')).includes('code-review'));
  assert.deepEqual(matchSlash(cmds, 'zzz'), []);
});

test('matchSlash with nothing typed lists everything by name, capped', () => {
  assert.deepEqual(names(matchSlash(cmds, '', 3)), ['claude-api', 'clear', 'code-review']);
});

test('runsAlone: Enter runs commands whose arguments are all optional, completes the rest', () => {
  assert.equal(runsAlone({ name: 'context', description: '' }), true);
  assert.equal(runsAlone({ name: 'clear', description: '', argumentHint: '[name]' }), true);
  assert.equal(runsAlone({ name: 'compact', description: '', argumentHint: '<optional custom summarization instructions>' }), true);
  assert.equal(runsAlone({ name: 'model', description: '', argumentHint: '<model>' }), false);
});

test('exactCommand recognises a finished command, by name or alias', () => {
  assert.equal(exactCommand('/model ', cmds)?.name, 'model');
  assert.equal(exactCommand('/model opus', cmds)?.name, 'model');
  assert.equal(exactCommand('/reset', cmds)?.name, 'clear');
  assert.equal(exactCommand('/mod', cmds), undefined);
  assert.equal(exactCommand('hello', cmds), undefined);
});

test('hintChoices reads the choices out of an argument hint', () => {
  assert.deepEqual(hintChoices('<low|medium|high|xhigh|max|auto>'), ['low', 'medium', 'high', 'xhigh', 'max', 'auto']);
  assert.deepEqual(hintChoices('[on|off]'), ['on', 'off']);
  assert.deepEqual(hintChoices('[auto|<tokens>]'), null, 'one real choice is not a menu');
  assert.equal(hintChoices('<model>'), null);
  assert.equal(hintChoices('[name]'), null);
  assert.equal(hintChoices(undefined), null);
});

test('argQuery spots an argument being typed', () => {
  assert.deepEqual(argQuery('/effort hi'), { name: 'effort', partial: 'hi' });
  assert.deepEqual(argQuery('/model '), { name: 'model', partial: '' });
  assert.equal(argQuery('/model sonnet now'), null);
  assert.equal(argQuery('/model'), null);
});
