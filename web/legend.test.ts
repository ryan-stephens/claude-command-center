import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legendFor, lineLegendFor, type LegendInput } from './legend.ts';

const base: LegendInput = { zone: 'composer', pending: false, busy: false, drafting: false, bindings: {} };
const labels = (x: Partial<LegendInput>) => legendFor({ ...base, ...x }).map((i) => `${i.keys.join('+')} ${i.label}`);

test('session: Esc means stop while busy, and typing hides the numpad and talk keys', () => {
  assert.ok(labels({ busy: true }).includes('Esc Stop Claude'));
  assert.ok(!labels({ busy: false }).includes('Esc Stop Claude'));
  assert.ok(labels({}).includes('Hold ` Talk'));
  assert.ok(!labels({ drafting: true }).some((x) => x.includes('Talk')));
  assert.ok(labels({ pending: true }).includes('Tab Answer Claude'));
  assert.deepEqual(labels({ zone: 'board', pending: true }).slice(0, 4), ['← →+Enter Choose', 'Y Allow', 'A Always', 'N Don’t allow']);
  assert.ok(labels({ zone: 'board' }).includes('Esc Ticket Line'));
  assert.ok(labels({}).includes('Ctrl+Enter Back to the line'), 'the expand key goes back where the session was opened from');
});

test('rebound keys show their current binding', () => {
  assert.ok(labels({ bindings: { pushToTalk: ['F9'] } }).includes('Hold F9 Talk'));
  assert.ok(labels({ bindings: { expand: ['Alt+Enter'] } }).includes('Alt+Enter Back to the line'));
});

test('a question or a plan changes the answer keys', () => {
  const q = labels({ zone: 'board', pending: true, pendingKind: 'question' });
  assert.ok(q.includes('↑+↓ Choose') && q.includes('Enter Pick') && q.includes('N Skip'));
  assert.ok(!q.includes('Y Allow'), 'a question is answered, not allowed');
  const p = labels({ zone: 'board', pending: true, pendingKind: 'plan' });
  assert.ok(p.includes('Y Start the plan') && p.includes('N Keep planning'));
  assert.ok(labels({ zone: 'composer' }).includes('⇧Tab Mode'));
});

test('the Ticket Line bar follows the view and the new-card panel', () => {
  const labels = (x: Parameters<typeof lineLegendFor>[0]) => lineLegendFor(x).map((i) => i.label);
  assert.deepEqual(labels({ view: 'board', bindings: {} }), ['Move', 'New card', 'Tickets', 'Inbox: mine / QA', 'Workspace / all', 'Filter', 'Repos', 'Workspace', 'Share / import', 'Folders']);
  const focused = labels({ view: 'board', hasFocus: true, hasSession: true, filtered: true, bindings: {} });
  assert.ok(focused.includes('Open') && focused.includes('Full screen') && focused.includes('Clear filter') && focused.includes('Remove'));
  assert.ok(!labels({ view: 'board', hasFocus: true, bindings: {} }).includes('Full screen'), 'no session linked yet: nothing to open');
  assert.ok(labels({ view: 'composer', pane: 'src', bindings: {} }).includes('Add or remove'));
  assert.ok(labels({ view: 'composer', pane: 'src', bindings: {} }).includes('Tickets / Repos / Folders'));
  assert.equal(labels({ view: 'board', onTicket: true, bindings: {} })[1], 'Start work', 'a ticket in the Inbox: n starts work');
  assert.equal(labels({ view: 'board', onTicket: true, bindings: {} })[2], 'Hide', 'and Delete hides it');
  assert.ok(labels({ view: 'composer', pane: 'pkt', bindings: {} }).includes('Include or leave out'));
  assert.ok(!labels({ view: 'composer', pane: 'pkt', bindings: {} }).includes('Keep for the workspace'));
  assert.ok(labels({ view: 'composer', pane: 'pkt', cardRepo: true, bindings: {} }).includes('Keep for the workspace'));
  assert.ok(!labels({ view: 'composer', pane: 'pkt', preview: true, bindings: {} }).includes('Remove'), 'the preview has nothing to toggle');
  assert.ok(labels({ view: 'composer', pane: 'go', bindings: {} }).includes('Change'));
  assert.deepEqual(labels({ view: 'drawer', bindings: {} }), ['Back to the board', 'Overview · Context', 'Run recipe', 'Remove card']);
  assert.ok(labels({ view: 'drawer', hasSession: true, bindings: {} }).includes('Type to it here'));
  assert.deepEqual(labels({ view: 'drawer', canAdd: true, hasWaiting: true, bindings: {} }).slice(2, 5), ['Run recipe', 'Add context', 'Take back']);
  assert.deepEqual(labels({ view: 'drawer', canTry: true, bindings: {} }).slice(2, 4), ['Try it', 'Run recipe']);
  assert.deepEqual(labels({ view: 'drawer', canTry: true, appRunning: true, appUp: true, bindings: {} }).slice(2, 4), ['Stop the app', 'Open the app']);
  assert.ok(labels({ view: 'board', hasFocus: true, canTry: true, bindings: {} }).includes('Try it'));
  assert.ok(labels({ view: 'board', hasFocus: true, ship: 'ship', bindings: {} }).includes('Ship'));
  assert.ok(labels({ view: 'drawer', ship: 'merge', bindings: {} }).includes('Merge'));
  const adding = labels({ view: 'composer', pane: 'pkt', addingTo: 'SHOP-155', cardRepo: true, bindings: {} });
  assert.ok(adding.includes('Add to SHOP-155') && !adding.includes('Model') && !adding.includes('Keep for the workspace'), 'adding to a running card');
  assert.deepEqual(lineLegendFor({ view: 'board', hasSession: true, hasFocus: true, bindings: { expand: ['Alt+Enter'] } }).find((i) => i.label === 'Full screen')!.keys, ['Alt+Enter']);
});
