import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectStack, envNamesIn, healthRoute, manifestName, ruleFor, templateRule, uiServe, type RepoFiles } from './stack-detect.ts';
import { stackWarnings, validateStack } from './stack.ts';

/** A repo in memory. */
const repo = (name: string, files: Record<string, string>): RepoFiles => ({ name, files: Object.keys(files), read: (f) => files[f] });

const MANIFEST = 'name: loans-api\nimage: registry.example/dotnet-dev:8\nsync:\n  - .:/usr/src/app\nforward:\n  - 8080:80\n';
const CONTROLLER = 'namespace LoansApi.Controllers;\n[ApiController]\n[Route("self")]\npublic class SelfController : ControllerBase { }\n';
const PROXY = '{\n  // shared\n  "/gateway/team/loans/**": { "target": "https://shared.example", "secure": false, "pathRewrite": { ".*/gateway/team/loans": "" } },\n  "/gateway/team/fees/**": { "target": "https://shared.example", "secure": false, "pathRewrite": { ".*/gateway/team/fees": "" } },\n  "/assets/**": { "target": "https://cdn.example" },\n}\n';
const ANGULAR = JSON.stringify({ defaultProject: 'shop', projects: { shop: { architect: { serve: { options: { proxyConfig: 'apps/shop/proxy.conf.json', port: 4200 } } } } } });

