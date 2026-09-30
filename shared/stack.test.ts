import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStep, recipeLabel, recipeText } from './recipes.ts';
import { choiceLabel, choiceValues, fill, k8sName, mergeProxy, namesApi, STACK_EXAMPLE, stackRules, stackSteps, suggested, validateStack, type Stack } from './stack.ts';

const stack: Stack = validateStack({
  choose: { env: ['dev', 'uat'] },
  api: {
    steps: [
      'ps: answers:"y,n" New-Env -Name {{name}} -Environment {{env}}',
      'wait:port:{{port}} okteto up',
      '! Check {{name}} in the dashboard',
      'stop: okteto down',
      'stop: kubectl delete deployment {{name}}-{{branch}} -n team-{{env}}',
    ],
    proxy: { '/gw/{{route}}/**': { target: 'http://localhost:{{port}}', pathRewrite: { '.*/gw/{{route}}': '' } } },
  },
  apis: [
    { repo: 'orders-api', values: { name: 'orders-api', port: 8080, route: 'orders' }, proxy: { '/orders/api/**': { target: 'http://localhost:{{port}}/' } } },
    { repo: 'fees-api', values: { name: 'fees-api', port: '8081', route: 'fees' } },
  ],
  ui: { repo: 'web-ui', proxyFile: 'apps/shop/proxy.conf.json', steps: ['nx run shop:serve --proxyConfig={{proxy}}', 'stop: echo ui gone'], url: 'http://localhost:4200' },
});

test('a stack is checked, and says what is wrong', () => {
  assert.equal(stack.apis[0].values.port, '8080', 'numbers become text');
  assert.equal(stack.ui?.proxyMode, 'override', 'the repo file is left alone by default');
  assert.deepEqual(validateStack(STACK_EXAMPLE).apis.length, 1, 'the editor’s example is a valid stack');
  assert.throws(() => validateStack([]), /JSON object/);
  assert.throws(() => validateStack({ apis: [{ values: {} }] }), /API 1 in "apis" has no "repo"/);
  assert.throws(() => validateStack({ apis: [{ repo: 'a' }] }), /"api.steps" is empty/);
  assert.throws(() => validateStack({ choose: { env: [] }, ui: { repo: 'u', steps: ['x'] } }), /"choose.env" should list the values/);
  assert.throws(() => validateStack({ ui: { repo: 'u', steps: ['x'], proxyFile: '../other/proxy.json' } }), /inside the UI repo/);
  assert.throws(() => validateStack({ ui: { repo: 'u', steps: ['x'], proxyFile: 'C:\\x\\proxy.json' } }), /inside the UI repo/);
  assert.throws(() => validateStack({}), /no APIs and no UI/);
});

test('placeholders are filled, and a missing one is named', () => {
  assert.equal(fill('{{name}}-{{ branch }}', { name: 'a', branch: 'main' }, 'x'), 'a-main');
  assert.throws(() => fill('-n team-{{envv}}', { env: 'dev' }, 'orders-api’s steps'), /orders-api’s steps uses \{\{envv\}\}, which has no value/);
  assert.equal(fill('if (x) { y }', {}, 'x'), 'if (x) { y }', 'PowerShell’s single braces are left alone');
});

test('branches become names Kubernetes allows', () => {
  assert.equal(k8sName('feature/ABC-12_add thing'), 'feature-abc-12-add-thing');
  assert.equal(k8sName('main'), 'main');
});

test('what is picked is checked against what the stack offers, default first', () => {
  assert.deepEqual(choiceValues(stack), { env: 'dev' });
  assert.deepEqual(choiceValues(stack, { env: 'uat' }), { env: 'uat' });
  assert.throws(() => choiceValues(stack, { env: 'prod' }), /env can be dev or uat, not prod/);
  assert.equal(choiceLabel({ env: 'uat' }, ['orders-api', 'fees-api']), 'uat · orders-api, fees-api');
  assert.equal(choiceLabel({ env: 'dev' }, []), 'dev · UI only');
});

