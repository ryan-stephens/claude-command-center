import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { validateStack } from '../shared/stack.ts';
import { FrontDoors } from './front-door.ts';
import { PortPool } from './ports.ts';
import { RunService } from './recipes.ts';
import { prepareStackRun, prepareStackSession, readLooseJson, restoreLeftovers, saveStack, serviceRecipe, stackOf, stackRecipe, stackRows } from './stack.ts';
import { runKey } from '../shared/recipes.ts';
import { Store } from './store.ts';

const dir = mkdtempSync(join(tmpdir(), 'cc-stack-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function repo(name: string, files: Record<string, string>, branch?: string): string {
  const p = join(dir, name);
  mkdirSync(p, { recursive: true });
  for (const [f, text] of Object.entries(files)) { mkdirSync(join(p, f, '..'), { recursive: true }); writeFileSync(join(p, f), text); }
  if (branch) {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: p, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
    if (branch !== 'main') git('checkout', '-q', '-b', branch);
  }
  return p;
}

const until = async (ok: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};

// Stand-ins: an "API" that takes a moment, then says it's listening (as dotnet does), and a
// "UI" that serves the proxy file it was given, so the test can read what it got.
const API = "setTimeout(()=>{require('http').createServer((q,r)=>r.end('api')).listen(Number(process.env.PORT),()=>console.log('Now listening on: http://[::]:'+process.env.PORT))},300)";
const UI = "const f=process.argv[2];const s=require('http').createServer((q,r)=>r.end(require('fs').readFileSync(f,'utf8'))).listen(0,()=>console.log('Local: http://localhost:'+s.address().port+'/'))";

function makeStack(proxyMode: 'override' | 'edit' = 'override') {
  return validateStack({
    choose: { env: ['dev', 'uat'] },
    api: {
      steps: [
        'node -e "require(\'fs\').writeFileSync(\'up.txt\', \'{{name}}-{{branch}} {{env}}\')"',
        'wait:"Now listening on" PORT={{port}} node api.js',
        'stop: node -e "require(\'fs\').writeFileSync(\'down.txt\', \'{{name}}-{{branch}}\')"',
      ],
      proxy: { '/gw/{{route}}/**': { target: 'http://localhost:{{port}}' } },
    },
    apis: [
      { repo: 'orders-api', values: { name: 'orders-api', port: '18431', route: 'orders' } },
      { repo: 'fees-api', values: { name: 'fees-api', port: '18432', route: 'fees' } },
    ],
    ui: { repo: 'web-ui', proxyFile: 'apps/shop/proxy.conf.json', proxyMode, steps: ['node ui.js "{{proxy}}"'] },
  });
}

const PROXY = '{\n  // the shared gateway\n  "/gw/**": { "target": "https://shared.example", },\n}\n';

test('a stack run: the picked API on its branch, ready when it says so, the UI on a proxy copy; stop undoes it all', async () => {
  const orders = repo('orders-api', { 'api.js': API }, 'feature/ABC-12');
  const fees = repo('fees-api', { 'api.js': API }, 'main');
  const ui = repo('web-ui', { 'ui.js': UI, 'apps/shop/proxy.conf.json': PROXY }, 'main');
  const places = { cwd: ui, repos: { 'orders-api': orders, 'fees-api': fees, 'web-ui': ui } };
  const store = new Store(join(dir, 's.db'));
  const runsDir = join(dir, 'runs');
  const runs = new RunService(() => {}, process.env);
  try {
    saveStack(store, 'w1', makeStack());
    const info = stackOf(store, 'w1')!;
    assert.equal(stackRecipe(info).stack?.apis.length, 2, 'the page gets it as the workspace’s recipe');

    writeFileSync(join(orders, 'new.cs'), '// changed');
    const rows = await stackRows(info, places, 'Fix the fee rounding in fees-api');
    assert.deepEqual(rows.map((r) => [r.repo, r.why]), [['orders-api', 'changed on this branch'], ['fees-api', 'named in the ticket']]);
    const missing = await stackRows(info, { cwd: ui, repos: { 'web-ui': ui } }, '');
    assert.equal(missing[0].why, 'not in this card or its workspace');

    // The local port is picked for the run, from the pool: the first free one in its range.
    const pool = new PortPool([18431, 18440]);
    const { recipe, opts } = await prepareStackRun(info, { values: { env: 'uat' }, apis: ['orders-api'] }, places, 'c1', runsDir, pool);
    assert.equal(opts.choice, 'uat · orders-api :18431');
    assert.deepEqual(pool.taken(), [18431]);
    const copy = join(runsDir, 'c1.proxy.conf.json');
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(copy, 'utf8'))), ['/gw/orders/**', '/gw/**'], 'the rule goes first; comments and trailing commas were read');
    assert.equal(readFileSync(join(ui, 'apps/shop/proxy.conf.json'), 'utf8'), PROXY, 'the repo’s file is untouched');

    await runs.start('c1', recipe, places, opts);
    await until(() => runs.get('c1')?.state === 'up');
    const run = runs.get('c1')!;
    assert.equal(run.choice, 'uat · orders-api :18431');
    assert.deepEqual(run.steps.map((s) => s.state), ['ok', 'up', 'up', 'wait']);
    assert.equal(run.steps[1].waitFor, 'Now listening on');
    assert.equal(readFileSync(join(orders, 'up.txt'), 'utf8'), 'orders-api-feature-abc-12 uat', 'the branch, made safe for a name, and the environment picked');
    assert.equal(existsSync(join(fees, 'up.txt')), false, 'an API not picked doesn’t run');
    assert.equal(await (await fetch('http://localhost:18431')).text(), 'api');
    assert.doesNotMatch(run.url!, /18431/, 'the API’s address isn’t the app’s');
    assert.match(await (await fetch(run.url!)).text(), /"\/gw\/orders\/\*\*"/, 'the UI got the proxy copy');

    await runs.stop('c1');
    assert.equal(readFileSync(join(orders, 'down.txt'), 'utf8'), 'orders-api-feature-abc-12', 'the stop step ran in the API’s repo');
    assert.equal(existsSync(copy), false, 'the proxy copy is gone');
    assert.equal(runs.get('c1')!.text, 'Stopped');
    await assert.rejects(fetch('http://localhost:18431'), 'the API is stopped');
    assert.deepEqual(pool.taken(), [], 'the port is given back');
  } finally {
    runs.stopAll();
    store.close();
  }
});

