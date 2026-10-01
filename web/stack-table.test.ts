import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STACK_EXAMPLE, type Stack } from '../shared/stack.ts';
import type { Finding } from '../shared/stack-detect.ts';
import { fieldsOf, ruleOf, stackRows, withField, withoutApi } from './stack-table.ts';

const stack: Stack = {
  choose: { env: ['dev', 'uat'] },
  api: { steps: ['wait:http:{{port}}{{health}} forward:{{port}}:{{appPort}} okteto up', 'stop: okteto down'], proxy: { '/gateway/{{route}}/**': { target: 'http://localhost:{{port}}' } } },
  apis: [
    { repo: 'loans-api', values: { name: 'loans-api', appPort: '8080', dir: 'src/LoansApi', health: '/self', route: 'loans' } },
    { repo: 'fees-api', values: { name: 'fees-api', port: '8081', route: 'fees' }, proxy: { '/fees/**': { target: 'http://localhost:{{port}}' } } },
  ],
  ui: { repo: 'shop-ui', proxyFile: 'proxy.conf.json', proxyMode: 'override', steps: ['if not exist node_modules npm install', 'npx ng serve shop --proxy-config {{proxy}} --port {{uiPort}}'], url: 'http://localhost:{{uiPort}}' },
};
const findings: Finding[] = [
  { repo: 'loans-api', role: 'api', text: 'okteto: dev name loans-api', from: 'okteto.yml' },
  { repo: 'loans-api', role: 'api', text: 'project in src/LoansApi', from: 'src/LoansApi/*.csproj' },
  { repo: 'loans-api', role: 'api', text: 'ready when /self answers', from: 'src/LoansApi/Controllers/SelfController.cs' },
  { repo: 'fees-api', role: 'api', text: 'no okteto.yml; the container port is assumed to be 8080', asked: true },
  { repo: 'shop-ui', role: 'ui', text: 'serves with npx ng serve shop', from: 'angular.json' },
  { repo: '', role: 'stack', text: 'anything your team runs before okteto up goes first in api.steps', asked: true },
  { repo: '', role: 'stack', text: 'environments: dev (the default) and uat', asked: true },
];

test('rows: what t asks, the template, each API with its port, values, rule and files, the UI', () => {
  const rows = stackRows(stack, findings);
  assert.deepEqual(rows.map((r) => [r.id, r.repo, r.role, r.port]), [
    ['choose', '', 'Asked each time', ''],
    ['template', '', 'Every API', '{{appPort}} → {{port}}'],
    ['api:loans-api', 'loans-api', 'API', '8080'],
    ['api:fees-api', 'fees-api', 'API', '8081'],
    ['ui', 'shop-ui', 'UI', 'picked per run'],
  ]);
  assert.deepEqual(rows[0].lines, ['env: dev, uat']);
  assert.deepEqual(rows[0].asked, ['environments: dev (the default) and uat']);
  assert.deepEqual(rows[1].lines, stack.api.steps);
  assert.equal(rows[1].rule, '/gateway/{{route}}/**');
  assert.deepEqual(rows[1].asked, ['anything your team runs before okteto up goes first in api.steps']);
  assert.deepEqual(rows[2].lines, ['name: loans-api', 'dir: src/LoansApi', 'health: /self', 'route: loans']);
  assert.equal(rows[2].rule, '/gateway/loans/**', 'the template rule with its route');
  assert.deepEqual(rows[2].from, ['okteto.yml', '*.csproj', 'SelfController.cs']);
  assert.deepEqual(rows[2].asked, []);
  assert.equal(rows[3].rule, '/fees/**', 'its own rule');
  assert.equal(rows[3].port, '8081', 'the old port value read as the container port');
  assert.deepEqual(rows[3].asked, ['no okteto.yml; the container port is assumed to be 8080']);
  assert.equal(rows[4].rule, 'proxy.conf.json');
  assert.deepEqual(rows[4].from, ['angular.json']);
  assert.equal(rows[4].drift, undefined);
});

test('rows with no findings and a fixed UI port; an API with no port says it is assumed', () => {
  const s: Stack = { ...stack, apis: [{ repo: 'x-api', values: {} }], ui: { repo: 'web', steps: ['npm start -- --port 4200'] } };
  const rows = stackRows(s);
  assert.equal(rows[2].port, '8080 (assumed)');
  assert.equal(rows[2].rule, '/gateway/{{route}}/**', 'no route value: the placeholder stays');
  assert.equal(rows[3].port, '4200 (fixed)');
  assert.equal(rows[3].rule, 'no proxy file');
  assert.deepEqual(rows[3].from, []);
});