test('the run: each picked API’s steps in its repo, then the UI, then stop steps in reverse', () => {
  const steps = stackSteps(stack, { values: { env: 'uat' }, apis: ['fees-api', 'orders-api'] }, { 'orders-api': 'feature-abc-1', 'fees-api': 'main' }, 'C:\\runs\\c1.proxy.conf.json');
  assert.deepEqual(steps, [
    '@orders-api ps: answers:"y,n" New-Env -Name orders-api -Environment uat',
    '@orders-api wait:port:8080 okteto up',
    '! Check orders-api in the dashboard',
    '@fees-api ps: answers:"y,n" New-Env -Name fees-api -Environment uat',
    '@fees-api wait:port:8081 okteto up',
    '! Check fees-api in the dashboard',
    '@web-ui nx run shop:serve --proxyConfig=C:\\runs\\c1.proxy.conf.json',
    '@web-ui stop: echo ui gone',
    '@fees-api stop: okteto down',
    '@fees-api stop: kubectl delete deployment fees-api-main -n team-uat',
    '@orders-api stop: okteto down',
    '@orders-api stop: kubectl delete deployment orders-api-feature-abc-1 -n team-uat',
  ], 'in the stack’s order, whatever order they were picked in');
  const first = parseStep(steps[0])!;
  assert.equal(first.repo, 'orders-api');
  assert.equal(first.ps, true);
  assert.deepEqual(first.answers, ['y', 'n']);
  assert.equal(first.cmd, 'New-Env -Name orders-api -Environment uat');
  assert.deepEqual(parseStep(steps[1])!.wait, { port: 8080 });
  const stop = parseStep(steps[9])!;
  assert.equal(stop.stop, true, 'a stop: after @repo is still a stop step');
  assert.equal(stop.repo, 'fees-api');
  assert.deepEqual(stackSteps(stack, { values: {}, apis: [] }, {}, 'p.json'), ['@web-ui nx run shop:serve --proxyConfig=p.json', '@web-ui stop: echo ui gone'], 'no APIs: the UI alone');
  assert.throws(() => stackSteps(stack, { values: {}, apis: ['nope-api'] }, {}), /no API called nope-api/);
});

test('proxy rules: the picked APIs’ first, replacing the file’s own, which keep their order', () => {
  const rules = stackRules(stack, { values: { env: 'dev' }, apis: ['orders-api'] }, {});
  assert.deepEqual(rules, {
    '/gw/orders/**': { target: 'http://localhost:8080', pathRewrite: { '.*/gw/orders': '' } },
    '/orders/api/**': { target: 'http://localhost:8080/' },
  });
  const base = { '/orders/api/**': { target: 'https://shared.example/gateway/' }, '/gw/**': { target: 'https://shared.example' }, '/assets/**': { target: 'x' } };
  assert.deepEqual(Object.keys(mergeProxy(base, rules)), ['/gw/orders/**', '/orders/api/**', '/gw/**', '/assets/**']);
  assert.deepEqual((mergeProxy(base, rules)['/orders/api/**'] as { target: string }).target, 'http://localhost:8080/');
  assert.deepEqual(mergeProxy(base, {}), base, 'nothing picked: the file as it is');
});

test('suggestions: changed APIs first, else the ones the ticket names', () => {
  assert.ok(namesApi('Totals come back empty from orders-api on submit', stack.apis[0]));
  assert.ok(!namesApi('the new-orders-api-v2 thing', stack.apis[0]), 'whole names only');
  const row = (repo: string, changed: boolean, named: boolean, found = true) => ({ repo, found, changed, named, why: '' });
  assert.deepEqual(suggested([row('orders-api', true, false), row('fees-api', false, true)]), ['orders-api']);
  assert.deepEqual(suggested([row('orders-api', false, false), row('fees-api', false, true)]), ['fees-api']);
  assert.deepEqual(suggested([row('orders-api', true, false, false)]), [], 'not in the card: never ticked');
});

test('the card’s context says the stack runs the app', () => {
  const r = { repo: '', workspaceId: 'w1', steps: [], source: '', stack };
  assert.equal(recipeLabel(r), 'Run: the workspace’s stack (APIs orders-api, fees-api; UI web-ui)');
  assert.match(recipeText(r), /you pick env \(dev \/ uat\) and which APIs to run: orders-api, fees-api\. Then web-ui starts, with apps\/shop\/proxy\.conf\.json pointed at the APIs that run \(a copy; the repo’s file isn’t changed\), at http:\/\/localhost:4200\./);
});
