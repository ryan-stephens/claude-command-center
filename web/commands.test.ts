import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CommandGroup } from '../shared/protocol.ts';
import { cycleGroup } from './commands.ts';
import { currentGroup, get, groupKeyOf, set } from './store.ts';

const group = (name: string, scope: CommandGroup['scope'], workspaceId?: string): CommandGroup =>
  ({ name, scope, workspaceId, commands: [{ slot: 1, label: name, body: name, mode: 'send' }] });

test('cycling groups lands on an exact group, so the number pad can still fire (review finding)', () => {
  const groups = [group('Storefront', 'workspace', 'w1'), group('Mine', 'global'), group('Skills', 'auto')];
  set({ openId: 's1', board: { sessionId: 's1', groups }, groupKey: groupKeyOf(groups[0]) });
  cycleGroup(1);
  assert.deepEqual([currentGroup(get()).group?.name, currentGroup(get()).exact], ['Mine', true]);
  cycleGroup(1);
  cycleGroup(1);
  assert.deepEqual([currentGroup(get()).group?.name, currentGroup(get()).exact], ['Storefront', true]);
  cycleGroup(-1);
  assert.equal(currentGroup(get()).group?.name, 'Skills');
});