test('drift: what the repos say now when it differs from the saved stack', () => {
  const detected: Stack = {
    ...stack,
    apis: [{ repo: 'loans-api', values: { name: 'loans-api', appPort: '8081', dir: 'src/LoansApi', health: '/healthz', route: 'loans' } }, { repo: 'fees-api', values: { name: 'fees-api', appPort: '8080', route: 'fees' } }],
    ui: { ...stack.ui!, proxyFile: 'apps/shop/proxy.conf.json' },
  };
  const rows = stackRows(stack, [], detected);
  assert.equal(rows[2].drift, 'appPort 8081, health /healthz');
  assert.equal(rows[3].drift, 'appPort 8080', 'the old port value compared to what was read');
  assert.equal(rows[4].drift, 'proxy file apps/shop/proxy.conf.json');
  assert.equal(stackRows(stack, [], stack)[2].drift, undefined, 'the same: nothing');
});

test('fields of each row, and a field changed makes the stack it says', () => {
  assert.deepEqual(fieldsOf(stack, 'choose').map((f) => [f.key, f.value]), [['choose.env', 'dev, uat']]);
  assert.deepEqual(fieldsOf(stack, 'template').map((f) => [f.key, f.multiline]), [['api.steps', true], ['api.proxy', true]]);
  assert.deepEqual(fieldsOf(stack, 'api:loans-api').map((f) => [f.key, f.value]), [['values.name', 'loans-api'], ['values.appPort', '8080'], ['values.dir', 'src/LoansApi'], ['values.health', '/self'], ['values.route', 'loans'], ['proxy', '']]);
  assert.equal(fieldsOf(stack, 'api:fees-api').find((f) => f.key === 'values.appPort')!.value, '8081', 'the old port shown as appPort');
  assert.deepEqual(fieldsOf(stack, 'ui').map((f) => f.key), ['ui.repo', 'ui.steps', 'ui.proxyFile', 'ui.proxyMode', 'ui.url', 'ui.path']);
  assert.equal(withField(stack, 'ui', 'ui.path', 'ap-summary/').ui!.path, '/ap-summary/', 'a leading slash is put on');
  assert.equal(withField(withField(stack, 'ui', 'ui.path', '/x/'), 'ui', 'ui.path', '').ui!.path, undefined, 'empty removes it');
  assert.deepEqual(fieldsOf(stack, 'api:nope'), []);

  assert.deepEqual(withField(stack, 'choose', 'choose.env', 'uat, dev, qa').choose, { env: ['uat', 'dev', 'qa'] });
  assert.throws(() => withField(stack, 'choose', 'choose.env', ' , '), /at least one value/);
  assert.deepEqual(withField(stack, 'template', 'api.steps', 'a\r\n\r\n b \n').api.steps, ['a', 'b']);
  assert.deepEqual(withField(stack, 'template', 'api.proxy', '').api.proxy, undefined, 'empty: no template rule');
  assert.throws(() => withField(stack, 'template', 'api.proxy', '{ nope'), /isn’t valid JSON/);
  assert.throws(() => withField(stack, 'template', 'api.proxy', '[1]'), /object of rules/);
  const fees = withField(stack, 'api:fees-api', 'values.appPort', '9000').apis[1];
  assert.deepEqual(fees.values, { name: 'fees-api', appPort: '9000', route: 'fees' }, 'appPort replaces the old port');
  assert.deepEqual(withField(stack, 'api:loans-api', 'values.health', '').apis[0].values, { name: 'loans-api', appPort: '8080', dir: 'src/LoansApi', route: 'loans' }, 'empty removes the value');
  assert.deepEqual(withField(stack, 'api:loans-api', 'values.extra', 'x').apis[0].values.extra, 'x', 'a new value');
  assert.equal(withField(stack, 'api:fees-api', 'proxy', '').apis[1].proxy, undefined, 'empty: back to the template');
  assert.deepEqual(withField(stack, 'api:loans-api', 'proxy', '{"/loans/**": {"target": "http://localhost:{{port}}"}}').apis[0].proxy, { '/loans/**': { target: 'http://localhost:{{port}}' } });
  const ui = withField(withField(withField(stack, 'ui', 'ui.proxyFile', ''), 'ui', 'ui.url', ''), 'ui', 'ui.steps', 'npm start').ui!;
  assert.deepEqual(ui, { repo: 'shop-ui', steps: ['npm start'] }, 'empty proxy file drops the mode too; empty url goes');
  assert.equal(withField(stack, 'ui', 'ui.proxyMode', 'edit').ui!.proxyMode, 'edit');
  assert.equal(withField(stack, 'ui', 'ui.proxyMode', 'whatever').ui!.proxyMode, 'override');
  assert.equal(withField(stack, 'ui', 'ui.repo', 'web').ui!.repo, 'web');
  assert.equal(withField(stack, 'nothing', 'x', 'y'), stack, 'an unknown row changes nothing');
  assert.deepEqual(withoutApi(stack, 'fees-api').apis.map((a) => a.repo), ['loans-api']);
  assert.equal(ruleOf(STACK_EXAMPLE, STACK_EXAMPLE.apis[0]), '/gateway/team/orders/**');
});
