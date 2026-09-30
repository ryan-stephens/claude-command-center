import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RepoInfo, Workspace } from '../shared/protocol.ts';
import { workspaceFromFile, workspaceToFile } from './workspace-file.ts';

const ws: Workspace = { id: 'w1', name: 'Storefront', color: 'orange', repos: ['C:\\me\\web-app', 'C:\\me\\cdn-worker'], home: 'C:\\me\\cdn-worker' };
const pack = { version: 1 as const, groups: [{ name: 'Storefront', commands: [{ slot: 1, label: 'Continue', body: 'Continue.', mode: 'send' as const }] }] };

test('a workspace recipe travels in the file, and comes back as text (nothing runs on import)', () => {
  const recipe = { repo: '', workspaceId: 'w', source: '', steps: ['@api okteto deploy', 'stop: @api okteto destroy'], url: 'http://localhost:4200' };
  const file = workspaceToFile(ws, pack, recipe);
  assert.deepEqual(file.recipe, { steps: ['@api okteto deploy', 'stop: @api okteto destroy'], url: 'http://localhost:4200' });
  const back = workspaceFromFile({ ...file, recipe: { steps: ['ok', 42, 'x'.repeat(900)], url: 'javascript:alert(1)' } }, []);
  assert.deepEqual(back.recipe!.steps.map((s) => s.length), [2, 500], 'strings only, bounded');
  assert.equal(back.recipe!.url, undefined, 'only http(s) addresses');
  assert.equal(workspaceFromFile(workspaceToFile(ws, pack), []).recipe, undefined);
});

test('export carries repo names, the home flag and workflows, never paths', () => {
  const file = workspaceToFile(ws, pack);
  assert.deepEqual(file.repos, [{ name: 'web-app' }, { name: 'cdn-worker', home: true }]);
  assert.equal(file.workflows.groups[0].commands[0].label, 'Continue');
  assert.ok(!JSON.stringify(file).includes('C:\\\\me'));
});

test('import matches repos by name in the library and reports the rest', () => {
  const library: RepoInfo[] = [{ path: 'D:\\teammate\\Web-App', name: 'Web-App' }];
  const r = workspaceFromFile(workspaceToFile(ws, pack), library);
  assert.deepEqual(r.workspace.repos, ['D:\\teammate\\Web-App']);
  assert.equal(r.workspace.home, undefined, 'the home repo was the missing one');
  assert.deepEqual(r.missing, ['cdn-worker']);
  assert.equal(r.workflows.groups.length, 1);
});

test('import rejects files that are not workspaces, and cleans odd values', () => {
  assert.throws(() => workspaceFromFile({ groups: [] }, []), /Not a workspace file/);
  assert.throws(() => workspaceFromFile({ kind: 'cc-control.workspace', name: '  ' }, []), /no name/);
  const r = workspaceFromFile({ kind: 'cc-control.workspace', name: 'X', color: 'neon', repos: [{ name: 42 }, null] }, []);
  assert.deepEqual(r.workspace, { name: 'X', color: 'blue', repos: [], home: undefined });
});

test('a workspace’s notes and how the team tests travel in the file, bounded on import', () => {
  const ws: Workspace = { id: 'w', name: 'Team', color: 'blue', repos: [], notes: 'Proxy to Okteto.', testing: 'Use the scenario tool.' };
  const file = workspaceToFile(ws, null);
  assert.equal(file.notes, 'Proxy to Okteto.');
  assert.equal(file.testing, 'Use the scenario tool.');
  const back = workspaceFromFile({ ...file, testing: 'x'.repeat(9000), notes: 42 }, []);
  assert.equal(back.workspace.testing!.length, 8000);
  assert.equal(back.workspace.notes, undefined);
});
