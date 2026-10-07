import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { depsState, hasPackages, isLink, linkDeps, lockDiffers, mainCheckout, unlinkDeps, LINK_DEPS } from '../scripts/link-deps.ts';
import { withDeps } from './deps.ts';
import { parseStep, type StepSpec } from '../shared/recipes.ts';

const PKG = JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { 'left-pad': '1.3.0' } });
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A repo with a package.json and lockfile, its main checkout's node_modules installed (a stand-in file), and a worktree without them. */
function repoWithWorktree(opts: { mainModules?: boolean; ignore?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cc-link-'));
  const main = join(root, 'app');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.email', 'test@example.invalid');
  git(main, 'config', 'user.name', 'test');
  writeFileSync(join(main, '.gitignore'), opts.ignore ?? 'node_modules/\n');
  writeFileSync(join(main, '.gitattributes'), '* -text\n');
  writeFileSync(join(main, 'package.json'), PKG);
  writeFileSync(join(main, 'package-lock.json'), '{"lockfileVersion":3}\n');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'init');
  if (opts.mainModules !== false) { mkdirSync(join(main, 'node_modules', 'left-pad'), { recursive: true }); writeFileSync(join(main, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1'); }
  const wt = join(root, 'app-card-1');
  git(main, 'worktree', 'add', '-q', wt, '-b', 'card-1');
  return { root, main, wt, keep: join(main, 'node_modules', 'left-pad', 'index.js') };
}

test('hasPackages and depsState: nothing without packages named or with node_modules; a link when the main checkout has them; missing otherwise', () => {
  const plain = mkdtempSync(join(tmpdir(), 'cc-link-'));
  assert.equal(depsState(plain).state, 'none', 'no package.json');
  writeFileSync(join(plain, 'package.json'), '{"name":"x","scripts":{}}');
  assert.equal(hasPackages(plain), false);
  assert.equal(depsState(plain).state, 'none', 'no packages named');
  const r = repoWithWorktree();
  assert.equal(mainCheckout(r.main), undefined, 'the main checkout is not a worktree of itself');
  assert.equal(mainCheckout(r.wt)?.toLowerCase(), r.main.toLowerCase());
  assert.deepEqual(depsState(r.wt), { state: 'link', main: mainCheckout(r.wt) });
  assert.equal(depsState(r.main).state, 'none', 'the main checkout has them');
  const bare = repoWithWorktree({ mainModules: false });
  assert.equal(depsState(bare.wt).state, 'missing');
  assert.match(linkDeps(bare.wt).text, /install the packages there once/);
  assert.equal(linkDeps(bare.wt).ok, false);
});

test('linkDeps: a junction to the main checkout’s node_modules, out of git status, the lockfile compared', () => {
  const r = repoWithWorktree();
  const out = linkDeps(r.wt);
  assert.equal(out.did, 'linked');
  assert.ok(isLink(join(r.wt, 'node_modules')));
  assert.ok(existsSync(join(r.wt, 'node_modules', 'left-pad', 'index.js')), 'the main checkout’s packages, through the link');
  assert.equal(git(r.wt, 'status', '--porcelain'), '');
  assert.equal(linkDeps(r.wt).did, 'none', 'twice: already there');
  assert.equal(lockDiffers(r.wt, r.main), undefined);
  writeFileSync(join(r.wt, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}\n');
  assert.equal(lockDiffers(r.wt, r.main), 'package-lock.json');
});

test('a .gitignore without node_modules: the link is kept out of git status through .git/info/exclude', () => {
  const r = repoWithWorktree({ ignore: 'dist/\n' });
  linkDeps(r.wt);
  assert.equal(git(r.wt, 'status', '--porcelain'), '');
  assert.match(readFileSync(join(r.main, '.git', 'info', 'exclude'), 'utf8'), /^\/node_modules$/m);
});

test('unlinkDeps first: git worktree remove leaves the main checkout’s packages; without it, git deletes them', () => {
  const r = repoWithWorktree();
  linkDeps(r.wt);
  assert.equal(unlinkDeps(r.wt), true);
  git(r.main, 'worktree', 'remove', '--force', r.wt);
  assert.ok(existsSync(r.keep), 'unlinked first: kept');
  assert.equal(unlinkDeps(r.main), false, 'a real folder is never unlinked');
  // What the unlink is for (Git for Windows follows the junction): only where git does that.
  const s = repoWithWorktree();
  linkDeps(s.wt);
  git(s.main, 'worktree', 'remove', '--force', s.wt);
  if (process.platform === 'win32') assert.ok(!existsSync(s.keep), 'git followed the junction: the reason for unlinkDeps');
  rmSync(r.root, { recursive: true, force: true });
  rmSync(s.root, { recursive: true, force: true });
});

test('the script: links and says so (exit 0); says why and fails when the main checkout has none (exit 1)', () => {
  const r = repoWithWorktree();
  const ok = spawnSync(process.execPath, [LINK_DEPS, r.wt], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /Linked node_modules from the main checkout/);
  const bare = repoWithWorktree({ mainModules: false });
  const no = spawnSync(process.execPath, [LINK_DEPS, bare.wt], { encoding: 'utf8' });
  assert.equal(no.status, 1);
  assert.match(no.stdout, /install the packages there once/);
});

test('withDeps: a packages step first for each folder that needs one, once per folder, never for stop: or ! steps', () => {
  const specs = ['@ui node_modules\\.bin\\nx.cmd serve', '@ui stop: echo bye', '@api dotnet run', 'echo home', '! open it'].map((l) => parseStep(l)!) as StepSpec[];
  const where = (s: StepSpec) => (s.repo ? `C:\\w\\${s.repo}` : 'C:\\w\\home');
  const needs = new Set(['C:\\w\\ui', 'C:\\w\\home']);
  const out = withDeps(specs, where, (dir) => (needs.has(dir) ? 'link' : 'none'));
  assert.equal(out.length, specs.length + 2);
  assert.deepEqual(out.slice(0, 2).map((s) => [s.repo, s.cmd.includes('link-deps.ts')]), [['ui', true], [undefined, true]]);
  assert.ok(!out[0].stop && !out[0].note);
  assert.deepEqual(withDeps(specs, where, () => 'none'), specs, 'nothing needed: unchanged');
  assert.equal(withDeps(specs, where, () => 'missing').length, specs.length + 3, 'missing: the step says why, and stops the run');
  assert.equal(withDeps(specs, () => ({ error: 'no repo' }), () => 'link').length, specs.length, 'a folder that can’t be found is the run’s own error');
});
