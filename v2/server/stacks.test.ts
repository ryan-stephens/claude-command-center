import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateStack, type StackInfo } from '../../shared/stack.ts';
import { PortPool } from '../../server/ports.ts';
import { workLines } from '../../shared/changes.ts';
import { StackManager, type StackOwner } from './stacks.ts';

/** A stack on made-up hosts: the UI's proxy file sends two APIs to dev.example.test; UAT moves them. */
function setup(proxyFile = 'proxy.conf.json') {
  const dir = mkdtempSync(join(tmpdir(), 'ccv2-stacks-'));
  const ui = join(dir, 'web-ui');
  const api = join(dir, 'orders-api');
  mkdirSync(ui);
  mkdirSync(api);
  const base = { '/gw/fees/**': { target: 'https://fees.dev.example.test', headers: { Origin: 'https://app.dev.example.test' } }, '/gw/orders/**': { target: 'https://orders.dev.example.test' } };
  writeFileSync(join(ui, 'proxy.conf.json'), JSON.stringify(base));
  writeFileSync(join(ui, 'proxy.uat.json'), JSON.stringify({ '/gw/fees/**': { target: 'https://fees.uat-file.example.test' } }));
  const stack: StackInfo = {
    ...validateStack({
      choose: { env: ['dev', 'uat'] },
      api: { steps: ['node -e "0"'], proxy: { '/gw/{{route}}/**': { target: 'http://localhost:{{port}}' } } },
      apis: [{ repo: 'orders-api', values: { route: 'orders' } }],
      ui: { repo: 'web-ui', proxyFile, proxyEnv: { uat: [{ from: '.dev.example.test', to: '.uat.example.test' }] }, steps: ['node -e "0" {{proxy}}'] },
    }),
    workspaceId: 'w', source: 'test',
  };
  const owner: StackOwner = { id: 's1', key: 'SHOP-1', places: { cwd: dir, repos: { 'web-ui': ui, 'orders-api': api } } };
  const m = new StackManager({ dir: join(dir, 'runs'), pool: new PortPool([18901, 18910]), env: process.env, changed: () => {}, keyOf: () => 'SHOP-1' });
  const copy = () => JSON.parse(readFileSync(join(dir, 'runs', 'stacks', 's1.proxy.conf.json'), 'utf8')) as Record<string, { target: string; headers?: Record<string, string> }>;
  return { dir, stack, owner, m, copy };
}

