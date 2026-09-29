import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FolderEntry } from '../shared/protocol.ts';
import { filterEntries, looksLikePath, repoSummary, splitTyped } from './folder-model.ts';

test('looksLikePath tells a path to jump to from a name to filter by', () => {
  for (const p of ['D:\\repos', 'd:', '"C:\\My Stuff"', '“D:\\x”', '/home/ann', '~', '~/code', '\\\\nas\\share']) assert.equal(looksLikePath(p), true, p);
  for (const p of ['repos', 'my app', '~tmp', '']) assert.equal(looksLikePath(p), false, p);
});

test('splitTyped splits a half-typed path into the folder and the name being typed', () => {
  assert.deepEqual(splitTyped('D:\\repos\\we'), { dir: 'D:\\repos\\', partial: 'we' });
  assert.deepEqual(splitTyped('"D:\\repos\\"'), { dir: 'D:\\repos\\', partial: '' });
  assert.deepEqual(splitTyped('/home/an'), { dir: '/home/', partial: 'an' });
  assert.deepEqual(splitTyped('D:'), { dir: 'D:', partial: '' });
});

test('filterEntries matches any part of the name, prefix matches first', () => {
  const e = (name: string): FolderEntry => ({ name, path: `D:\\${name}`, repo: false, repos: 0 });
  const list = [e('api'), e('web-app'), e('Apps'), e('docs')];
  assert.deepEqual(filterEntries(list, 'ap').map((x) => x.name), ['api', 'Apps', 'web-app']);
  assert.deepEqual(filterEntries(list, '  ').map((x) => x.name), ['api', 'web-app', 'Apps', 'docs']);
  assert.deepEqual(filterEntries(list, 'zzz'), []);
});

test('repoSummary', () => {
  assert.equal(repoSummary({ repo: true, repos: 0 }), 'git repo');
  assert.equal(repoSummary({ repo: false, repos: 1 }), '1 repo inside');
  assert.equal(repoSummary({ repo: false, repos: 12 }), '12 repos inside');
  assert.equal(repoSummary({ repo: false, repos: 0 }), '');
});