test('no ui.url: the URL is the served app’s own port and baseHref from its project file, and the title names the app', async () => {
  const orders = repo('u-orders-api', { 'api.js': API }, 'main');
  const ui = repo('u-lending-ui', {
    'package.json': '{}',
    'apps/deny-withdraw/project.json': JSON.stringify({ name: 'deny-withdraw', targets: { build: { options: { baseHref: '/ap-summary/' } }, serve: { options: { proxyConfig: 'apps/deny-withdraw/proxy.conf.json', port: 4216 } } } }),
    'apps/deny-withdraw/proxy.conf.json': PROXY,
    'apps/payoff/project.json': JSON.stringify({ name: 'payoff', targets: { serve: { options: { port: 4220 } } } }),
  }, 'main');
  const places = { cwd: ui, repos: { 'orders-api': orders, 'lending-ui': ui } };
  const base = makeStack();
  const info = {
    ...validateStack({ ...base, apis: [base.apis[0]], ui: { repo: 'lending-ui', proxyFile: 'apps/deny-withdraw/proxy.conf.json', steps: ['node_modules\\.bin\\nx.cmd serve deny-withdraw --proxyConfig={{proxy}}'] } }),
    workspaceId: 'wu', source: '',
  };
  const pool = new PortPool([18441, 18445]);
  const { recipe, opts } = await prepareStackRun(info, { values: { env: 'dev' }, apis: ['orders-api'] }, places, 'cu', join(dir, 'runs-u'), pool);
  // §114: nx serve without --port gets --port; §122: the app's own port while it's free (its sign-in is registered there). The path is the app's baseHref.
  assert.equal(recipe.url, 'http://localhost:4216/ap-summary/');
  assert.equal(opts.choice, 'dev · orders-api :18441 · deny-withdraw :4216');
  assert.match(recipe.steps.find((s) => /nx\.cmd serve/.test(s))!, /--port 4216$/);
  assert.equal(opts.note, undefined, 'on its own port: nothing to say');
  opts.cleanup?.();
  assert.deepEqual(pool.taken(), [], 'its own port is given back too');
  // The step names the other app: its port and path.
  const other = { ...info, ui: { ...info.ui!, steps: ['npx nx serve payoff'] } };
  const o = await prepareStackRun(other, { values: { env: 'dev' }, apis: [] }, places, 'cu2', join(dir, 'runs-u'), pool);
  assert.equal(o.recipe.url, 'http://localhost:4220');
  assert.equal(o.opts.choice, 'dev · UI only · payoff :4220');
  o.opts.cleanup?.();
  // A written url wins; ui.path still goes after it.
  const written = { ...info, ui: { ...info.ui!, url: 'http://localhost:{{uiPort}}', path: '/ap-summary/', steps: ['npx nx serve deny-withdraw --port={{uiPort}}'] } };
  const w = await prepareStackRun(written, { values: { env: 'dev' }, apis: [] }, places, 'cu3', join(dir, 'runs-u'), pool);
  assert.equal(w.recipe.url, 'http://localhost:4216/ap-summary/');
  assert.equal(w.opts.choice, 'dev · UI only · deny-withdraw :4216');
  w.opts.cleanup?.();
  // VU's stack as saved: url http://localhost:4200 from the example, no --port on the step: the project file's port and path are used.
  const stale = { ...info, ui: { ...info.ui!, url: 'http://localhost:4200' } };
  const s = await prepareStackRun(stale, { values: { env: 'dev' }, apis: [] }, places, 'cu4', join(dir, 'runs-u'), pool);
  assert.equal(s.recipe.url, 'http://localhost:4216/ap-summary/');
  assert.equal(s.opts.choice, 'dev · UI only · deny-withdraw :4216');
  // §114: a second card while the first holds 4216: --port with one from the range, and the run says why.
  const s2 = await prepareStackRun(stale, { values: { env: 'dev' }, apis: [] }, places, 'cu5', join(dir, 'runs-u'), pool, 'CARD-5');
  assert.equal(s2.recipe.url, 'http://localhost:18441/ap-summary/');
  assert.match(s2.opts.note ?? '', /own port, 4216, is in use by cu4, so it runs on 18441\. .*CC_CONTROL_UI_PORTS/);
  s2.opts.cleanup?.();
  s.opts.cleanup?.();
  // §122: with ports registered for sign-in, a second card takes one of those; a third, with none left, is told who holds them.
  const listed = new PortPool([18441, 18445], [18446]);
  const l1 = await prepareStackRun(stale, { values: { env: 'dev' }, apis: ['orders-api'] }, places, 'cl1', join(dir, 'runs-u'), listed, 'CARD-1');
  const l2 = await prepareStackRun(stale, { values: { env: 'dev' }, apis: ['orders-api'] }, places, 'cl2', join(dir, 'runs-u'), listed, 'CARD-2');
  assert.equal(l1.recipe.url, 'http://localhost:4216/ap-summary/');
  assert.equal(l2.recipe.url, 'http://localhost:18446/ap-summary/');
  assert.match(l2.opts.note ?? '', /own port, 4216, is in use by CARD-1, so it runs on 18446 from CC_CONTROL_UI_PORTS/);
  await assert.rejects(prepareStackRun(stale, { values: { env: 'dev' }, apis: ['orders-api'] }, places, 'cl3', join(dir, 'runs-u'), listed, 'CARD-3'),
    /No sign-in port free for the UI: 4216 \(CARD-1\), 18446 \(CARD-2\)\. Stop one, or add one to CC_CONTROL_UI_PORTS\./);
  assert.deepEqual(listed.taken(), [4216, 18441, 18442, 18446], 'the refused run holds nothing: its API’s port went back');
  l1.opts.cleanup?.();
  l2.opts.cleanup?.();
  assert.deepEqual(listed.taken(), []);
});

