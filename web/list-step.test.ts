import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAST_STEP, listStep, stepped } from './list-step.ts';

const plain = { ctrlKey: false, metaKey: false };
const ctrl = { ctrlKey: true, metaKey: false };

test('Ctrl or Cmd moves several rows, a bare arrow one', () => {
  assert.equal(listStep(plain), 1);
  assert.equal(listStep(ctrl), FAST_STEP);
  assert.equal(listStep({ ctrlKey: false, metaKey: true }), FAST_STEP);
});

test('fast steps stop at the ends of the list', () => {
  assert.equal(stepped(0, 20, 1, ctrl), FAST_STEP);
  assert.equal(stepped(18, 20, 1, ctrl), 19);
  assert.equal(stepped(2, 20, -1, ctrl), 0);
  assert.equal(stepped(3, 20, -1, plain), 2);
  assert.equal(stepped(0, 0, 1, ctrl), 0, 'empty list');
});
