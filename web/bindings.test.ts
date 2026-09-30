import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionFor, comboOf, displayCombo, validateBinding } from './bindings.ts';

const ev = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('combos come from physical keys', () => {
  assert.equal(comboOf(ev('KeyK', { ctrlKey: true })), 'Ctrl+K');
  assert.equal(comboOf(ev('Slash', { shiftKey: true })), 'Shift+/');
  assert.equal(comboOf(ev('ArrowUp', { altKey: true })), 'Alt+ArrowUp');
  assert.equal(comboOf(ev('Backquote')), '`');
  assert.equal(comboOf(ev('ShiftLeft', { shiftKey: true })), null);
});

test('display names', () => {
  assert.equal(displayCombo('Shift+/'), '?');
  assert.equal(displayCombo('Alt+ArrowDown'), 'Alt+↓');
});

test('defaults resolve, and overrides replace them', () => {
  assert.equal(actionFor('Ctrl+K', {}), 'palette');
  assert.equal(actionFor('Ctrl+K', { palette: ['Ctrl+P'] }), null);
  assert.equal(actionFor('Ctrl+P', { palette: ['Ctrl+P'] }), 'palette');
});

test('validation blocks conflicts, reserved keys and bare keys for in-text actions', () => {
  assert.match(validateBinding('palette', 'Alt+N', {})!, /already bound/);
  assert.match(validateBinding('palette', 'Enter', {})!, /used by the app/);
  assert.match(validateBinding('palette', 'Q', {})!, /needs Ctrl, Alt or Meta/);
  assert.match(validateBinding('sound', 'U', {})!, /used by the app/, 'u opens the Unticketed row');
  assert.match(validateBinding('sound', 'Shift+Delete', {})!, /used by the app/, 'Shift+Delete deletes a workspace');
  assert.equal(validateBinding('palette', 'Ctrl+P', {}), null);
  assert.equal(validateBinding('sound', 'S', {}), null);
  assert.match(validateBinding('help', 'Y', {})!, /used by the app/);
  assert.match(validateBinding('palette', 'Alt+3', {})!, /used by the app/);
});
