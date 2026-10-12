import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateStack, type StackInfo } from '../../shared/stack.ts';
import { PortPool } from '../../server/ports.ts';
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
