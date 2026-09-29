import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TranscriptItem } from '../shared/protocol.ts';
import { historyFor, remembered } from './prompt-history.ts';
import { fileQuery } from './slash.ts';

const u = (text: string): TranscriptItem => ({ kind: 'user', uuid: text, text });

test('historyFor: this session first, newest first, then elsewhere, each once', () => {
  const items = [u('first'), { kind: 'assistant', uuid: 'a', text: 'hi' } as TranscriptItem, u('second\n[image]')];
  assert.deepEqual(historyFor(items, ['other', 'first', '  ']), ['second', 'first', 'other']);
});

test('remembered puts the newest in front, without repeats, capped', () => {
  assert.deepEqual(remembered(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  assert.deepEqual(remembered(['a', 'b'], 'z', 2), ['z', 'a']);
});

test('fileQuery finds an @ word being typed at the caret', () => {
  assert.deepEqual(fileQuery('look at @src/ap', 15), { query: 'src/ap', start: 8 });
  assert.deepEqual(fileQuery('@', 1), { query: '', start: 0 });
  assert.equal(fileQuery('email me@home', 13), null, 'not after a letter');
  assert.equal(fileQuery('@done ', 6), null, 'a space ends it');
  assert.deepEqual(fileQuery('@a then more', 2), { query: 'a', start: 0 }, 'caret in the middle');
});
