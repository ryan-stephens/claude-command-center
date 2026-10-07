import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { depsState, hasPackages, isLink, linkDeps, lockDiffers, mainCheckout, unlinkDeps, LINK_DEPS } from '../scripts/link-deps.ts';
import { withDeps } from './deps.ts';
import { parseStep, type StepSpec } from '../shared/recipes.ts';

const PKG = JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { 'left-pad': '1.3.0' } });
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const base = () => mkdtempSync(join(tmpdir(), 'cc-locks-'));

/**
 * A repo with a package.json and lockfile, its main checkout "installed" (a package, a .bin shim,
 * a workspace package linked from node_modules, and a link to a folder outside the repo), and a
 * worktree without node_modules.
 */
function repoWithWorktree(opts: { mainModules?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cc-link-'));
  const main = join(root, 'app');
  mkdirSync(join(main, 'libs', 'shared'), { recursive: true });
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.email', 'test@example.invalid');
  git(main, 'config', 'user.name', 'test');
  writeFileSync(join(main, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(main, '.gitattributes'), '* -text\n');
  writeFileSync(join(main, 'package.json'), PKG);
  writeFileSync(join(main, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(join(main, 'libs', 'shared', 'index.js'), 'module.exports = "shared"');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'init');
  const outside = join(root, 'outside-pkg');
  const nm = join(main, 'node_modules');
  if (opts.mainModules !== false) {
    mkdirSync(join(nm, 'left-pad'), { recursive: true });
    writeFileSync(join(nm, 'left-pad', 'index.js'), 'module.exports = 1');
    writeFileSync(join(nm, 'left-pad', 'package.json'), '{"name":"left-pad"}');
    mkdirSync(join(nm, '.bin'));
    writeFileSync(join(nm, '.bin', 'left-pad.cmd'), '@echo off');
    mkdirSync(join(nm, '@app'));
    symlinkSync(join(main, 'libs', 'shared'), join(nm, '@app', 'shared'), 'junction');
    mkdirSync(outside);
    writeFileSync(join(outside, 'index.js'), 'module.exports = "outside"');
    symlinkSync(outside, join(nm, 'outside-pkg'), 'junction');
  }
  const wt = join(root, 'app-card-1');
  git(main, 'worktree', 'add', '-q', wt, '-b', 'card-1');
  return { root, main, wt, outside, keep: join(nm, 'left-pad', 'index.js') };
}
/**
 * `git worktree remove --force` by hand. With a workspace package linked inside the clone, git follows
 * that link into the worktree's own folder and then stops with "Directory not empty", leaving the
 * worktree half deleted; the main checkout is never touched. The app's own removal finishes such a
 * folder with fs.rmSync, which doesn't follow links.
 */
const removeByHand = (r: ReturnType<typeof repoWithWorktree>) => {
  const g = spawnSync('git', ['-C', r.main, 'worktree', 'remove', '--force', r.wt], { encoding: 'utf8' });
  if (existsSync(r.wt)) { assert.match(g.stderr, /Directory not empty|failed to delete/, g.stderr); rmSync(r.wt, { recursive: true, force: true }); git(r.main, 'worktree', 'prune'); }
};
const intact = (r: ReturnType<typeof repoWithWorktree>) => existsSync(r.keep) && existsSync(join(r.main, 'node_modules', '.bin', 'left-pad.cmd')) && existsSync(join(r.main, 'libs', 'shared', 'index.js')) && existsSync(join(r.outside, 'index.js'));

test('hasPackages and depsState: nothing without packages named or with a real node_modules; a clone when the main checkout has one; missing otherwise', () => {
  const plain = mkdtempSync(join(tmpdir(), 'cc-link-'));
  assert.equal(depsState(plain).state, 'none', 'no package.json');
  writeFileSync(join(plain, 'package.json'), '{"name":"x","scripts":{}}');
  assert.equal(hasPackages(plain), false);
  const r = repoWithWorktree();
  assert.equal(mainCheckout(r.main), undefined, 'the main checkout is not a worktree of itself');
  assert.equal(mainCheckout(r.wt)?.toLowerCase(), r.main.toLowerCase());
  assert.equal(depsState(r.wt, undefined, base()).state, 'clone');
  assert.equal(depsState(r.main, undefined, base()).state, 'none');
  symlinkSync(join(r.main, 'node_modules'), join(r.wt, 'node_modules'), 'junction');
  assert.equal(depsState(r.wt, undefined, base()).state, 'clone', 'a §110 junction needs the clone too');
  assert.equal(depsState(repoWithWorktree({ mainModules: false }).wt, undefined, base()).state, 'missing');
});

test('linkDeps: a real folder of hard links (package.json copied), links pointed into the worktree, one outside cloned; git status clean', async () => {
  const r = repoWithWorktree();
  const out = await linkDeps(r.wt, base());
  assert.equal(out.did, 'cloned', out.text);
  const nm = join(r.wt, 'node_modules');
  assert.ok(!isLink(nm) && lstatSync(nm).isDirectory(), 'a real folder');
  assert.equal(statSync(join(nm, 'left-pad', 'index.js')).nlink, 2, 'the same data as the main checkout’s file');
  assert.equal(statSync(r.keep).nlink, 2);
  assert.equal(statSync(join(nm, 'left-pad', 'package.json')).nlink, 1, 'package.json copied');
  assert.ok(existsSync(join(nm, '.bin', 'left-pad.cmd')));
  assert.equal(resolve(readlinkSync(join(nm, '@app', 'shared'))).toLowerCase(), resolve(r.wt, 'libs', 'shared').toLowerCase(), 'a workspace package: the worktree’s own');
  assert.ok(!isLink(join(nm, 'outside-pkg')) && existsSync(join(nm, 'outside-pkg', 'index.js')), 'outside the repo: cloned, never linked');
  assert.ok(!existsSync(join(r.wt, 'node_modules.cc-control-tmp')));
  assert.equal(git(r.wt, 'status', '--porcelain'), '');
  assert.equal((await linkDeps(r.wt, base())).did, 'none', 'twice: already there');
  writeFileSync(join(r.wt, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}\n');
  assert.equal(lockDiffers(r.wt, r.main), 'package-lock.json');
});

test('the point of it: git worktree remove by hand (no unlink, --force) leaves the main checkout’s install whole', async () => {
  const r = repoWithWorktree();
  await linkDeps(r.wt, base());
  removeByHand(r);
  assert.ok(!existsSync(r.wt));
  assert.ok(intact(r), 'every file of the main checkout’s node_modules, its workspace package and the outside folder are still there');
  assert.equal(statSync(r.keep).nlink, 1);
  rmSync(r.root, { recursive: true, force: true });
});

test('a §110 junction already there is taken away and replaced by the clone, and the main checkout survives removal', async () => {
  const r = repoWithWorktree();
  symlinkSync(join(r.main, 'node_modules'), join(r.wt, 'node_modules'), 'junction');
  const out = await linkDeps(r.wt, base());
  assert.equal(out.did, 'cloned');
  assert.ok(!isLink(join(r.wt, 'node_modules')));
  removeByHand(r);
  assert.ok(intact(r));
  assert.equal(unlinkDeps(r.main), false, 'a real folder is never unlinked');
});

test('a half-made clone from before is thrown away and made again; missing packages say why and fail', async () => {
  const r = repoWithWorktree();
  mkdirSync(join(r.wt, 'node_modules.cc-control-tmp', 'junk'), { recursive: true });
  assert.equal((await linkDeps(r.wt, base())).did, 'cloned');
  assert.ok(!existsSync(join(r.wt, 'node_modules', 'junk')) && !existsSync(join(r.wt, 'node_modules.cc-control-tmp')));
  const bare = repoWithWorktree({ mainModules: false });
  const no = await linkDeps(bare.wt, base());
  assert.equal(no.ok, false);
  assert.match(no.text, /install the packages there once/);
});

const run = (dir: string) => new Promise<{ code: number; out: string }>((done) => {
  const p = spawn(process.execPath, [LINK_DEPS, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => done({ code: code ?? 1, out }));
});

test('the script: two at once on one folder make one clone (the second waits or finds it); exit 1 with why when there is nothing to take', async () => {
  const r = repoWithWorktree();
  const [a, b] = await Promise.all([run(r.wt), run(r.wt)]);
  assert.equal(a.code, 0, a.out);
  assert.equal(b.code, 0, b.out);
  assert.equal([a.out, b.out].filter((o) => /Put the main checkout’s packages in/.test(o)).length, 1, `${a.out}\n---\n${b.out}`);
  assert.ok(existsSync(join(r.wt, 'node_modules', 'left-pad', 'index.js')));
  const bare = repoWithWorktree({ mainModules: false });
  const no = await run(bare.wt);
  assert.equal(no.code, 1);
  assert.match(no.out, /install the packages there once/);
  assert.match(readFileSync(join(r.main, '.git', 'info', 'exclude'), 'utf8'), /^\/node_modules\.cc-control-tmp$/m);
});

test('withDeps: a packages step first for each folder that needs one, once per folder, never for stop: or ! steps', () => {
  const specs = ['@ui node_modules\\.bin\\nx.cmd serve', '@ui stop: echo bye', '@api dotnet run', 'echo home', '! open it'].map((l) => parseStep(l)!) as StepSpec[];
  const where = (s: StepSpec) => (s.repo ? `C:\\w\\${s.repo}` : 'C:\\w\\home');
  const needs = new Set(['C:\\w\\ui', 'C:\\w\\home']);
  const out = withDeps(specs, where, (dir) => (needs.has(dir) ? 'clone' : 'none'));
  assert.equal(out.length, specs.length + 2);
  assert.deepEqual(out.slice(0, 2).map((s) => [s.repo, s.cmd.includes('link-deps.ts')]), [['ui', true], [undefined, true]]);
  assert.ok(!out[0].stop && !out[0].note);
  assert.deepEqual(withDeps(specs, where, () => 'none'), specs, 'nothing needed: unchanged');
  assert.equal(withDeps(specs, where, () => 'busy').length, specs.length + 3, 'a clone still going: wait for it');
  assert.equal(withDeps(specs, () => ({ error: 'no repo' }), () => 'clone').length, specs.length, 'a folder that can’t be found is the run’s own error');
});
