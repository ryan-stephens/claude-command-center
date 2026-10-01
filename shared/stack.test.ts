import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStep, recipeLabel, recipeText } from './recipes.ts';
import { apiVars, choiceLabel, choiceValues, fill, k8sDeployment, k8sName, mergeProxy, namesApi, needsUiPort, runLabel, STACK_EXAMPLE, stackDraft, stackRules, stackSteps, stackWarnings, suggested, uiUrlFor, unknownStackRepos, validateStack, type Stack } from './stack.ts';

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
  assert.equal(k8sDeployment('denial-withdraw-workspace-api', 'WSS-1068-denial-withdraw-letter'), 'denial-withdraw-workspace-api-wss-1068-denial-with', 'cut to 50, as the helper does');
  assert.equal(k8sDeployment('orders-api', 'feature/ABC-12'), 'orders-api-feature-abc-12');
  assert.equal(k8sDeployment('a'.repeat(49), 'x'), 'a'.repeat(49), 'never ends in a dash');
});

test('ports are picked per run: {{port}} is the picked one, {{appPort}} the container’s, {{deployment}} the cut name, {{ENV}} upper case', () => {
  const ctx = { branches: { 'orders-api': 'feature-abc-1', 'web-ui': 'feature-abc-1' }, ports: { 'orders-api': 18000 }, uiPort: 18001, proxy: 'p.json' };
  const vars = apiVars({ env: 'uat' }, stack.apis[0], 'feature-abc-1', 18000);
  assert.equal(vars.port, '18000', 'picked, whatever values.port says');
  assert.equal(vars.appPort, '8080', 'the old values.port is the container port');
  assert.equal(vars.deployment, 'orders-api-feature-abc-1');
  assert.equal(vars.ENV, 'UAT');
  assert.equal(apiVars({}, { repo: 'x-api', values: {} }, 'main').appPort, '8080', 'nothing said: 8080');
  assert.equal(apiVars({}, { repo: 'x-api', values: { port: '5001' } }, 'main').port, '5001', 'no port picked: the value as before');
  const steps = stackSteps(stack, { values: { env: 'uat' }, apis: ['orders-api'] }, ctx);
  assert.equal(steps[1], '@orders-api wait:port:18000 okteto up');
  assert.deepEqual(stackRules(stack, { values: {}, apis: ['orders-api'] }, ctx)['/orders/api/**'], { target: 'http://localhost:18000/' });
  const withUi = validateStack({ ...STACK_EXAMPLE, apis: [{ repo: 'orders-api', values: { name: 'orders-api', dir: 'OrdersApi', appPort: '8080', route: 'orders' } }] });
  assert.equal(needsUiPort(withUi), true);
  assert.equal(needsUiPort(stack), false, 'a fixed port: none picked');
  assert.equal(uiUrlFor(withUi, { values: {}, apis: [] }, ctx), 'http://localhost:18001');
  assert.equal(uiUrlFor(stack, { values: {}, apis: [] }, ctx), 'http://localhost:4200');
  const ex = stackSteps(withUi, { values: { env: 'dev' }, apis: ['orders-api'] }, ctx);
  assert.equal(ex[1], '@orders-api wait:port:18000 forward:18000:8080 KUBECONFIG=%KUBECONFIG_DEV% okteto up');
  assert.match(ex[0], /kubectl get deployment orders-api-feature-abc-1 -n team-dev/);
  assert.equal(ex[3], '@web-ui node_modules\\.bin\\nx.cmd run shop:serve:development --proxyConfig=p.json --port 18001');
  assert.equal(runLabel({ env: 'uat' }, ['orders-api', 'fees-api'], { 'orders-api': 18000, 'fees-api': 18002 }, 18001), 'uat · orders-api :18000, fees-api :18002 · UI :18001');
  assert.equal(runLabel({ env: 'dev' }, []), 'dev · UI only');
});

