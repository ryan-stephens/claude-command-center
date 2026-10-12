import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStep, recipeLabel, recipeText } from './recipes.ts';
import { apiVars, choiceLabel, choiceValues, configCandidates, fill, looksSwapped, movedText, stackText, swapRules, swapText, k8sDeployment, k8sName, mergeProxy, namesApi, needsUiPort, proxyFileFor, proxySwaps, swapTargets, runLabel, serviceSteps, STACK_EXAMPLE, stackDraft, stackRules, stackSteps, stackWarnings, suggested, uiPortFor, uiProject, uiUrlFor, unknownStackRepos, retarget, staleUrl, validateStack, withPath, type Stack, type StackRunContext } from './stack.ts';

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
  assert.equal(steps[1], '@orders-api forward:18000:8080 wait:port:18000 okteto up', 'okteto up forwards the picked port without being told');
  assert.equal(stackSteps({ ...stack, api: { ...stack.api, steps: ['ps: $Env:KUBECONFIG = "x"; okteto up', 'forward:no okteto up', 'stop: okteto down', 'okteto exec -- dotnet run'] } }, { values: { env: 'uat' }, apis: ['orders-api'] }, ctx).slice(0, 3).join('\n'),
    '@orders-api forward:18000:8080 ps: $Env:KUBECONFIG = "x"; okteto up\n@orders-api forward:no okteto up\n@orders-api okteto exec -- dotnet run', 'after a ; too; forward:no and other okteto commands left alone');
  assert.equal(stackSteps(stack, { values: { env: 'uat' }, apis: ['orders-api'] }, { ...ctx, ports: {} })[1], '@orders-api wait:port:8080 okteto up', 'no port picked: nothing added');
  assert.deepEqual(stackRules(stack, { values: {}, apis: ['orders-api'] }, ctx)['/orders/api/**'], { target: 'http://localhost:18000/' });
  const withUi = validateStack({ ...STACK_EXAMPLE, apis: [{ repo: 'orders-api', values: { name: 'orders-api', dir: 'OrdersApi', appPort: '8080', route: 'orders' } }] });
  assert.equal(needsUiPort(withUi), true);
  // §114: nx serve with no --port gets one picked and added; its url's fixed port is this run's.
  assert.equal(needsUiPort(stack), true, 'nx serve without --port: one is picked');
  assert.equal(needsUiPort({ ui: { ...stack.ui!, steps: ['npm start'] } }), false, 'a start line that takes no --port: none picked');
  assert.equal(uiUrlFor(withUi, { values: {}, apis: [] }, ctx), 'http://localhost:18001');
  assert.equal(uiUrlFor(stack, { values: {}, apis: [] }, ctx), 'http://localhost:18001');
  assert.deepEqual(serviceSteps(stack, { values: {}, apis: [] }, ctx, 'ui').steps, ['@web-ui nx run shop:serve --proxyConfig=p.json --port 18001']);
  assert.equal(uiUrlFor(stack, { values: {}, apis: [] }, { ...ctx, uiPort: undefined }), 'http://localhost:4200', 'no port picked: the url as written');
  // No url in the stack: the --port in the steps, else the served app's own port and baseHref from its project file, else 4200; ui.path goes after the port.
  const noUrl = (ui: Partial<NonNullable<Stack['ui']>>, c: Partial<StackRunContext> = {}): string | undefined => uiUrlFor({ ...stack, ui: { repo: 'web-ui', steps: ['nx serve deny-withdraw'], ...ui } }, { values: {}, apis: [] }, { ...ctx, uiPort: undefined, ...c });
  assert.equal(noUrl({}), undefined, 'nothing says the port: the address the app prints is used');
  assert.equal(noUrl({ steps: ['nx serve deny-withdraw --port 4216'] }), 'http://localhost:4216');
  assert.equal(noUrl({ steps: ['nx serve deny-withdraw --port={{uiPort}}'] }, { uiPort: 18001 }), 'http://localhost:18001');
  assert.equal(noUrl({}, { uiApp: { name: 'deny-withdraw', port: 4216, path: '/ap-summary/', from: 'apps/deny-withdraw/project.json' } }), 'http://localhost:4216/ap-summary/', 'what its project file says');
  assert.equal(noUrl({ path: '/other/' }, { uiApp: { name: 'deny-withdraw', port: 4216, path: '/ap-summary/', from: 'x' } }), 'http://localhost:4216/other/', 'ui.path wins over the baseHref');
  assert.equal(noUrl({ url: 'http://localhost:{{uiPort}}', path: '/ap-summary/' }, { uiPort: 18001 }), 'http://localhost:18001/ap-summary/');
  assert.equal(noUrl({ url: 'http://localhost:4216/already/', path: '/ap-summary/' }), 'http://localhost:4216/already/', 'a url with a path keeps it');
  // VU: ui.url written as http://localhost:4200 from the example, the step serves deny-withdraw with no --port, and its project file says 4220 at /deny-withdraw/.
  const dw = { name: 'deny-withdraw', port: 4220, path: '/deny-withdraw/', from: 'apps/deny-withdraw/project.json' };
  assert.equal(noUrl({ url: 'http://localhost:4200' }, { uiApp: dw }), 'http://localhost:4220/deny-withdraw/', 'the project file wins over a stale url');
  assert.equal(noUrl({ url: 'http://localhost:4200', steps: ['nx serve deny-withdraw --port 4200'] }, { uiApp: dw }), 'http://localhost:4200/deny-withdraw/', 'unless the step sets that port');
  assert.equal(noUrl({ url: 'http://localhost:4200/x/' }, { uiApp: dw }), 'http://localhost:4200/x/', 'a url with its own path is left alone');
  assert.equal(staleUrl('http://localhost:4200', 4220), true);
  assert.equal(staleUrl('http://localhost:4220/', 4220), false);
  assert.equal(uiPortFor({ ...stack, ui: { repo: 'web-ui', steps: ['nx serve x'], path: '/p/' } }, { values: {}, apis: [] }, { ...ctx, uiPort: undefined, uiApp: { name: 'x', port: 4216, from: 'f' } }), 4216);
  assert.equal(uiProject(['if not exist node_modules npm install', 'node_modules\\.bin\\nx.cmd serve deny-withdraw --proxyConfig={{proxy}}']), 'deny-withdraw');
  assert.equal(uiProject(['npx nx run shop:serve:development --port 4200']), 'shop');
  assert.equal(uiProject(['npx ng serve --proxy-config p.json']), undefined, 'no project named');
  assert.equal(uiProject(['npm start']), undefined);
  assert.equal(withPath('http://localhost:4216', 'ap-summary/'), 'http://localhost:4216/ap-summary/');
  assert.equal(withPath('http://localhost:4216/', '/'), 'http://localhost:4216/');
  assert.equal(validateStack({ api: { steps: ['x'] }, apis: [], ui: { repo: 'w', steps: ['npm start'], path: 'ap-summary/' } }).ui!.path, '/ap-summary/');
  assert.throws(() => validateStack({ api: { steps: ['x'] }, apis: [], ui: { repo: 'w', steps: ['npm start'], path: 'http://x/' } }), /part after the port/);
  const ex = stackSteps(withUi, { values: { env: 'dev' }, apis: ['orders-api'] }, ctx);
  assert.equal(ex[1], '@orders-api wait:port:18000 forward:18000:8080 KUBECONFIG=%KUBECONFIG_DEV% okteto up');
  assert.match(ex[0], /kubectl get deployment orders-api-feature-abc-1 -n team-dev/);
  assert.equal(ex[3], '@web-ui node_modules\\.bin\\nx.cmd run shop:serve:development --proxyConfig=p.json --port 18001');
  assert.equal(runLabel({ env: 'uat' }, ['orders-api', 'fees-api'], { 'orders-api': 18000, 'fees-api': 18002 }, 18001), 'uat · orders-api :18000, fees-api :18002 · UI :18001');
  assert.equal(runLabel({ env: 'dev' }, []), 'dev · UI only');
  assert.equal(runLabel({ env: 'dev' }, ['orders-api'], { 'orders-api': 18000 }, 4216, 'deny-withdraw'), 'dev · orders-api :18000 · deny-withdraw :4216', 'the app the UI serves, on its own port');
  assert.equal(runLabel({ env: 'dev' }, [], {}, undefined, 'deny-withdraw'), 'dev · UI only · deny-withdraw');
});

