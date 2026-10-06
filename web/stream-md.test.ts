import assert from 'node:assert/strict';
import { test } from 'node:test';
import { streamBlocks } from './stream-md.ts';

test('streaming text splits at blank lines; the last block is the one being written', () => {
  assert.deepEqual(streamBlocks(''), ['']);
  assert.deepEqual(streamBlocks('Hello wor'), ['Hello wor']);
  assert.deepEqual(streamBlocks('One.\n\nTwo is gro'), ['One.\n', 'Two is gro']);
  assert.deepEqual(streamBlocks('One.\n\nTwo.\n\n- a\n- b'), ['One.\n', 'Two.\n', '- a\n- b']);
});

test('a blank line just typed does not end the block until the next one begins', () => {
  assert.deepEqual(streamBlocks('One.\n\n'), ['One.\n\n']);
  assert.deepEqual(streamBlocks('One.\n\nT'), ['One.\n', 'T']);
});

test('blank lines inside a code fence never split it, finished or not', () => {
  const open = 'Look:\n\n```ts\nconst a = 1;\n\nconst b = 2;';
  assert.deepEqual(streamBlocks(open), ['Look:\n', '```ts\nconst a = 1;\n\nconst b = 2;']);
  const closed = `${open}\n\`\`\`\n\nAfter.`;
  assert.deepEqual(streamBlocks(closed), ['Look:\n', '```ts\nconst a = 1;\n\nconst b = 2;\n```\n', 'After.']);
});

test('the blocks put back together are the text', () => {
  const text = 'A\n\nB\n\n```\nx\n\ny\n```\n\n\nC';
  const blocks = streamBlocks(text);
  // Each split drops one blank line: joining with it restores the text.
  assert.equal(blocks.join('\n'), text);
  assert.equal(blocks.length, 4);
});
