import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TranscriptItem } from '../shared/protocol.ts';
import { haveOf, mergeTranscript } from './transcript-merge.ts';

const say = (uuid: string, text = uuid): TranscriptItem => ({ kind: 'assistant', uuid, text });

test('what the page holds: its count and last uuid, nothing when it holds nothing', () => {
  assert.equal(haveOf(undefined), undefined);
  assert.equal(haveOf([]), undefined);
  assert.deepEqual(haveOf([say('a'), say('b')]), { count: 2, last: 'b' });
});

test('the tail after what the page has is added; no tail keeps the very same array', () => {
  const before = [say('a'), say('b')];
  assert.equal(mergeTranscript(before, [], 2), before);
  const next = mergeTranscript(before, [say('c')], 2)!;
  assert.deepEqual(next.map((i) => i.uuid), ['a', 'b', 'c']);
  assert.equal(next[0], before[0]);
});

test('items that arrived while the answer was on its way: the server tail from that point replaces them', () => {
  const before = [say('a'), say('b'), say('c')]; // c came over session.items after the page asked with count 2
  const next = mergeTranscript(before, [say('c'), say('d')], 2)!;
  assert.deepEqual(next.map((i) => i.uuid), ['a', 'b', 'c', 'd']);
  assert.equal(next[2], before[2]); // the page's own c, so it isn't drawn again
  assert.equal(mergeTranscript(before, [say('c')], 2), before);
});

test('a whole transcript keeps the page’s objects by uuid, and the same array when nothing changed', () => {
  const before = [say('a'), say('b')];
  const same = mergeTranscript(before, [say('a'), say('b')]);
  assert.equal(same, before);
  const grown = mergeTranscript(before, [say('a'), say('b'), say('c')])!;
  assert.equal(grown[1], before[1]);
  assert.equal(grown.length, 3);
  // A different conversation (a fresh start): new items, nothing kept wrongly.
  const fresh = mergeTranscript(before, [say('x')])!;
  assert.deepEqual(fresh.map((i) => i.uuid), ['x']);
  assert.deepEqual(mergeTranscript(undefined, [say('a')])!.map((i) => i.uuid), ['a']);
  // A tail for a page whose copy was replaced meanwhile: it doesn't fit, so the page asks for all of it.
  assert.equal(mergeTranscript([say('a')], [say('c')], 2), undefined);
  assert.equal(mergeTranscript(undefined, [say('c')], 2), undefined);
});
