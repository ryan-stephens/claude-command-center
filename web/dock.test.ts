import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeSession, isDocked } from './store.ts';

test('the session beside the list takes the session keys only once you step into it', () => {
  assert.equal(activeSession({ screen: 'list', homeCol: 'sessions', openId: null }), null, 'browsing the list');
  assert.equal(activeSession({ screen: 'list', homeCol: 'preview', openId: 's1' }), 's1', 'stepped in');
  assert.equal(activeSession({ screen: 'list', homeCol: 'sessions', openId: 's1' }), null, 'clicked back to the list');
  assert.equal(activeSession({ screen: 'list', homeCol: 'preview', openId: null }), null, 'its session was ended');
  assert.equal(activeSession({ screen: 'session', homeCol: 'sessions', openId: 's1' }), 's1', 'full screen');
});

test('docked means on home, in the pane, with a session', () => {
  assert.equal(isDocked({ screen: 'list', homeCol: 'preview', openId: 's1' }), true);
  assert.equal(isDocked({ screen: 'session', homeCol: 'preview', openId: 's1' }), false, 'full screen is not docked');
  assert.equal(isDocked({ screen: 'list', homeCol: 'preview', openId: null }), false);
});
