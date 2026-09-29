import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legendFor, type LegendInput } from './legend.ts';

const base: LegendInput = {
  screen: 'list', homeCol: 'sessions', zone: 'composer', pending: false, busy: false, drafting: false,
  hasSelection: true, inWorkspace: true, bindings: {},
};
const labels = (x: Partial<LegendInput>) => legendFor({ ...base, ...x }).map((i) => `${i.keys.join('+')} ${i.label}`);

test('home sessions column teaches the column model and new session', () => {
  const l = labels({});
  assert.ok(l.includes('←+→ Columns'));
  assert.ok(l.includes('N New session'));
  assert.ok(!l.some((x) => x.includes('Answer')));
  assert.ok(labels({ pending: true }).includes('→ Answer it here'));
  assert.ok(labels({ pending: true, previewShown: false }).includes('Enter Open to answer'), 'no hidden-column promise');
});

test('the sessions column goes into the docked session, or full screen when it does not fit', () => {
  assert.ok(labels({}).includes('Enter Go into it'));
  assert.ok(labels({}).includes('Ctrl+Enter Full screen'));
  const narrow = labels({ previewShown: false });
  assert.ok(narrow.includes('Enter Open') && !narrow.some((x) => x.includes('Full screen')));
});

test('docked: session keys, Esc back to the list, the expand key goes full screen', () => {
  const d = { homeCol: 'preview' as const, docked: true };
  const c = labels(d);
  assert.ok(c.includes('Enter Send') && c.includes('Esc Back to the list') && c.includes('Ctrl+Enter Full screen'));
  assert.ok(!labels({ ...d, busy: true }).includes('Esc Back to the list'), 'Esc stops Claude first');
  assert.deepEqual(labels({ ...d, zone: 'board', pending: true }).slice(0, 4), ['← →+Enter Choose', 'Y Allow', 'A Always', 'N Don’t allow']);
  assert.ok(labels({ ...d, zone: 'board' }).includes('C Fold this pane'));
  assert.ok(labels({ screen: 'session' }).includes('Ctrl+Enter Beside the list'));
  assert.ok(!labels({ screen: 'session', previewShown: false }).some((x) => x.includes('Beside')));
});

test('workspace-only keys hide outside a workspace', () => {
  assert.ok(labels({ homeCol: 'workspaces' }).includes('E Edit'));
  assert.ok(!labels({ homeCol: 'workspaces', inWorkspace: false }).includes('E Edit'));
  assert.ok(!labels({ homeCol: 'library', inWorkspace: false }).includes('Enter Add to this workspace'));
});

test('session: Esc means stop while busy, and typing hides the numpad and talk keys', () => {
  const s = { screen: 'session' as const };
  assert.ok(labels({ ...s, busy: true }).includes('Esc Stop Claude'));
  assert.ok(!labels({ ...s, busy: false }).includes('Esc Stop Claude'));
  assert.ok(labels({ ...s }).includes('Hold ` Talk'));
  assert.ok(!labels({ ...s, drafting: true }).some((x) => x.includes('Talk')));
  assert.ok(labels({ ...s, pending: true }).includes('Tab Answer Claude'));
  assert.deepEqual(labels({ ...s, zone: 'board', pending: true }).slice(0, 4), ['← →+Enter Choose', 'Y Allow', 'A Always', 'N Don’t allow']);
  assert.ok(labels({ ...s, zone: 'board' }).includes('Esc Home'));
});

test('rebound keys show their current binding', () => {
  assert.ok(labels({ screen: 'session', bindings: { pushToTalk: ['F9'] } }).includes('Hold F9 Talk'));
});

test('a question or a plan changes the answer keys', () => {
  const q = labels({ screen: 'session', zone: 'board', pending: true, pendingKind: 'question' });
  assert.ok(q.includes('↑+↓ Choose') && q.includes('Enter Pick') && q.includes('N Skip'));
  assert.ok(!q.includes('Y Allow'), 'a question is answered, not allowed');
  const p = labels({ screen: 'session', zone: 'board', pending: true, pendingKind: 'plan' });
  assert.ok(p.includes('Y Start the plan') && p.includes('N Keep planning'));
  assert.ok(labels({ screen: 'session', zone: 'composer' }).includes('⇧Tab Mode'));
});
