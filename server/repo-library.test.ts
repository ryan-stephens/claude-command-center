import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { branchFromHead, cleanSources, scanSources } from './repo-library.ts';

function fakeRepo(dir: string, head = 'ref: refs/heads/main\n'): void {
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), head);
}

test('branchFromHead reads a branch ref or a detached commit', () => {
  assert.equal(branchFromHead('ref: refs/heads/feature/login\n'), 'feature/login');
  assert.equal(branchFromHead('3f2a9c1d5e7b8a90123456789abcdef012345678\n'), '3f2a9c1');
  assert.equal(branchFromHead('garbage'), undefined);
});

test('scanSources finds git repos one level down, including worktrees, and skips plain folders', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-lib-'));
  try {
    fakeRepo(join(root, 'web-app'));
    fakeRepo(join(root, 'api'), 'ref: refs/heads/develop\n');
    mkdirSync(join(root, 'notes'));
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
    fakeRepo(join(root, 'deep', 'nested')); // two levels down: not listed
    // A worktree: .git is a file pointing at the real git dir.
    mkdirSync(join(root, 'wt'));
    fakeRepo(join(root, 'wt-meta'));
    writeFileSync(join(root, 'wt', '.git'), `gitdir: ${join(root, 'wt-meta', '.git')}\n`);
    const repos = scanSources([root, root]);
    assert.deepEqual(repos.map((r) => r.name).sort(), ['api', 'web-app', 'wt', 'wt-meta']);
    assert.equal(repos.find((r) => r.name === 'api')?.branch, 'develop');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cleanSources makes paths canonical, keeps real folders once and says what was wrong', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-src-'));
  try {
    assert.deepEqual(cleanSources([root, `${root}/`, `"${root}"`]), { sources: [root] });
    assert.match(cleanSources([root, 'relative/path']).problem ?? '', /not a full folder path/);
    assert.match(cleanSources([join(root, 'missing')]).problem ?? '', /There is no folder at/);
    assert.deepEqual(cleanSources('nope'), { sources: [] });
    // A saved source that is offline (an unplugged drive) stays, so removing another still works.
    const offline = join(root, 'unplugged');
    assert.deepEqual(cleanSources([offline, root], [offline]), { sources: [offline, root] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