test('front doors (§123): every card’s UI on a port of its own behind its own port; the door goes with the last; a port taken by something else is as §122', async () => {
  const ui = repo('d-ui', {
    'package.json': '{}',
    'apps/shop/project.json': JSON.stringify({ name: 'shop', targets: { build: { options: { baseHref: '/shop/' } }, serve: { options: { proxyConfig: 'apps/shop/proxy.conf.json', port: 18795 } } } }),
    'apps/shop/proxy.conf.json': PROXY,
  }, 'main');
  const places = { cwd: ui, repos: { 'd-ui': ui } };
  const info = { ...validateStack({ ...makeStack(), ui: { repo: 'd-ui', proxyFile: 'apps/shop/proxy.conf.json', steps: ['npx nx serve shop --proxyConfig={{proxy}}'] } }), workspaceId: 'wd', source: '' };
  const pool = new PortPool([18796, 18799]);
  const doors = new FrontDoors();
  try {
    const a = await prepareStackSession(info, { values: { env: 'dev' }, apis: [] }, places, 'da', join(dir, 'runs-d'), pool, 'CARD-1', doors);
    const b = await prepareStackSession(info, { values: { env: 'dev' }, apis: [] }, places, 'db', join(dir, 'runs-d'), pool, 'CARD-2', doors);
    assert.equal(a.ctx.uiPort, 18796, 'not its own port: the door holds that');
    assert.equal(b.ctx.uiPort, 18797);
    assert.match(serviceRecipe(a, 'ui').steps[0], /--port 18796$/);
    assert.equal(serviceRecipe(b, 'ui').url, 'http://localhost:18797/shop/');
    assert.match(a.uiNote ?? '', /runs on 18796, behind cc-control’s front door on 18795, where its sign-in is registered: o on the card shows it there/);
    assert.deepEqual(doors.stateOf('da'), { port: 18795, shown: true });
    assert.deepEqual(doors.stateOf('db'), { port: 18795, shown: false });
    a.end();
    assert.deepEqual(doors.stateOf('db'), { port: 18795, shown: true }, 'card 1 stopped: the door shows card 2');
    b.end();
    assert.equal(doors.isOpen(18795), false, 'the last one stopped: the door closes');
    assert.deepEqual(pool.taken(), []);
    // Something else on the UI's own port: no door; as §122, a port from the range with why.
    const other = createServer().listen(18795, '127.0.0.1');
    await new Promise((r) => other.once('listening', r));
    try {
      const c = await prepareStackSession(info, { values: { env: 'dev' }, apis: [] }, places, 'dc', join(dir, 'runs-d'), pool, 'CARD-3', doors);
      assert.equal(doors.stateOf('dc'), undefined);
      assert.equal(c.ctx.uiPort, 18796);
      assert.match(c.uiNote ?? '', /own port, 18795, is in use by something else on this machine/);
      c.end();
    } finally {
      other.close();
    }
  } finally {
    doors.closeAll();
  }
});

