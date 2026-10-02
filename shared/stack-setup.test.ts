import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STACK_EXAMPLE, stackDraft } from './stack.ts';
import { apiStepsFrom, DEFAULT_KNOBS, formFromStack, knobsFromSteps, stackFromForm } from './stack-setup.ts';

test('the knobs write the step lines, and the lines read back as the same knobs', () => {
  const k = { deploy: 'New-Thing -Name {{name}} -Environment {{env}}', answers: 'y, n', run: 'cd {{dir}} && dotnet watch run', kubeconfig: true, teardown: 'team-{{env}}' };
  const steps = apiStepsFrom(k);
  assert.deepEqual(steps, [
    'ps: answers:"y,n" KUBECONFIG=%KUBECONFIG_{{ENV}}% New-Thing -Name {{name}} -Environment {{env}}',
    'wait:port:{{port}} KUBECONFIG=%KUBECONFIG_{{ENV}}% okteto up',
    'wait:http:{{port}}{{health}} KUBECONFIG=%KUBECONFIG_{{ENV}}% okteto exec -- sh -c "cd {{dir}} && dotnet watch run"',
    'stop: KUBECONFIG=%KUBECONFIG_{{ENV}}% okteto down',
    'stop: KUBECONFIG=%KUBECONFIG_{{ENV}}% kubectl delete deployment {{deployment}} -n team-{{env}}',
  ]);
  assert.deepEqual(knobsFromSteps(steps), { ...k, answers: 'y,n' });
  // The least: okteto up alone, no kubeconfig, nothing else.
  const bare = { deploy: '', answers: '', run: '', kubeconfig: false, teardown: '' };
  assert.deepEqual(apiStepsFrom(bare), ['wait:http:{{port}}{{health}} okteto up', 'stop: okteto down']);
  assert.deepEqual(knobsFromSteps(apiStepsFrom(bare)), bare);
  assert.deepEqual(knobsFromSteps(apiStepsFrom(DEFAULT_KNOBS)), DEFAULT_KNOBS);
});

test('lines not written by the knobs are custom', () => {
  assert.equal(knobsFromSteps(STACK_EXAMPLE.api.steps), undefined, 'the example has kubectl apply in its first line and no exec shape');
  assert.equal(knobsFromSteps(['echo hi']), undefined);
  assert.equal(knobsFromSteps([]), undefined);
  assert.equal(knobsFromSteps(['wait:port:{{port}} okteto up', 'stop: okteto down', 'echo extra']), undefined, 'an extra line');
  assert.equal(knobsFromSteps(['wait:port:{{port}} KUBECONFIG=%KUBECONFIG_{{ENV}}% okteto up', 'stop: okteto down']), undefined, 'kubeconfig on one line but not the other');
});

test('the form from a saved stack lists every lane repo, ticks the ones in the stack, and keeps custom lines', () => {
  const f = formFromStack(STACK_EXAMPLE, undefined, ['orders-api', 'fees-api', 'web-ui']);
  assert.deepEqual(f.envs, ['dev', 'uat']);
  assert.equal(f.ui?.repo, 'web-ui');
  assert.equal(f.ui?.proxyFile, 'apps/shop/proxy.conf.json');
  assert.deepEqual(f.apis.map((a) => [a.repo, a.on, a.dir]), [['orders-api', true, 'OrdersApi'], ['fees-api', false, '']]);
  assert.equal(f.custom, true);
  assert.deepEqual(f.steps, STACK_EXAMPLE.api.steps);
  assert.match(f.proxyRule, /gateway/);
  // Saving it back keeps the lines as they are.
  const back = stackFromForm(f);
  assert.deepEqual(back.api.steps, STACK_EXAMPLE.api.steps);
  assert.deepEqual(back.apis.map((a) => a.repo), ['orders-api']);
  assert.equal(back.ui?.proxyFile, 'apps/shop/proxy.conf.json');
});

test('a lane with no stack starts from what the repos say, else from the default knobs', () => {
  const det = stackDraft(['loans-api', 'web-app']);
  const f = formFromStack(undefined, det, ['loans-api', 'web-app']);
  assert.equal(f.ui?.repo, 'web-app');
  assert.deepEqual(f.apis.map((a) => [a.repo, a.on]), [['loans-api', true]]);
  assert.equal(f.custom, true, 'the detector’s lines aren’t the knobs’ shape');
  const bare = formFromStack(undefined, undefined, ['a-api', 'b-api']);
  assert.equal(bare.ui, undefined);
  assert.deepEqual(bare.apis.map((a) => a.on), [false, false]);
  assert.equal(bare.custom, false);
  assert.deepEqual(bare.knobs, DEFAULT_KNOBS);
  assert.deepEqual(bare.steps, apiStepsFrom(DEFAULT_KNOBS));
  assert.match(bare.proxyRule, /\{\{route\}\}/);
});

test('the stack from the form: knobs become lines, values are checked and said in the form’s words', () => {
  const f = formFromStack(undefined, undefined, ['loans-api', 'web-app']);
  f.apis[0].on = true;
  f.apis[0].dir = 'src/LoansApi';
  f.apis[0].health = 'self';
  f.knobs = { ...DEFAULT_KNOBS, deploy: 'Make-Deployment {{name}} {{env}}', answers: 'y' };
  f.ui = { repo: 'web-app', proxyFile: 'proxy.conf.json', start: 'npm start -- --proxy-config {{proxy}} --port {{uiPort}}', url: 'http://localhost:{{uiPort}}', path: '' };
  const s = stackFromForm(f);
  assert.equal(s.api.steps[0], 'ps: answers:"y" KUBECONFIG=%KUBECONFIG_{{ENV}}% Make-Deployment {{name}} {{env}}');
  assert.deepEqual(s.apis[0].values, { name: 'loans-api', appPort: '8080', dir: 'src/LoansApi', health: '/self', route: 'loans' });
  assert.equal(s.ui?.url, 'http://localhost:{{uiPort}}');
  assert.throws(() => stackFromForm({ ...f, envs: [] }), /at least one environment/);
  assert.throws(() => stackFromForm({ ...f, apis: [{ ...f.apis[0], appPort: 'x' }] }), /container port/);
  assert.throws(() => stackFromForm({ ...f, apis: [{ ...f.apis[0], dir: '' }] }), /project folder/);
  assert.throws(() => stackFromForm({ ...f, proxyRule: '{ nope' }), /valid JSON/);
  assert.throws(() => stackFromForm({ ...f, apis: [{ ...f.apis[0], on: false }], ui: undefined }), /Tick at least one API/);
});