test('a UAT run: the proxy copy has the file’s rules moved to UAT and the running API on localhost; another env while it runs is refused', async () => {
  const { dir, stack, owner, m, copy } = setup();
  try {
    await m.up(owner, stack, ['orders-api'], { env: 'uat' });
    const c = copy();
    assert.equal(c['/gw/fees/**'].target, 'https://fees.uat.example.test', 'an API not running here goes to UAT');
    assert.equal(c['/gw/fees/**'].headers?.Origin, 'https://app.uat.example.test', 'headers are moved too');
    assert.match(c['/gw/orders/**'].target, /^http:\/\/localhost:189\d\d$/, 'the running API stays on its local port');
    assert.equal(Object.keys(c)[0], '/gw/orders/**', 'local rules go first');
    assert.deepEqual(m.view('s1')?.values, { env: 'uat' });

    await assert.rejects(m.up(owner, stack, ['orders-api'], { env: 'dev' }), /running on UAT: stop it, then start it on DEV/);
    assert.deepEqual(m.view('s1')?.values, { env: 'uat' }, 'the stack keeps its env');
    await m.up(owner, stack, ['orders-api'], { env: 'uat' });
    await m.down('s1');

    await m.up(owner, stack, ['orders-api'], {});
    assert.equal(copy()['/gw/fees/**'].target, 'https://fees.dev.example.test', 'the default env changes nothing');
    await m.down('s1');
  } finally {
    m.stopAll();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('{{env}} in ui.proxyFile: each env reads its own file, and a missing one names it', async () => {
  const { dir, stack, owner, m, copy } = setup('proxy.{{env}}.json');
  try {
    await m.up(owner, stack, ['orders-api'], { env: 'uat' });
    assert.equal(copy()['/gw/fees/**'].target, 'https://fees.uat-file.example.test');
    await m.down('s1');
    await assert.rejects(m.up(owner, stack, ['orders-api'], { env: 'dev' }), /proxy\.dev\.json \(the DEV file\) isn’t in web-ui/);
    assert.equal(m.isRunning('s1'), false, 'nothing started');
  } finally {
    m.stopAll();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The UI repo as a git repo with a tracked runtime config on made-up values, and a stack with config pairs for UAT. */
function withConfig() {
  const t = setup();
  const ui = join(t.dir, 'web-ui');
  const rel = 'apps/shop/src/assets/environmentConfig.js';
  const original = 'window.env = { issuer: "https://login.dev.example.test", clientId: "id-dev", api: "https://gw.dev.example.test" };\n';
  mkdirSync(join(ui, 'apps/shop/src/assets'), { recursive: true });
  writeFileSync(join(ui, rel), original);
  writeFileSync(join(ui, 'apps/shop/project.json'), JSON.stringify({ name: 'shop', targets: { serve: { options: {} } } }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: ui, encoding: 'utf8' });
  git('init', '-q');
  git('-c', 'user.email=t@example.test', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@example.test', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
  const stack: StackInfo = { ...validateStack({ ...t.stack, ui: { ...t.stack.ui!, steps: ['node -e "0" nx serve shop {{proxy}}'], configEnv: { uat: [{ from: 'login.dev.example.test', to: 'signin.uat.example.test' }, { from: '.dev.example.test', to: '.uat.example.test' }, { from: 'id-dev', to: 'id-uat' }] } } }), workspaceId: 'w', source: 'test' };
  const read = () => readFileSync(join(ui, rel), 'utf8');
  return { ...t, ui, rel, original, stack, git, read };
}

test('ui.configEnv: the UI app’s config is on UAT for the run, hidden from git, and back on stop; the default env changes nothing', async () => {
  const { dir, owner, m, stack, git, read, original } = withConfig();
  try {
    await m.up(owner, stack, ['orders-api'], { env: 'uat' });
    assert.equal(read(), 'window.env = { issuer: "https://signin.uat.example.test", clientId: "id-uat", api: "https://gw.uat.example.test" };\n', 'pairs in order: the specific issuer pair first');
    assert.equal(git('status', '--porcelain'), '', 'git looks past it: Ship and changed files see nothing');
    assert.equal(workLines(git('status', '--porcelain')).length, 0);
    const moved = m.view('s1')?.moved ?? '';
    assert.match(moved, /^2 proxy targets and 3 config values moved to UAT \(apps\/shop\/src\/assets\/environmentConfig\.js changed for this run/);
    assert.doesNotMatch(moved, /id-uat|example\.test/, 'counts only, never the values');
    for (let i = 0; i < 40 && !m.log('s1', 'ui').length; i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(m.log('s1', 'ui').some((l) => l.text.startsWith('2 proxy targets and 3 config values moved to UAT')), 'the UI’s log says what moved');
    await m.down('s1');
    assert.equal(read(), original, 'back to the repo’s version');
    assert.doesNotMatch(git('ls-files', '-v'), /^S /m, 'git sees the file again');

    await m.up(owner, stack, ['orders-api'], {});
    assert.equal(read(), original, 'the default env swaps nothing');
    assert.equal(m.view('s1')?.moved, undefined);
    await m.down('s1');
  } finally {
    m.stopAll();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ui.configEnv after a crash: the next start puts the file back and lets git see it again', async () => {
  const { dir, owner, m, stack, git, read, original } = withConfig();
  try {
    await m.up(owner, stack, ['orders-api'], { env: 'uat' });
    assert.notEqual(read(), original);
    // The server went away without stopping anything: a new one starts on the same folder.
    const next = new StackManager({ dir: join(dir, 'runs'), pool: new PortPool([18911, 18920]), env: process.env, changed: () => {}, keyOf: () => 'SHOP-1' });
    next.leftovers();
    assert.equal(read(), original);
    assert.doesNotMatch(git('ls-files', '-v'), /^S /m);
    assert.equal(git('status', '--porcelain'), '');
  } finally {
    m.stopAll();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ui.configEnv: a file already on that env is said, a missing one named, and a second stack on the same UI folder refused', async () => {
  const { dir, owner, m, stack, ui, rel, read } = withConfig();
  try {
    writeFileSync(join(ui, rel), 'window.env = { clientId: "id-uat" };\n');
    await m.up(owner, stack, ['orders-api'], { env: 'uat' });
    assert.match(m.view('s1')?.moved ?? '', /0 config values moved to UAT.*already looks like that env’s/);
    assert.equal(read(), 'window.env = { clientId: "id-uat" };\n', 'nothing to replace: the file isn’t touched');
    await m.down('s1');

    writeFileSync(join(ui, rel), 'window.env = { clientId: "id-dev" };\n');
    await m.up(owner, stack, [], { env: 'uat' });
    await assert.rejects(m.up({ ...owner, id: 's2', key: 'SHOP-2' }, stack, [], {}), /runtime config is set to UAT for SHOP-1’s stack, which runs the UI from the same folder/);
    await m.down('s1');

    rmSync(join(ui, rel));
    await assert.rejects(m.up(owner, stack, ['orders-api'], { env: 'uat' }), /runtime config isn’t at apps\/shop\/src\/assets\/environmentConfig\.js or apps\/shop\/assets\/environmentConfig\.js in web-ui: set "ui.configFile"/);
    assert.equal(m.isRunning('s1'), false, 'nothing started');
  } finally {
    m.stopAll();
    rmSync(dir, { recursive: true, force: true });
  }
});