// A stand-in okteto: `okteto up -f <manifest>` reads the manifest's forward and starts the API on
// that local port, as the real one would forward it. The UI serves its proxy copy on --port.
// Like the real one (§114), it also holds every other forward's local port and the remote: (SSH) port,
// and fails as okteto does when one is already in use on this machine.
const OKTETO = "const a=process.argv;const f=a[a.indexOf('-f')+1];const t=require('fs').readFileSync(f,'utf8');const m=/-\\s*(\\d+):(\\d+)/.exec(t);const held=[...t.matchAll(/-\\s*(\\d+):(\\d+)/g)].slice(1).map((x)=>Number(x[1]));const r=/remote:\\s*(\\d+)/.exec(t);if(r)held.push(Number(r[1]));for(const p of held)require('net').createServer().listen(p,'127.0.0.1').on('error',()=>{console.log('x Couldn\\'t connect to your development container: local port '+p+' is already in-use in your local machine');process.exit(1)});process.env.PORT=m[1];console.log('Forward: '+m[1]+' -> '+m[2]);require(require('path').join(process.cwd(),'api.js'))";
const UI_PORT = "const a=process.argv;const f=a[2];const p=Number(a[a.indexOf('--port')+1]);require('http').createServer((q,r)=>r.end(require('fs').readFileSync(f,'utf8'))).listen(p,()=>console.log('Local: http://localhost:'+p+'/'))";