test('what keeps a stack from running twice at once is said, not enforced', () => {
  const w = stackWarnings(stack);
  assert.equal(w.length, 4, w.join('\n'));
  assert.match(w[0], /orders-api, fees-api: "port" in values now means the port inside the container/);
  assert.match(w[1], /Use \{\{deployment\}\}/);
  assert.match(w[2], /uat can be picked, but ui\.proxyEnv says nothing for it/);
  assert.match(w[3], /uat can be picked, but ui\.configEnv says nothing for it: the UI keeps the default env's runtime config \(its assets\/environmentConfig\.js\)/);
  const set = (configEnv: Record<string, { from: string; to: string }[]>) => stackWarnings({ ...stack, ui: { ...stack.ui!, configEnv } });
  assert.equal(set({ uat: [] }).some((x) => /configEnv/.test(x)), false, 'an empty list says UAT’s config is the default’s');
  assert.equal(set({ uat: [{ from: 'id-dev', to: 'id-uat' }] }).some((x) => /configEnv/.test(x)), false);
  assert.match(stackWarnings({ ...stack, ui: { ...stack.ui!, steps: ['npm start'] } }).at(-1)!, /add --port \{\{uiPort\}\} to its start step/, 'a start line the app can’t give --port to still gets the word (nx serve gets it added, §114)');
  assert.match(stackWarnings({ ...stack, api: { ...stack.api, steps: ['forward:no okteto up'] } })[0], /forward:no keeps the okteto up step on the manifest’s own port/, 'only an opt-out is worth a word');
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

test('a rule written with the container port as a literal follows the picked port', () => {
  // VU's stack as saved: values.port 8080 (the container port) and the API's own rules on http://localhost:8080.
  const s: Stack = validateStack({
    api: { steps: ['okteto up'] },
    apis: [{ repo: 'dw-api', values: { name: 'dw-api', port: '8080' }, proxy: {
      '/azure-gateway/moa/v2/dw/**': { target: 'http://localhost:8080', secure: false, changeOrigin: true, pathRewrite: { '.*/azure-gateway/moa/v2/dw': '' } },
      '/deny-withdraw/api/**': { target: 'http://localhost:8080/', secure: false },
      '/other/**': { target: 'http://localhost:8081/', secure: false },
      '/shared/**': { target: 'https://shared.example/', headers: { Origin: 'http://localhost:4200' } },
    } }],
  });
  const rules = stackRules(s, { values: {}, apis: ['dw-api'] }, { branches: {}, ports: { 'dw-api': 18000 } }) as Record<string, { target: string; headers?: { Origin: string } }>;
  assert.equal(rules['/azure-gateway/moa/v2/dw/**'].target, 'http://localhost:18000');
  assert.equal(rules['/deny-withdraw/api/**'].target, 'http://localhost:18000/');
  assert.equal(rules['/other/**'].target, 'http://localhost:8081/', 'another port is someone else’s');
  assert.equal(rules['/shared/**'].headers!.Origin, 'http://localhost:4200', 'the UI’s own port is left alone');
  assert.equal(rules['/shared/**'].target, 'https://shared.example/');
  const none = stackRules(s, { values: {}, apis: ['dw-api'] }, { branches: {} }) as Record<string, { target: string }>;
  assert.equal(none['/deny-withdraw/api/**'].target, 'http://localhost:8080/', 'no port picked: as written');
  assert.deepEqual(retarget({ a: ['http://localhost:8080/x', 'http://localhost:80800'] }, 8080, 18000), { a: ['http://localhost:18000/x', 'http://localhost:80800'] }, 'the whole port, not a prefix of it');
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
  assert.equal(recipeLabel(r), 'How it runs: the lane’s stack (APIs orders-api, fees-api; UI web-ui)');
  assert.match(recipeText(r), /you pick env \(dev \/ uat\) and which APIs to run: orders-api, fees-api\. Each gets a local port of its own for that run\. Then web-ui starts, with apps\/shop\/proxy\.conf\.json pointed at the APIs that run \(a copy; the repo’s file isn’t changed\), at http:\/\/localhost:4200\./);
});

test('the editor’s draft is built from the workspace’s own repos, and a stack naming others is caught', () => {
  const d = validateStack(stackDraft(['Workspaces-UI', 'Workspaces-API', 'Loans-Service']));
  assert.equal(d.ui!.repo, 'Workspaces-UI');
  assert.deepEqual(d.apis.map((a) => a.repo), ['Workspaces-API', 'Loans-Service']);
  assert.deepEqual(d.apis.map((a) => [a.values.port, a.values.appPort]), [[undefined, '8080'], [undefined, '8080']], 'no local port: it is picked per run; the container port is 8080');
  assert.match(d.api.steps[0], /^wait:port:\{\{port\}\} forward:\{\{port\}\}:\{\{appPort\}\} okteto up/);
  assert.deepEqual(stackWarnings(d).filter((w) => !/proxyEnv|configEnv/.test(w)), [], 'the draft runs twice at once as it is (its UAT pairs are the team’s to write)');
  assert.deepEqual(stackWarnings(STACK_EXAMPLE), [], 'so does the example');
  assert.deepEqual(d.choose, { env: ['dev', 'uat'] });
  assert.deepEqual(unknownStackRepos(d, ['workspaces-ui', 'workspaces-api', 'loans-service']), [], 'folder names, any case');
  // Names that say nothing: the UI is unknown, every repo is an API.
  const plain = stackDraft(['alpha', 'beta']);
  assert.equal(plain.ui, undefined);
  assert.deepEqual(plain.apis.map((a) => a.repo), ['alpha', 'beta']);
  assert.deepEqual(unknownStackRepos(STACK_EXAMPLE, ['Workspaces-UI', 'Workspaces-API']), ['orders-api', 'web-ui'], 'the example’s made-up names');
});

test('ui.proxyEnv moves the proxy file’s own rules to another env; the default env and the local rules are left alone', () => {
  const s = validateStack({
    choose: { env: ['dev', 'uat'] },
    api: { steps: ['okteto up'], proxy: { '/gw/{{route}}/**': { target: 'http://localhost:{{port}}' } } },
    apis: [{ repo: 'orders-api', values: { route: 'orders' } }],
    ui: { repo: 'web-ui', proxyFile: 'proxy.conf.json', proxyEnv: { uat: [{ from: '.dev.example.test', to: '.uat.example.test' }, { from: '-dev.', to: '-uat.' }] }, steps: ['npm start -- --port {{uiPort}}'] },
  });
  const base = { '/gw/fees/**': { target: 'https://fees.dev.example.test', headers: { Origin: 'https://gw-dev.example.test' } }, '/gw/orders/**': { target: 'https://orders.dev.example.test' } };
  assert.deepEqual(proxySwaps(s, {}), [], 'the default (first) env applies nothing');
  assert.deepEqual(proxySwaps(s, { env: 'dev' }), []);
  assert.equal(proxySwaps(s, { env: 'uat' }).length, 2);
  const moved = swapTargets(base, proxySwaps(s, { env: 'uat' }));
  assert.equal(moved['/gw/fees/**'].target, 'https://fees.uat.example.test');
  assert.equal(moved['/gw/fees/**'].headers.Origin, 'https://gw-uat.example.test', 'every string value, headers too');
  assert.ok('/gw/fees/**' in moved, 'routes (keys) are never rewritten');
  const merged = mergeProxy(moved, stackRules(s, { values: { env: 'uat' }, apis: ['orders-api'] }, { branches: {}, ports: { 'orders-api': 18000 } })) as Record<string, { target: string }>;
  assert.equal(merged['/gw/orders/**'].target, 'http://localhost:18000', 'the running API’s rule is added after, never rewritten');
  assert.equal(merged['/gw/fees/**'].target, 'https://fees.uat.example.test');
  assert.deepEqual(swapTargets(base, []), base);
});

test('ui.proxyEnv is checked: keys are values of "choose", pairs are short and few', () => {
  const ui = (proxyEnv: unknown) => ({ choose: { env: ['dev', 'uat'] }, ui: { repo: 'u', steps: ['x'], proxyFile: 'p.json', proxyEnv } });
  assert.deepEqual(validateStack(ui({ uat: [{ from: 'a', to: 'b' }] })).ui?.proxyEnv, { uat: [{ from: 'a', to: 'b' }] });
  assert.equal(validateStack(ui({})).ui?.proxyEnv, undefined);
  assert.throws(() => validateStack(ui({ prod: [] })), /prod isn’t a value in "choose"/);
  assert.throws(() => validateStack(ui([])), /"ui.proxyEnv" should look like/);
  assert.throws(() => validateStack(ui({ uat: [{ from: '', to: 'b' }] })), /pair 1 needs "from"/);
  assert.throws(() => validateStack(ui({ uat: [{ from: 'x'.repeat(201), to: 'b' }] })), /200 characters/);
  assert.throws(() => validateStack(ui({ uat: Array.from({ length: 21 }, () => ({ from: 'a', to: 'b' })) })), /20 at most/);
});

test('{{env}} in ui.proxyFile picks a file per env, still inside the repo; a non-default env with nothing to move its rules is warned about', () => {
  const s = validateStack({ choose: { env: ['dev', 'uat'] }, ui: { repo: 'u', steps: ['npm start -- --port {{uiPort}}'], proxyFile: 'proxy.{{env}}.json' } });
  assert.equal(proxyFileFor(s, {}), 'proxy.dev.json');
  assert.equal(proxyFileFor(s, { env: 'uat' }), 'proxy.uat.json');
  assert.throws(() => validateStack({ ui: { repo: 'u', steps: ['x'], proxyFile: '../{{env}}/p.json' } }), /inside the UI repo/);
  assert.ok(!stackWarnings(s).some((w) => /proxyEnv/.test(w)), 'a file per env needs no pairs');
  const one = validateStack({ choose: { env: ['dev', 'uat'] }, ui: { repo: 'u', steps: ['npm start -- --port {{uiPort}}'], proxyFile: 'proxy.conf.json' } });
  assert.ok(stackWarnings(one).some((w) => /^uat can be picked, but ui\.proxyEnv says nothing/.test(w)));
  assert.ok(!stackWarnings({ ...one, ui: { ...one.ui!, proxyEnv: { uat: [{ from: 'a', to: 'b' }] } } }).some((w) => /proxyEnv/.test(w)));
});

test('pairs apply in order: a specific pair before a broad one wins; after it, it never matches', () => {
  const text = 'issuer: "https://login.dev.example.test", api: "https://gw.dev.example.test", clientId: "id-dev"';
  const specificFirst = swapText(text, [{ from: 'login.dev.example.test', to: 'signin.uat.example.test' }, { from: '.dev.example.test', to: '.uat.example.test' }, { from: 'id-dev', to: 'id-uat' }]);
  assert.equal(specificFirst.text, 'issuer: "https://signin.uat.example.test", api: "https://gw.uat.example.test", clientId: "id-uat"');
  assert.equal(specificFirst.count, 3);
  const broadFirst = swapText(text, [{ from: '.dev.example.test', to: '.uat.example.test' }, { from: 'login.dev.example.test', to: 'signin.uat.example.test' }]);
  assert.match(broadFirst.text, /login\.uat\.example\.test/, 'the broad pair already rewrote it: the specific one finds nothing');
  assert.equal(broadFirst.count, 2);
  const rules = { '/gw/**': { target: 'https://gw.dev.example.test', headers: { Origin: 'https://app.dev.example.test' } }, '/local/**': { target: 'http://localhost:18000' } };
  const r = swapRules(rules, [{ from: '.dev.example.test', to: '.uat.example.test' }]);
  assert.equal(r.count, 2, 'two string values changed: the target and the Origin header');
  assert.equal(r.rules['/gw/**'].headers.Origin, 'https://app.uat.example.test');
  assert.equal(r.rules['/local/**'].target, 'http://localhost:18000', 'a localhost rule is untouched');
});

test('ui.configEnv is checked like ui.proxyEnv; the config file is the served app’s assets/environmentConfig.js unless set', () => {
  const ui = (configEnv: unknown, configFile?: string) => ({ choose: { env: ['dev', 'uat'] }, ui: { repo: 'u', steps: ['x'], configEnv, ...(configFile ? { configFile } : {}) } });
  const s = validateStack(ui({ uat: [{ from: 'id-dev', to: 'id-uat' }] }));
  assert.deepEqual(s.ui?.configEnv, { uat: [{ from: 'id-dev', to: 'id-uat' }] });
  assert.deepEqual(validateStack(ui({ uat: [] })).ui?.configEnv, { uat: [] }, 'an empty list is kept: UAT’s config is the default’s');
  assert.throws(() => validateStack(ui({ prod: [] })), /"ui.configEnv.prod": prod isn’t a value in "choose"/);
  assert.throws(() => validateStack(ui([])), /"ui.configEnv" should look like/);
  assert.throws(() => validateStack(ui({ uat: [{ from: 'x'.repeat(201), to: 'b' }] })), /"ui.configEnv.uat" pair 1 .*200 characters/);
  assert.throws(() => validateStack(ui({ uat: Array.from({ length: 21 }, () => ({ from: 'a', to: 'b' })) })), /20 at most/);
  assert.throws(() => validateStack(ui(undefined, '../other/env.js')), /"ui.configFile" should be a path inside the UI repo/);
  assert.deepEqual(proxySwaps(s, {}, 'configEnv'), [], 'the default env swaps nothing');
  assert.deepEqual(proxySwaps(s, { env: 'uat' }, 'configEnv'), [{ from: 'id-dev', to: 'id-uat' }]);
  assert.deepEqual(proxySwaps(s, { env: 'uat' }), [], 'proxy pairs and config pairs are separate lists');
  assert.deepEqual(configCandidates(s, { name: 'shop', from: 'apps/shop/project.json', src: 'apps/shop/src' }), ['apps/shop/src/assets/environmentConfig.js', 'apps/shop/assets/environmentConfig.js']);
  assert.deepEqual(configCandidates(s), ['src/assets/environmentConfig.js']);
  assert.deepEqual(configCandidates(validateStack(ui(undefined, 'apps/shop/env.js'))), ['apps/shop/env.js']);
});

test('what moved is said in counts, never values; a file already on that env is noted', () => {
  const pairs = [{ from: '.dev.example.test', to: '.uat.example.test' }, { from: 'id-dev', to: 'id-uat' }];
  assert.equal(looksSwapped('clientId: "id-uat"', pairs), true);
  assert.equal(looksSwapped('clientId: "id-dev"', pairs), false);
  assert.equal(looksSwapped('nothing here', pairs), false);
  const t = movedText('UAT', { proxy: 3, config: 0, configFile: 'src/assets/environmentConfig.js', configAlready: true });
  assert.match(t, /^3 proxy targets and 0 config values moved to UAT \(src\/assets\/environmentConfig\.js changed for this run/);
  assert.match(t, /already looks like that env’s/);
  assert.equal(movedText('UAT', { proxy: 1, config: 1 }), '1 proxy target and 1 config value moved to UAT.');
  assert.doesNotMatch(t, /id-uat|example\.test/);
});

test('the context says the UI’s config is changed for the run and never committed, without its values', () => {
  const s = validateStack({ choose: { env: ['dev', 'uat'] }, ui: { repo: 'web-ui', steps: ['x'], configEnv: { uat: [{ from: 'id-dev', to: 'id-uat' }] } } });
  const t = stackText(s);
  assert.match(t, /runtime config \(its assets\/environmentConfig\.js\) is changed to that env’s values for the run and put back on stop/);
  assert.match(t, /Never commit/);
  assert.doesNotMatch(t, /id-uat|id-dev/);
});
