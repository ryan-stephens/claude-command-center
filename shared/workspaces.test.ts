import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Workspace } from './protocol.ts';
import { addPath, homeRepo, isInside, normPath, repoName, samePath, suggestSources, workspaceRepos, workspacesFor } from './workspaces.ts';

const ws = (id: string, repos: string[], home?: string): Workspace => ({ id, name: id, color: 'blue', repos, home });

test('Windows paths compare case-insensitively and ignore slash style', () => {
  assert.ok(samePath('D:\\Repos\\Web-App\\', 'd:/repos/web-app'));
  assert.ok(!samePath('/home/me/App', '/home/me/app'), 'POSIX paths stay case-sensitive');
  assert.equal(normPath('C:\\a\\b\\'), 'c:/a/b');
});

test('isInside matches the folder itself and anything under it, not siblings with a shared prefix', () => {
  assert.ok(isInside('D:\\repos\\web-app', 'D:\\repos\\web-app'));
  assert.ok(isInside('D:\\repos\\web-app\\packages\\ui', 'D:\\repos\\web-app'));
  assert.ok(!isInside('D:\\repos\\web-app-2', 'D:\\repos\\web-app'));
});

test('a session belongs to every workspace that holds its folder', () => {
  const store = ws('store', ['D:\\repos\\web-app', 'D:\\repos\\api']);
  const design = ws('design', ['D:\\repos\\web-app']);
  const pay = ws('pay', ['D:\\repos\\payments']);
  assert.deepEqual(workspacesFor('d:/repos/web-app/src', [store, design, pay]).map((w) => w.id), ['store', 'design']);
  assert.deepEqual(workspacesFor('C:\\elsewhere', [store, pay]), []);
  assert.deepEqual(workspacesFor('', [store]), []);
});

test('home repo falls back to the first repo when unset or no longer in the workspace', () => {
  assert.equal(homeRepo(ws('a', ['x', 'y'], 'y')), 'y');
  assert.equal(homeRepo(ws('a', ['x', 'y'])), 'x');
  assert.equal(homeRepo(ws('a', ['x'], 'gone')), 'x');
  assert.equal(homeRepo(ws('a', [])), undefined);
});

test('addPath does not duplicate a path written differently', () => {
  assert.deepEqual(addPath(['D:\\repos\\a'], 'd:/repos/a/'), ['D:\\repos\\a']);
  assert.deepEqual(addPath(['D:\\repos\\a'], 'D:\\repos\\b'), ['D:\\repos\\a', 'D:\\repos\\b']);
});

test('repoName is the last folder', () => {
  assert.equal(repoName('C:\\repos\\web-app\\'), 'web-app');
  assert.equal(repoName('/srv/api'), 'api');
});

test('suggestSources finds the parents that hold several past session folders', () => {
  const cwds = ['D:\\repos\\a', 'D:\\repos\\b', 'D:\\repos\\c', 'C:\\Users\\me', 'C:\\work\\x', 'C:\\work\\y', 'C:\\tmp\\once'];
  assert.deepEqual(suggestSources(cwds), ['D:\\repos', 'C:\\work']);
});

test('a session can use every repo of the workspaces holding its folder, except its own', () => {
  const ws = (id: string, repos: string[]): Workspace => ({ id, name: id, color: 'blue', repos });
  const all = [ws('store', ['C:/r/web', 'C:/r/api', 'C:/r/docs']), ws('pay', ['C:/r/api', 'C:/r/billing']), ws('other', ['C:/r/x'])];
  assert.deepEqual(workspaceRepos('C:/r/web', all), ['C:/r/api', 'C:/r/docs']);
  // In two workspaces: both sets, once each.
  assert.deepEqual(workspaceRepos('c:/r/API', all), ['C:/r/web', 'C:/r/docs', 'C:/r/billing']);
  // A subfolder of a repo belongs to its workspace; the repo containing it is not "another" repo.
  assert.deepEqual(workspaceRepos('C:/r/web/packages/ui', all), ['C:/r/api', 'C:/r/docs']);
  assert.deepEqual(workspaceRepos('D:/elsewhere', all), []);
});