test('what keeps a stack from running twice at once is said, not enforced', () => {
  const w = stackWarnings(stack);
  assert.equal(w.length, 4, w.join('\n'));
  assert.match(w[0], /okteto up step doesn’t forward it: put forward:\{\{port\}\}:\{\{appPort\}\}/);
  assert.match(w[1], /orders-api, fees-api: "port" in values now means the port inside the container/);
  assert.match(w[2], /Use \{\{deployment\}\}/);
  assert.match(w[3], /add --port \{\{uiPort\}\} to its start step/);
  assert.deepEqual(stackWarnings(validateStack({ api: { steps: ['PORT={{port}} dotnet run'] }, apis: [{ repo: 'a-api', values: { appPort: '80' } }] })), [], 'no okteto, no proxy: nothing to say');
});

test('what is picked is checked against what the stack offers, default first', () => {
  assert.deepEqual(choiceValues(stack), { env: 'dev' });
  assert.deepEqual(choiceValues(stack, { env: 'uat' }), { env: 'uat' });
  assert.throws(() => choiceValues(stack, { env: 'prod' }), /env can be dev or uat, not prod/);
  assert.equal(choiceLabel({ env: 'uat' }, ['orders-api', 'fees-api']), 'uat · orders-api, fees-api');
  assert.equal(choiceLabel({ env: 'dev' }, []), 'dev · UI only');
});

test('the run: each picked API’s steps in its repo, then the UI, then stop steps in reverse', () => {
  const steps = stackSteps(stack, { values: { env: 'uat' }, apis: ['fees-api', 'orders-api'] }, { branches: { 'orders-api': 'feature-abc-1', 'fees-api': 'main' }, proxy: 'C:\\runs\\c1.proxy.conf.json' });
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
  assert.deepEqual(stackSteps(stack, { values: {}, apis: [] }, { branches: {}, proxy: 'p.json' }), ['@web-ui nx run shop:serve --proxyConfig=p.json', '@web-ui stop: echo ui gone'], 'no APIs: the UI alone');
  assert.throws(() => stackSteps(stack, { values: {}, apis: ['nope-api'] }, { branches: {} }), /no API called nope-api/);
});

test('proxy rules: the picked APIs’ first, replacing the file’s own, which keep their order', () => {
  const rules = stackRules(stack, { values: { env: 'dev' }, apis: ['orders-api'] }, { branches: {} });
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
  assert.match(recipeText(r), /you pick env \(dev \/ uat\) and which APIs to run: orders-api, fees-api\. Each gets a local port of its own for that run\. Then web-ui starts, with apps\/shop\/proxy\.conf\.json pointed at the APIs that run \(a copy; the repo’s file isn’t changed\), at http:\/\/localhost:4200\./);
});

test('the editor’s draft is built from the workspace’s own repos, and a stack naming others is caught', () => {
  const d = validateStack(stackDraft(['Workspaces-UI', 'Workspaces-API', 'Loans-Service']));
  assert.equal(d.ui!.repo, 'Workspaces-UI');
  assert.deepEqual(d.apis.map((a) => a.repo), ['Workspaces-API', 'Loans-Service']);
  assert.deepEqual(d.apis.map((a) => [a.values.port, a.values.appPort]), [[undefined, '8080'], [undefined, '8080']], 'no local port: it is picked per run; the container port is 8080');
  assert.match(d.api.steps[0], /^wait:port:\{\{port\}\} forward:\{\{port\}\}:\{\{appPort\}\} okteto up/);
  assert.deepEqual(stackWarnings(d), [], 'the draft runs twice at once as it is');
  assert.deepEqual(stackWarnings(STACK_EXAMPLE), [], 'so does the example');
  assert.deepEqual(d.choose, { env: ['dev', 'uat'] });
  assert.deepEqual(unknownStackRepos(d, ['workspaces-ui', 'workspaces-api', 'loans-service']), [], 'folder names, any case');
  // Names that say nothing: the UI is unknown, every repo is an API.
  const plain = stackDraft(['alpha', 'beta']);
  assert.equal(plain.ui, undefined);
  assert.deepEqual(plain.apis.map((a) => a.repo), ['alpha', 'beta']);
  assert.deepEqual(unknownStackRepos(STACK_EXAMPLE, ['Workspaces-UI', 'Workspaces-API']), ['orders-api', 'web-ui'], 'the example’s made-up names');
});