test('two cards run the same API and UI at once: each run gets its own ports, forwarded through a copy of the manifest', async () => {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'okteto.js'), OKTETO);
  writeFileSync(join(bin, 'okteto.cmd'), `@node "${join(bin, 'okteto.js')}" %*\r\n`);
  writeFileSync(join(bin, 'okteto'), `#!/bin/sh\nnode "${join(bin, 'okteto.js')}" "$@"\n`, { mode: 0o755 });
  // As the team's helper writes it (§114): a fixed SSH port and a debugger forward, which a second card's okteto up clashed on.
  const manifest = 'name: orders-api\nremote: 18469\nforward:\n  - 8080:8080\n  - 18468:5005\n';
  const api1 = repo('two-api-c1', { 'api.js': API, 'okteto.yml': manifest }, 'card-1');
  const api2 = repo('two-api-c2', { 'api.js': API, 'okteto.yml': manifest }, 'card-2');
  const ui1 = repo('two-ui-c1', { 'ui.js': UI_PORT, 'proxy.conf.json': PROXY }, 'card-1');
  const ui2 = repo('two-ui-c2', { 'ui.js': UI_PORT, 'proxy.conf.json': PROXY }, 'card-2');
  const info = {
    ...validateStack({
      // No forward: on the line: the picked port is forwarded on its own.
      api: { steps: ['wait:"Now listening on" okteto up', 'stop: node -e "require(\'fs\').writeFileSync(\'down.txt\', \'{{deployment}}\')"'], proxy: { '/gw/{{route}}/**': { target: 'http://localhost:{{port}}' } } },
      apis: [{ repo: 'orders-api', values: { name: 'orders-api', appPort: '8080', route: 'orders' } }],
      ui: { repo: 'web-ui', proxyFile: 'proxy.conf.json', steps: ['node ui.js "{{proxy}}" --port {{uiPort}}'], url: 'http://localhost:{{uiPort}}' },
    }), workspaceId: 'w2', source: '',
  };
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const pool = new PortPool([18450, 18459]);
  const runs = new RunService(() => {}, { ...process.env, [pathKey]: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env[pathKey]}` }, { pool });
  const runsDir = join(dir, 'two-runs');
  try {
    const a = await prepareStackRun(info, { values: {}, apis: ['orders-api'] }, { cwd: ui1, repos: { 'orders-api': api1, 'web-ui': ui1 } }, 'c1', runsDir, pool);
    const b = await prepareStackRun(info, { values: {}, apis: ['orders-api'] }, { cwd: ui2, repos: { 'orders-api': api2, 'web-ui': ui2 } }, 'c2', runsDir, pool);
    assert.equal(a.opts.choice, 'orders-api :18450 · UI :18451');
    assert.equal(b.opts.choice, 'orders-api :18452 · UI :18453', 'the second run never gets the first one’s ports');
    assert.equal(a.recipe.url, 'http://localhost:18451');
    assert.equal(b.recipe.url, 'http://localhost:18453');
    assert.match(a.recipe.steps[0], /^@orders-api forward:18450:8080 wait:"Now listening on" okteto up$/, 'forwarded without being told');
    await runs.start('c1', a.recipe, { cwd: ui1, repos: { 'orders-api': api1, 'web-ui': ui1 } }, a.opts);
    await runs.start('c2', b.recipe, { cwd: ui2, repos: { 'orders-api': api2, 'web-ui': ui2 } }, b.opts);
    await until(() => runs.get('c1')?.state === 'up' && runs.get('c2')?.state === 'up', 20_000).catch((e: Error) => { throw new Error(`${e.message}: ${JSON.stringify([runs.get('c1'), runs.get('c2')].map((r) => [r?.state, r?.text, r?.steps.map((s) => [s.state, s.tail])]))}`); });
    assert.equal(readFileSync(join(api1, 'okteto.cc-control.yml'), 'utf8'), 'name: orders-api\nforward:\n  - 18450:8080\n  - 18454:5005\n', 'the copy forwards the picked port, the debugger gets one of its own, and okteto picks its SSH port');
    assert.equal(readFileSync(join(api2, 'okteto.cc-control.yml'), 'utf8'), 'name: orders-api\nforward:\n  - 18452:8080\n  - 18455:5005\n');
    assert.ok(runs.log('c1').some((l) => /other forwards: 18468 → 18454; okteto picks its own SSH port/.test(l.text)), 'the run says where the debugger is');
    assert.equal(readFileSync(join(api1, 'okteto.yml'), 'utf8'), manifest, 'the manifest itself is untouched');
    assert.match(readFileSync(join(api1, '.git', 'info', 'exclude'), 'utf8'), /okteto\.cc-control\.yml/);
    assert.match(runs.get('c1')!.steps[0].tail.join('\n'), /okteto up -f okteto\.cc-control\.yml|Forward: 18450 -> 8080/);
    assert.equal(await (await fetch('http://localhost:18450')).text(), 'api', 'card 1’s API on its port');
    assert.equal(await (await fetch('http://localhost:18452')).text(), 'api', 'card 2’s API on its port, at the same time');
    assert.match(await (await fetch('http://localhost:18451')).text(), /"target": "http:\/\/localhost:18450"/, 'card 1’s UI proxies to card 1’s API');
    assert.match(await (await fetch('http://localhost:18453')).text(), /"target": "http:\/\/localhost:18452"/, 'card 2’s UI to card 2’s');
    assert.equal(runs.get('c1')!.url, 'http://localhost:18451');
    await runs.stop('c1');
    assert.equal(existsSync(join(api1, 'okteto.cc-control.yml')), false, 'the copy goes with the run');
    assert.equal(readFileSync(join(api1, 'down.txt'), 'utf8'), 'orders-api-card-1', '{{deployment}} in the stop step');
    assert.deepEqual(pool.taken(), [18452, 18453, 18455], 'card 1’s ports (the debugger’s too) are free again, card 2’s still held');
    assert.equal(await (await fetch('http://localhost:18452')).text(), 'api', 'card 2 is still up');
    await assert.rejects(fetch('http://localhost:18450'));
    await runs.stop('c2');
    assert.deepEqual(pool.taken(), []);
  } finally {
    runs.stopAll();
  }
});

test('a forward: step with no manifest to copy fails the run and says what to do', async () => {
  const api = repo('nomanifest-api', { 'api.js': API }, 'main');
  const runs = new RunService(() => {}, process.env);
  try {
    await runs.start('f1', { repo: api, source: '', steps: ['forward:18460:8080 okteto up', 'node api.js'] }, api);
    await until(() => runs.get('f1')?.state === 'failed');
    assert.match(runs.get('f1')!.steps[0].tail[0], /No okteto\.yml in nomanifest-api to forward port 18460/);
    assert.equal(runs.get('f1')!.steps[1].state, 'wait', 'the next step never ran');
  } finally {
    runs.stopAll();
  }
});

test('edit mode changes the repo’s proxy file and puts it back on stop, or after a crash', async () => {
  const orders = repo('e-orders', { 'api.js': API }, 'main');
  const ui = repo('e-ui', { 'ui.js': UI, 'apps/shop/proxy.conf.json': PROXY }, 'main');
  const places = { cwd: ui, repos: { 'orders-api': orders, 'web-ui': ui } };
  const file = join(ui, 'apps/shop/proxy.conf.json');
  const runsDir = join(dir, 'e-runs');
  const info = { ...makeStack('edit'), workspaceId: 'w1', source: '' };
  const runs = new RunService(() => {}, process.env);
  try {
    const a = await prepareStackRun(info, { values: {}, apis: [] }, places, 'c2', runsDir);
    assert.deepEqual(a.recipe.steps, [`@web-ui node ui.js "${file}"`], 'UI only, pointed at the file itself');
    await runs.start('c2', a.recipe, places, a.opts);
    await until(() => runs.get('c2')?.state === 'up');
    assert.notEqual(readFileSync(file, 'utf8'), PROXY, 'rewritten while it runs');
    await runs.stop('c2');
    assert.equal(readFileSync(file, 'utf8'), PROXY, 'put back exactly, comments and all');

    // The server stops mid-run without its cleanup: the next start puts it back.
    await prepareStackRun(info, { values: {}, apis: ['orders-api'] }, places, 'c3', runsDir);
    assert.match(readFileSync(file, 'utf8'), /gw\/orders/);
    assert.deepEqual(restoreLeftovers(runsDir), [file]);
    assert.equal(readFileSync(file, 'utf8'), PROXY);
  } finally {
    runs.stopAll();
  }
});

test('a stack that can’t be built changes nothing, and says why', async () => {
  const ui = repo('x-ui', { 'apps/shop/proxy.conf.json': PROXY });
  const runsDir = join(dir, 'x-runs');
  const bad = { ...validateStack({ ui: { repo: 'web-ui', proxyFile: 'apps/shop/proxy.conf.json', proxyMode: 'edit', steps: ['node ui.js {{prox}}'] } }), workspaceId: 'w', source: '' };
  await assert.rejects(prepareStackRun(bad, { values: {}, apis: [] }, { cwd: ui, repos: { 'web-ui': ui } }, 'c4', runsDir), /uses \{\{prox\}\}, which has no value/);
  assert.equal(readFileSync(join(ui, 'apps/shop/proxy.conf.json'), 'utf8'), PROXY);
  assert.equal(existsSync(runsDir), false);
  const ok = { ...bad, ui: { ...bad.ui!, steps: ['node ui.js'] } };
  await assert.rejects(prepareStackRun(ok, { values: {}, apis: [] }, { cwd: ui, repos: {} }, 'c4', runsDir), /The UI web-ui isn’t in this card or its workspace/);
  assert.throws(() => readLooseJson('module.exports = {}'), SyntaxError);
});

test('ps: steps run in PowerShell and answers: are typed into its questions', { skip: process.platform !== 'win32' && 'PowerShell steps are for Windows' }, async () => {
  const cwd = repo('ps', {});
  const runs = new RunService(() => {}, process.env);
  try {
    const q = '$a = Read-Host "Create files? (y/n)"; $c = $Host.UI.PromptForChoice("Git", "Add to .gitignore?", @("&Yes","&No"), 0); Set-Content -NoNewline -Path answers.txt -Value "$a $c"';
    await runs.start('p1', { repo: cwd, source: '', steps: [`ps: answers:"y,n" ${q}`] }, cwd);
    await until(() => runs.get('p1')?.state === 'done' || runs.get('p1')?.state === 'failed', 30_000);
    assert.equal(runs.get('p1')!.state, 'done', runs.get('p1')!.steps[0].tail.join('\n'));
    assert.equal(readFileSync(join(cwd, 'answers.txt'), 'utf8'), 'y 1', 'y to the first, No (1) to the second');
  } finally {
    runs.stopAll();
  }
});

test('services (§82): each API and the UI is its own run on the session’s ports; one stops and starts again alone, the UI keeps its port; ending the session frees it all', async () => {
  const orders = repo('orders-api-s', { 'api.js': API }, 'feature/SVC-1');
  const fees = repo('fees-api-s', { 'api.js': API }, 'main');
  const ui = repo('web-ui-s', { 'ui.js': UI, 'apps/shop/proxy.conf.json': PROXY }, 'main');
  const places = { cwd: ui, repos: { 'orders-api': orders, 'fees-api': fees, 'web-ui': ui } };
  const store = new Store(join(dir, 'svc.db'));
  const runsDir = join(dir, 'runs-svc');
  const runs = new RunService(() => {}, process.env);
  try {
    saveStack(store, 'w2', makeStack());
    const info = stackOf(store, 'w2')!;
    const pool = new PortPool([18451, 18460]);
    const session = await prepareStackSession(info, { values: { env: 'dev' }, apis: ['orders-api', 'fees-api'] }, places, 'c9', runsDir, pool);
    assert.deepEqual(session.services, ['orders-api', 'fees-api', 'ui']);
    assert.deepEqual(pool.taken(), [18451, 18452], 'a port per API, reserved for the whole session');
    assert.equal(session.label, 'dev · orders-api :18451, fees-api :18452');
    for (const sv of session.services) await runs.start(runKey('c9', sv), serviceRecipe(session, sv), session.places, { cardId: 'c9', service: sv, choice: session.label });
    await until(() => runs.ofCard('c9').every((r) => r.state === 'up'));
    assert.deepEqual(runs.ofCard('c9').map((r) => r.service).sort(), ['fees-api', 'orders-api', 'ui']);
    assert.equal(runs.get('c9'), undefined, 'no run under the card’s bare id');
    assert.equal(await (await fetch('http://localhost:18452')).text(), 'api');
    assert.match(await (await fetch(runs.get(runKey('c9', 'ui'))!.url!)).text(), /"\/gw\/fees\/\*\*"/, 'the UI’s proxy copy names both APIs');

    // One API stops alone: its stop: step runs, the others stay up.
    await runs.stop(runKey('c9', 'fees-api'));
    assert.equal(readFileSync(join(fees, 'down.txt'), 'utf8'), 'fees-api-main');
    assert.equal(runs.get(runKey('c9', 'orders-api'))!.state, 'up');
    assert.equal(runs.get(runKey('c9', 'ui'))!.state, 'up');
    await assert.rejects(fetch('http://localhost:18452'));
    assert.deepEqual(pool.taken(), [18451, 18452], 'its port stays reserved for the session');
    // And starts again on the same port, through the same session.
    await runs.start(runKey('c9', 'fees-api'), serviceRecipe(session, 'fees-api'), session.places, { cardId: 'c9', service: 'fees-api' });
    await until(() => runs.get(runKey('c9', 'fees-api'))?.state === 'up');
    assert.equal(await (await fetch('http://localhost:18452')).text(), 'api');
    assert.throws(() => serviceRecipe(session, 'nope-api'), /wasn’t picked/);

    // The session ends: every service stops (the UI first), the proxy copy goes, the ports come back.
    await runs.stopCard('c9');
    session.end();
    assert.ok(runs.ofCard('c9').every((r) => r.state === 'stopped'));
    assert.equal(existsSync(join(runsDir, 'c9.proxy.conf.json')), false);
    assert.deepEqual(pool.taken(), []);
    session.end();
    assert.deepEqual(pool.taken(), [], 'ending twice frees nothing twice');
  } finally {
    runs.stopAll();
    store.close();
  }
});
