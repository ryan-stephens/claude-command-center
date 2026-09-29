import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { crumbsOf, listFolder, normalizeFolder, showFolder } from './fs-browse.ts';

const win = (s: unknown) => normalizeFolder(s, 'win32', 'C:\\Users\\ann');
const nix = (s: unknown) => normalizeFolder(s, 'linux', '/home/ann');

test('normalizeFolder drops the quotes Windows "Copy as path" adds', () => {
  assert.equal(win('"D:\\repos\\my app"'), 'D:\\repos\\my app');
  assert.equal(win('  “D:\\repos”  '), 'D:\\repos');
  assert.equal(win("'D:\\repos'"), 'D:\\repos');
});

test('normalizeFolder keeps drive roots as roots', () => {
  assert.equal(win('D:'), 'D:\\');
  assert.equal(win('D:\\'), 'D:\\');
  assert.equal(win('d:/'), 'D:\\');
  assert.equal(win('D:\\\\'), 'D:\\');
});

test('normalizeFolder takes either slash, trailing slashes, .. and ~', () => {
  assert.equal(win('d:/repos/'), 'D:\\repos');
  assert.equal(win('D:\\repos\\x\\..\\y\\'), 'D:\\repos\\y');
  assert.equal(win('~/code'), 'C:\\Users\\ann\\code');
  assert.equal(win('~'), 'C:\\Users\\ann');
  assert.equal(win('\\\\nas\\share\\repos\\'), '\\\\nas\\share\\repos');
  assert.equal(nix('/home/ann/repos//'), '/home/ann/repos');
  assert.equal(nix('~/repos'), '/home/ann/repos');
  assert.equal(nix('/'), '/');
});

test('normalizeFolder refuses anything that is not a full path', () => {
  for (const bad of ['repos', 'C:repos', '\\repos', '', '   ', '""', 'D:\\a\0b', 42, null]) assert.equal(win(bad), null, String(bad));
  for (const bad of ['repos', './x', 'C:\\repos']) assert.equal(nix(bad), null, bad);
});

test('crumbsOf splits a path into clickable steps', () => {
  assert.deepEqual(crumbsOf('D:\\repos\\app', 'win32'), [
    { name: 'D:', path: 'D:\\' }, { name: 'repos', path: 'D:\\repos' }, { name: 'app', path: 'D:\\repos\\app' },
  ]);
  assert.deepEqual(crumbsOf('D:\\', 'win32'), [{ name: 'D:', path: 'D:\\' }]);
  assert.deepEqual(crumbsOf('/home/ann', 'linux').map((c) => c.path), ['/', '/home', '/home/ann']);
});

test('showFolder hides hidden, system and dependency folders', () => {
  for (const name of ['.git', '.cache', '$RECYCLE.BIN', 'System Volume Information', 'node_modules', 'AppData', '~tmp']) assert.equal(showFolder(name), false, name);
  for (const name of ['repos', 'My Projects', 'src', 'Windows']) assert.equal(showFolder(name), true, name);
});

test('listFolder lists folders only, marks repos and counts the repos inside', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-fs-'));
  const repo = (p: string) => mkdirSync(join(root, p, '.git'), { recursive: true });
  try {
    repo('code/api');
    repo('code/web');
    mkdirSync(join(root, 'code', 'notes'));
    repo('solo');
    mkdirSync(join(root, 'empty'));
    mkdirSync(join(root, '.hidden'));
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'readme.txt'), 'not a folder');
    const l = await listFolder(`"${root}${sep}"`, process.platform);
    assert.equal(l.path, normalizeFolder(root));
    assert.deepEqual(l.entries.map((e) => [e.name, e.repo, e.repos]), [['code', false, 2], ['empty', false, 0], ['solo', true, 0]]);
    assert.equal(l.repos, 1);
    assert.equal(l.truncated, false);
    assert.ok(l.parent);

    const code = await listFolder(join(root, 'code'), process.platform);
    assert.equal(code.repos, 2);
    assert.deepEqual(code.entries.map((e) => e.name), ['api', 'notes', 'web']);
    await assert.rejects(listFolder(join(root, 'missing'), process.platform), /There is no folder at/);
    await assert.rejects(listFolder(join(root, 'readme.txt'), process.platform), /is a file|no folder/);
    await assert.rejects(listFolder('relative\\path', process.platform), /not a full folder path/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