test('pieces: the manifest’s name, a health route, the UI’s serve command, the rule for an API', () => {
  assert.equal(manifestName(MANIFEST), 'loans-api');
  assert.equal(manifestName('dev:\n  fees-api:\n    image: x\n'), 'fees-api', 'a v2 manifest');
  assert.equal(manifestName('image: x\n'), undefined);
  assert.equal(healthRoute(CONTROLLER), '/self');
  assert.equal(healthRoute('app.MapHealthChecks("/healthz");'), '/healthz');
  assert.equal(healthRoute('app.MapGet("/ping", () => "pong");'), '/ping');
  assert.equal(healthRoute('[HttpGet("health")]'), '/health');
  assert.equal(healthRoute('app.MapGet("/loans/{id}", …)'), undefined, 'not obvious: not guessed');
  assert.deepEqual(uiServe(repo('shop-ui', { 'angular.json': ANGULAR })), { command: 'npx ng serve shop --proxy-config {{proxy}} --port {{uiPort}}', proxyFile: 'apps/shop/proxy.conf.json', port: 4200, from: 'angular.json' });
  assert.deepEqual(uiServe(repo('shop', { 'project.json': JSON.stringify({ name: 'shop', targets: { serve: { options: { proxyConfig: 'proxy.conf.json' } } } }) })), { command: 'npx nx serve shop --proxyConfig={{proxy}} --port={{uiPort}}', proxyFile: 'proxy.conf.json', from: 'project.json' });
  assert.equal(uiServe(repo('site', { 'package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '5' } }) }))!.command, 'npm run dev -- --port {{uiPort}}');
  assert.equal(uiServe(repo('lib', { 'package.json': JSON.stringify({ scripts: { test: 'x' } }) })), undefined);
  const rules = JSON.parse(PROXY.replace(/\/\/.*\n/, '').replace(/,(\s*[}\]])/g, '$1')) as Record<string, unknown>;
  assert.equal(ruleFor(rules, { repo: 'fees-api', name: 'fees-api', route: 'fees' }), '/gateway/team/fees/**');
  assert.equal(ruleFor(rules, { repo: 'docs-api', name: 'docs', route: 'docs' }), undefined);
  assert.deepEqual(templateRule('/gateway/team/fees/**', rules['/gateway/team/fees/**'], 'fees'), { key: '/gateway/team/{{route}}/**', rule: { target: 'http://localhost:{{port}}', secure: false, pathRewrite: { '.*/gateway/team/{{route}}': '' } } });
});

test('a workspace’s repos become a stack: APIs from okteto.yml and .csproj, the UI from angular.json, routes from the proxy file, the rest asked', () => {
  const d = detectStack([
    repo('shop-ui', { 'angular.json': ANGULAR, 'package.json': '{}', 'apps/shop/proxy.conf.json': PROXY }),
    repo('loans-api', { 'okteto.yml': MANIFEST, 'src/LoansApi/LoansApi.csproj': '<Project />', 'src/LoansApi/Controllers/SelfController.cs': CONTROLLER, 'README.md': '' }),
    repo('fees-api', { 'src/FeesApi/FeesApi.csproj': '<Project />', 'src/FeesApi/Program.cs': 'var app = builder.Build(); app.MapHealthChecks("/health"); app.Run();' }),
    repo('team-docs', { 'README.md': '# docs' }),
  ]);
  const s = validateStack(d.stack);
  assert.deepEqual(s.choose, { env: ['dev', 'uat'] });
  assert.deepEqual(s.api.steps, ['wait:http:{{port}}{{health}} forward:{{port}}:{{appPort}} okteto up', 'stop: okteto down'], 'okteto, since one API has a manifest');
  assert.deepEqual(s.apis, [
    { repo: 'loans-api', values: { name: 'loans-api', appPort: '80', route: 'loans', dir: 'src/LoansApi', health: '/self' } },
    { repo: 'fees-api', values: { name: 'fees-api', appPort: '8080', route: 'fees', dir: 'src/FeesApi', health: '/health' } },
  ]);
  assert.deepEqual(s.api.proxy, { '/gateway/team/{{route}}/**': { target: 'http://localhost:{{port}}', secure: false, pathRewrite: { '.*/gateway/team/{{route}}': '' } } }, 'the template from the first matched rule');
  assert.deepEqual(s.ui, { repo: 'shop-ui', proxyFile: 'apps/shop/proxy.conf.json', proxyMode: 'override', steps: ['if not exist node_modules npm install', 'npx ng serve shop --proxy-config {{proxy}} --port {{uiPort}}'], url: 'http://localhost:{{uiPort}}' });
  assert.deepEqual(stackWarnings(s), [], 'runs twice at once as found');
  const say = (repoName: string) => d.findings.filter((f) => f.repo === repoName).map((f) => `${f.asked ? '? ' : ''}${f.text}${f.from ? ` [${f.from}]` : ''}`);
  assert.deepEqual(say('loans-api'), [
    'okteto: dev name loans-api, forwards 8080→80; the container port is 80 [okteto.yml]',
    'project in src/LoansApi [src/LoansApi/*.csproj]',
    'ready when /self answers [src/LoansApi/Controllers/SelfController.cs]',
    'proxied by the rule /gateway/team/loans/** (the template for every API) [apps/shop/proxy.conf.json]',
  ]);
  assert.deepEqual(say('fees-api'), [
    '? no okteto.yml: runs with dotnet; the container port is assumed to be 8080',
    'project in src/FeesApi [src/FeesApi/*.csproj]',
    'ready when /health answers [src/FeesApi/Program.cs]',
    '? has no okteto.yml, but the template runs okteto up there too: add one, or give the API its own steps',
    'proxied by the rule /gateway/team/fees/** [apps/shop/proxy.conf.json]',
  ]);
  assert.deepEqual(say('shop-ui'), [
    'serves with npx ng serve shop --proxy-config {{proxy}} --port {{uiPort}} [angular.json]',
    'proxy rules: /gateway/team/loans/**, /gateway/team/fees/**, /assets/** [apps/shop/proxy.conf.json]',
  ]);
  assert.deepEqual(say('team-docs'), ['nothing to go on (no okteto.yml, .csproj, angular.json, project.json or package.json): left out of the stack']);
  assert.deepEqual(say(''), [
    '? anything your team runs before okteto up (a helper that writes the manifest and deploys the branch) goes first in api.steps',
    '? environments: dev (the default) and uat; change choose.env if yours differ',
  ]);
});

test('without okteto: dotnet or npm; a UI with no proxy file; an API with a rule of its own shape; nothing at all', () => {
  const d = detectStack([
    repo('orders-api', { 'OrdersApi.csproj': '<Project />' }),
    repo('web', { 'package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '5' } }) }),
  ]);
  const s = validateStack(d.stack);
  assert.deepEqual(s.api.steps, ['wait:http:{{port}}{{health}} ASPNETCORE_URLS=http://localhost:{{port}} dotnet run --project {{dir}}']);
  assert.equal(s.apis[0].values.dir, '.', 'the project file at the root');
  assert.deepEqual(s.ui, { repo: 'web', steps: ['if not exist node_modules npm install', 'npm run dev -- --port {{uiPort}}'], url: 'http://localhost:{{uiPort}}' }, 'no proxy file: no proxy flag, no mode');
  assert.ok(d.findings.some((f) => f.repo === 'web' && f.asked && /no proxy file found/.test(f.text)));

  const own = detectStack([
    repo('ui', { 'angular.json': ANGULAR, 'apps/shop/proxy.conf.json': '{ "/loans/v2/**": { "target": "https://x", "changeOrigin": true }, "/api/fees/**": { "target": "https://y" } }' }),
    repo('loans-api', { 'okteto.yml': MANIFEST }),
    repo('fees-api', { 'okteto.yaml': 'name: fees-api\nforward:\n  - 8080:8080\n' }),
  ]);
  const o = validateStack(own.stack);
  assert.deepEqual(o.api.proxy, { '/{{route}}/v2/**': { target: 'http://localhost:{{port}}', changeOrigin: true } });
  assert.deepEqual(o.apis[1].proxy, { '/api/fees/**': { target: 'http://localhost:{{port}}' } }, 'another shape: the API’s own rule');
  assert.equal(o.apis[0].values.health, '/', 'no code to read: / (a 404 counts)');

  const node = detectStack([repo('notes-api', { 'package.json': JSON.stringify({ scripts: { start: 'node server.js' } }) })]);
  assert.deepEqual(validateStack(node.stack).api.steps, ['wait:http:{{port}}{{health}} PORT={{port}} npm start']);
  assert.equal(detectStack([repo('docs', { 'README.md': '' })]).stack, undefined, 'nothing to go on: no stack');
  assert.deepEqual(envNamesIn({ ...o, api: { ...o.api, steps: ['KUBECONFIG=%KUBECONFIG_{{ENV}}% okteto up', 'stop: %OKTETO% down'] } }), ['KUBECONFIG_{{ENV}}', 'OKTETO']);
});
