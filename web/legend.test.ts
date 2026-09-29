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

test('the preview answers approvals; without one it offers open', () => {
  assert.deepEqual(labels({ homeCol: 'preview', pending: true }).slice(0, 3), ['Y Allow', 'A Always', 'N Don’t allow']);
  assert.equal(labels({ homeCol: 'preview' })[0], 'Enter Open');
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
  assert.deepEqual(labels({ ...s, zone: 'board', pending: true }).slice(0, 3), ['Y Allow', 'A Always', 'N Don’t allow']);
  assert.ok(labels({ ...s, zone: 'board' }).includes('Esc Home'));
});

test('rebound keys show their current binding', () => {
  assert.ok(labels({ screen: 'session', bindings: { pushToTalk: ['F9'] } }).includes('Hold F9 Talk'));
});
