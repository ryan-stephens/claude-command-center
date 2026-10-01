import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { makeWorktrees } from './cards.ts';

const dir = mkdtempSync(join(tmpdir(), 'cc-worktrees-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

/** A git repo with one commit, on main. */
function repo(name: string): string {
  const p = join(dir, name);
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'README.md'), name);
  git(p, 'init', '-q', '-b', 'main');
  git(p, 'add', '.');
  git(p, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return p;
}

test('a worktree card gets a worktree of every git repo on one branch; plain folders are left as they are', async () => {
  const ui = repo('shop-ui');
  const api = repo('loans-api');
  const notes = join(dir, 'notes');
  mkdirSync(notes);
  // Someone else's branch is checked out in the API's usual folder: the card's worktree doesn't care.
  git(api, 'switch', '-qc', 'other-work');
  const { folders, skipped } = await makeWorktrees([ui, api, notes], ui, 'CARD-7', 'card-7-fees');
  assert.deepEqual(folders, [{ repo: ui, dir: `${ui}-card-7` }, { repo: api, dir: `${api}-card-7` }]);
  assert.deepEqual(skipped, [notes]);
  assert.equal(git(`${ui}-card-7`, 'branch', '--show-current'), 'card-7-fees');
  assert.equal(git(`${api}-card-7`, 'branch', '--show-current'), 'card-7-fees');
  assert.equal(git(api, 'branch', '--show-current'), 'other-work', 'the usual folder stays where it was');
});

test('if one repo can’t have its worktree, the ones already made are taken back', async () => {
  const ui = repo('web-ui');
  const api = repo('fees-api');
  git(api, 'branch', 'card-8-x');
  await assert.rejects(makeWorktrees([ui, api], ui, 'CARD-8', 'card-8-x'), /Couldn't make a worktree for fees-api/);
  assert.equal(existsSync(`${ui}-card-8`), false, 'the UI’s worktree is gone');
  assert.equal(git(ui, 'branch', '--list', 'card-8-x'), '', 'and its branch');
  assert.equal(git(api, 'branch', '--list', 'card-8-x'), 'card-8-x', 'a branch that was there before is kept');
});

test('the home repo must be a git repo', async () => {
  const plain = join(dir, 'plain');
  mkdirSync(plain);
  await assert.rejects(makeWorktrees([plain], plain, 'CARD-9', 'card-9'), /plain isn’t a git repo/);
});
