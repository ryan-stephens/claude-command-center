import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { Card } from '../shared/cards.ts';
import { CardService, makeWorktrees, removeWorktrees, worktreeStates } from './cards.ts';
import { Store } from './store.ts';

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

test('a repo added later joins the card’s branch: made in that repo if it has to be, used if it is there', async () => {
  const fees = repo('fees-svc');
  const docs = repo('docs-site');
  git(docs, 'branch', 'card-10-fees');
  const { folders } = await makeWorktrees([fees, docs], '', 'CARD-10', 'card-10-fees', true);
  assert.deepEqual(folders.map((f) => f.dir), [`${fees}-card-10`, `${docs}-card-10`]);
  assert.equal(git(`${fees}-card-10`, 'branch', '--show-current'), 'card-10-fees', 'made for fees-svc');
  assert.equal(git(`${docs}-card-10`, 'branch', '--show-current'), 'card-10-fees', 'docs-site already had it');
  // Taken back on a clash: the branch made for fees-svc goes, the one docs-site had stays.
  const clash = repo('clash-api');
  mkdirSync(`${clash}-card-11`);
  await assert.rejects(makeWorktrees([repo('ok-api'), clash], '', 'CARD-11', 'card-11-x', true), /already exists/);
  assert.equal(git(join(dir, 'ok-api'), 'branch', '--list', 'card-11-x'), '', 'the branch made on the way is gone');
});

test('what each worktree holds, and removing the clean ones (or all of them) with the branch', async () => {
  const ui = repo('pay-ui');
  const api = repo('pay-api');
  const lib = repo('pay-lib');
  const branch = 'card-12-refunds';
  const { folders } = await makeWorktrees([ui, api, lib], ui, 'CARD-12', branch);
  writeFileSync(join(`${api}-card-12`, 'new.txt'), 'x');
  git(`${lib}-card-12`, 'add', '.');
  writeFileSync(join(`${lib}-card-12`, 'README.md'), 'changed');
  git(`${lib}-card-12`, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'work');
  const card = { folders, branchName: branch, launch: { home: ui, branch: 'worktree' as const, mode: 'plan' as const, message: '' } };
  const states = await worktreeStates(card);
  assert.deepEqual(states.map((w) => [w.dir, w.branch, w.changed, w.unpushed, w.missing]), [
    [`${ui}-card-12`, branch, false, 0, false],
    [`${api}-card-12`, branch, true, 0, false],
    [`${lib}-card-12`, branch, false, 1, false],
  ]);
  const first = await removeWorktrees(card, false);
  assert.deepEqual(first.removed.map((w) => w.dir), [`${ui}-card-12`], 'only the clean one');
  assert.deepEqual(first.kept.map((w) => w.dir), [`${api}-card-12`, `${lib}-card-12`]);
  assert.equal(existsSync(`${ui}-card-12`), false);
  assert.equal(git(ui, 'branch', '--list', branch), '', 'its branch went with it');
  assert.equal(existsSync(`${api}-card-12`), true, 'uncommitted work stays');
  // Removed by hand in the meantime: pruned, not an error.
  rmSync(`${lib}-card-12`, { recursive: true, force: true });
  const left = { ...card, folders: first.kept };
  assert.equal((await worktreeStates(left)).find((w) => w.dir.endsWith('pay-lib-card-12'))!.missing, true);
  const second = await removeWorktrees(left, true);
  assert.deepEqual(second.removed.map((w) => w.dir), [`${api}-card-12`, `${lib}-card-12`]);
  assert.deepEqual(second.kept, []);
  assert.equal(git(api, 'branch', '--list', branch), '', 'forced: the branch with its unsaved work is gone');
  assert.equal(git(lib, 'worktree', 'list').split('\n').length, 1, 'the pruned worktree is forgotten');
});

test('the service: c on a worktree card makes a worktree, Shift+X waits for Done unless the card is going', async () => {
  const db = mkdtempSync(join(tmpdir(), 'cc-wt-db-'));
  const store = new Store(join(db, 'test.db'));
  after(() => { store.close(); rmSync(db, { recursive: true, force: true }); });
  const cards = new CardService(store, { port: 7788, changed: () => {} });
  const home = repo('home-ui');
  const later = repo('later-api');
  const notes = join(dir, 'later-notes');
  mkdirSync(notes);
  const branch = 'card-13-size';
  const { folders } = await makeWorktrees([home], home, 'CARD-13', branch);
  const card: Card = {
    id: crypto.randomUUID(), key: 'CARD-13', title: 'Size', workspaceId: null, stage: 'build', createdAt: Date.now(), folders, cwd: folders[0].dir, branchName: branch,
    packet: { workspace: [{ kind: 'repo', id: home, label: 'home-ui', on: true }], ticket: [], card: [], note: '' },
    launch: { home, branch: 'worktree', mode: 'plan', message: 'Plan CARD-13.' }, boot: [],
  };
  store.saveCard(card, 'tok');
  cards.sessionStart(card.id, 'tok', { session_id: 'wt-session-13', source: 'startup' });
  await cards.addContext(card.id, [{ kind: 'repo', id: later, label: 'later-api', on: true }, { kind: 'repo', id: notes, label: 'notes', on: true }], '');
  const saved = cards.get(card.id)!;
  assert.deepEqual(saved.folders!.map((f) => f.dir), [`${home}-card-13`, `${later}-card-13`], 'the git repo got a worktree; the plain folder is used as it is');
  assert.equal(git(`${later}-card-13`, 'branch', '--show-current'), branch);
  assert.match(saved.boot.at(-1)!.text, /Made a worktree later-api-card-13 on card-13-size/);
  const out = cards.hookEvent(card.id, 'tok', 'UserPromptSubmit', { session_id: 'wt-session-13', prompt: 'go' }) as { hookSpecificOutput: { additionalContext: string } };
  const text = out.hookSpecificOutput.additionalContext;
  assert.ok(text.includes(`- later-api: ${later}-card-13 (a worktree of ${later} on this card’s branch`), 'Claude is sent the worktree');
  assert.ok(text.includes(`/add-dir ${later}-card-13`), 'and told what to ask for');
  assert.ok(text.includes(`- later-notes: ${notes}\n`), 'the plain folder as it is');

  await assert.rejects(cards.removeWorktrees(card.id, false), /isn’t done/);
  assert.equal(existsSync(`${later}-card-13`), true);
  const going = await cards.removeWorktrees(card.id, false, true);
  assert.deepEqual(going.removed.map((w) => w.dir), [`${home}-card-13`, `${later}-card-13`]);
  assert.deepEqual(cards.get(card.id)!.folders, []);
  assert.match(cards.get(card.id)!.boot.at(-1)!.text, /^Removed home-ui-card-13, later-api-card-13 and the branch card-13-size$/);
});
