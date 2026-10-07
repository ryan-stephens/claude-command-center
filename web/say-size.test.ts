import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampSay, fitHeight, SAY_MIN } from './say-size.ts';

test('§118: the box’s height: never under its smallest, never over 60% of the window, taller for its text', () => {
  assert.equal(clampSay(10, 1000), SAY_MIN);
  assert.equal(clampSay(300, 1000), 300);
  assert.equal(clampSay(900, 1000), 600);
  assert.equal(clampSay(100, 50), SAY_MIN, 'a tiny window still leaves the smallest box');
  assert.equal(fitHeight(60, 40, 1000), 60, 'short text: the chosen height');
  assert.equal(fitHeight(60, 240, 1000), 240, 'long text: grows with it');
  assert.equal(fitHeight(60, 2000, 1000), 600, '…up to its share of the window');
  assert.equal(fitHeight(400, 100, 1000), 400, 'a box made taller stays that tall');
});
