import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { cardRecipe, findUrl, parseStep, parseSteps, portOf, recipeLabel, recipeText, stepLabel, waitLabel, wsRecipeKey } from '../shared/recipes.ts';
import { appLike, cardRecipeOf, detectRecipe, expandVars, recipeOf, RunService, saveRecipe, saveWorkspaceRecipe, urlFromScript, workspaceRecipeOf } from './recipes.ts';
import { Store } from './store.ts';

const dir = mkdtempSync(join(tmpdir(), 'cc-recipes-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function repo(name: string, files: Record<string, string>): string {
  const p = join(dir, name);
  mkdirSync(p, { recursive: true });
  for (const [f, text] of Object.entries(files)) writeFileSync(join(p, f), text);
  return p;
}

test('detects a recipe from package.json, the lockfile and compose.yaml', () => {
  const web = repo('web', {
    'package.json': JSON.stringify({ scripts: { 'db:seed': 'node seed.js', dev: 'vite', build: 'vite build', start: 'node dist' } }),
    'pnpm-lock.yaml': '',
  });
  assert.deepEqual(detectRecipe(web), { repo: web, steps: ['pnpm install', 'pnpm db:seed', 'pnpm dev'], url: 'http://localhost:5173', source: 'detected from package.json' });
  const api = repo('api', { 'package.json': JSON.stringify({ scripts: { start: 'node server.js --port 4010' } }), 'compose.yaml': 'services: {}' });
  assert.deepEqual(detectRecipe(api)!.steps, ['docker compose up -d', 'npm install', 'npm run start']);
  assert.equal(detectRecipe(api)!.url, 'http://localhost:4010');
  assert.equal(detectRecipe(api)!.source, 'detected from compose.yaml + package.json');
  const plain = repo('plain', { 'server.js': 'import express from "express";\napp.listen(3000);' });
  assert.deepEqual(detectRecipe(plain), { repo: plain, steps: ['node server.js'], url: 'http://localhost:3000', source: 'detected from server.js' });
  assert.equal(detectRecipe(repo('tokens', { 'tokens.json': '{}' })), undefined, 'nothing to go on');
});

test('where a dev script serves', () => {
  assert.equal(urlFromScript('next dev'), 'http://localhost:3000');
  assert.equal(urlFromScript('astro dev --port 4400'), 'http://localhost:4400');
  assert.equal(urlFromScript('PORT=8080 node app.js'), 'http://localhost:8080');
  assert.equal(urlFromScript('node app.js'), undefined);
});

test('reads the URL an app prints, and its port', () => {
  assert.equal(findUrl('  \x1b[32m➜\x1b[39m  Local:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m'), 'http://localhost:5173', 'Vite colours the port; the codes are dropped');
  assert.equal(findUrl('  ➜  Local:   http://localhost:5173/'), 'http://localhost:5173');
  assert.equal(findUrl('Listening on http://0.0.0.0:4010/api'), 'http://localhost:4010/api');
  assert.equal(findUrl('see https://example.com'), undefined, 'only this machine');
  assert.equal(portOf('http://localhost:5173'), 5173);
  assert.equal(portOf('http://localhost'), 80);
});

test('only steps that could be the app are taken to be up without printing a URL', () => {
  assert.ok(appLike('pnpm dev', false));
  assert.ok(appLike('node server.js', false));
  assert.ok(!appLike('pnpm install', false), 'an install has to finish');
  assert.ok(!appLike('docker compose up -d', false), 'up -d exits by itself');
  assert.ok(appLike('pnpm install', true), 'the last step is the app');
});

test('a recipe you write wins over the detected one; saving none goes back', () => {
  const store = new Store(join(dir, 'r.db'));
  try {
    const web = join(dir, 'web');
    saveRecipe(store, web, ['pnpm i', '  ', 'pnpm dev --port 5000'], 'http://localhost:5000');
    assert.deepEqual(recipeOf(store, web.toUpperCase()), { repo: web.toUpperCase(), steps: ['pnpm i', 'pnpm dev --port 5000'], url: 'http://localhost:5000', source: 'written by you', edited: true });
    assert.throws(() => saveRecipe(store, web, ['x'], 'localhost'), /should look like/);
    saveRecipe(store, web, []);
    assert.equal(recipeOf(store, web)!.source, 'detected from package.json');
  } finally {
    store.close();
  }
});

test('parses the editor and says how to run it', () => {
  assert.deepEqual(parseSteps('pnpm install\r\n\r\n  pnpm dev  \n'), ['pnpm install', 'pnpm dev']);
  assert.equal(recipeText({ repo: 'D:\\r\\web-app', steps: ['pnpm i', 'pnpm dev'], url: 'http://localhost:5173', source: '' }).split('.')[0], 'In web-app: pnpm i && pnpm dev, then open http://localhost:5173');
});

const until = async (ok: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('runs the steps in order; the app stays up at the URL it printed until stopped', async () => {
  const cwd = repo('run', {
    'setup.js': "require('fs').writeFileSync('ready.txt', 'yes'); console.log('seeded')",
    'app.js': "const s=require('http').createServer((q,r)=>r.end('ok')).listen(0,()=>console.log('Local: http://localhost:'+s.address().port+'/'))",
  });
  let changes = 0;
  const runs = new RunService(() => { changes++; }, process.env);
  try {
    runs.start('card-1', { repo: cwd, steps: ['node setup.js', 'node app.js'], source: '' }, cwd);
    await until(() => runs.get('card-1')?.state === 'up');
    const run = runs.get('card-1')!;
    assert.deepEqual(run.steps.map((s) => s.state), ['ok', 'up']);
    assert.deepEqual(run.steps[0].tail, ['seeded']);
    assert.match(run.url!, /^http:\/\/localhost:\d+$/);
    assert.equal(run.text, `Running at ${run.url}`);
    assert.equal(await (await fetch(run.url!)).text(), 'ok');
    runs.stop('card-1');
    assert.equal(runs.get('card-1')!.state, 'stopped');
    await until(() => runs.get('card-1')!.steps[1].state === 'off');
    await assert.rejects(fetch(run.url!), 'the app is gone');
    assert.ok(changes > 2);
  } finally {
    runs.stopAll();
  }
});

test('a failing step stops the run there and keeps what it printed', async () => {
  const cwd = repo('fail', {});
  const runs = new RunService(() => {}, process.env);
  try {
    runs.start('card-2', { repo: cwd, steps: ['node -e "console.error(\'Cannot find package express\'); process.exit(3)"', 'node -e "1"'], source: '' }, cwd);
    await until(() => runs.get('card-2')?.state === 'failed');
    const run = runs.get('card-2')!;
    assert.deepEqual(run.steps.map((s) => s.state), ['bad', 'wait']);
    assert.equal(run.steps[0].code, 3);
    assert.deepEqual(run.steps[0].tail, ['Cannot find package express']);
    assert.match(run.text, /failed \(exit 3\)/);
  } finally {
    runs.stopAll();
  }
});

test('a step line: @repo, variables, stop:, notes and comments', () => {
  assert.deepEqual(parseStep('@Workspaces-UI API_URL=https://api-rs.okteto.vu.local MODE="a b" npm run dev'),
    { line: '@Workspaces-UI API_URL=https://api-rs.okteto.vu.local MODE="a b" npm run dev', cmd: 'npm run dev', repo: 'Workspaces-UI', env: { API_URL: 'https://api-rs.okteto.vu.local', MODE: 'a b' }, stop: false, note: false });
  assert.deepEqual(parseStep('stop: @api okteto destroy'), { line: 'stop: @api okteto destroy', cmd: 'okteto destroy', repo: 'api', env: {}, stop: true, note: false });
  assert.deepEqual(parseStep('! Sign in as a test borrower'), { line: '! Sign in as a test borrower', cmd: 'Sign in as a test borrower', env: {}, stop: false, note: true });
  assert.equal(parseStep('# the backend first'), undefined);
  assert.equal(parseStep('   '), undefined);
  assert.equal(parseStep('pnpm dev --port=5000')!.cmd, 'pnpm dev --port=5000', 'an = inside the command is not a variable');
  assert.equal(stepLabel(parseStep('@web SECRET=abc npm run dev')!), '@web SECRET=… npm run dev', 'values are never shown');
});

test('a workspace recipe, told to Claude step by step; a card runs its workspace’s when there is one', () => {
  const ws = { repo: '', workspaceId: 'w1', source: '', url: 'http://localhost:4200', steps: ['@api okteto deploy --wait', '@web API_URL=https://x npm start', '! Sign in', 'stop: @api okteto destroy'] };
  assert.equal(recipeLabel(ws), 'Run recipe: @api okteto deploy --wait, @web API_URL=… npm start');
  assert.equal(recipeText(ws), 'The workspace’s run recipe, in order:\n- in api: okteto deploy --wait\n- in web: (with API_URL set) npm start\n- By hand: Sign in\n- When stopping: in api: okteto destroy\nMost of these keep running (the app); then open http://localhost:4200. cc-control runs this when you press Try it; don’t leave a copy of the app running.'.replace('don’t', "don't"));
  const repoR = { repo: 'D:\\r\\web', source: '', steps: ['pnpm dev'] };
  const map = { 'D:\\r\\web': repoR, [wsRecipeKey('w1')]: ws };
  assert.equal(cardRecipe(map, 'w1', 'D:\\r\\web'), ws);
  assert.equal(cardRecipe(map, 'w2', 'D:\\r\\web'), repoR);
  assert.equal(cardRecipe(map, null, 'd:\\R\\WEB'), repoR);
});

test('workspace recipes are saved, win over a repo’s, and are removed by saving none', () => {
  const store = new Store(join(dir, 'ws.db'));
  try {
    const web = repo('ws-web', { 'package.json': JSON.stringify({ scripts: { dev: 'vite' } }) });
    assert.equal(cardRecipeOf(store, 'w1', web)!.source, 'detected from package.json');
    saveWorkspaceRecipe(store, 'w1', ['@api okteto deploy', '', '@web npm run dev'], 'http://localhost:4200');
    assert.deepEqual(workspaceRecipeOf(store, 'w1'), { repo: '', workspaceId: 'w1', steps: ['@api okteto deploy', '@web npm run dev'], url: 'http://localhost:4200', edited: true, source: 'the workspace’s, written by you' });
    assert.equal(cardRecipeOf(store, 'w1', web)!.workspaceId, 'w1');
    saveWorkspaceRecipe(store, 'w1', ['echo hi'], undefined, true);
    assert.match(workspaceRecipeOf(store, 'w1')!.source, /from the workspace file you imported: check it before running/);
    saveWorkspaceRecipe(store, 'w1', []);
    assert.equal(workspaceRecipeOf(store, 'w1'), undefined);
    assert.equal(cardRecipeOf(store, 'w1', web)!.source, 'detected from package.json');
  } finally {
    store.close();
  }
});

test('a workspace run: each step in its repo with its own variables, notes skipped, a missing repo said, stop: steps run on stop', async () => {
  const api = repo('ws-api', { 'deploy.js': "require('fs').writeFileSync('deployed.txt', process.env.NAMESPACE); console.log('deployed to ' + process.env.NAMESPACE)", 'destroy.js': "require('fs').writeFileSync('destroyed.txt', 'yes')" });
  const web = repo('ws-webapp', { 'app.js': "const s=require('http').createServer((q,r)=>r.end(process.env.API_URL)).listen(0,()=>console.log('Local: http://localhost:'+s.address().port+'/'))" });
  const cardFolder = repo('ws-webapp-worktree', { 'app.js': readFileSync(join(web, 'app.js'), 'utf8') });
  const runs = new RunService(() => {}, process.env);
  const places = { cwd: cardFolder, repos: { 'ws-api': api, 'ws-webapp': cardFolder } };
  try {
    const recipe = { repo: '', workspaceId: 'w1', source: '', steps: ['@ws-api NAMESPACE=rs-dev node deploy.js', '! Check the Okteto dashboard', '@ws-webapp API_URL=https://api-rs.okteto.vu.local node app.js', 'stop: @ws-api node destroy.js'] };
    await runs.start('c1', recipe, places);
    await until(() => runs.get('c1')?.state === 'up');
    const run = runs.get('c1')!;
    assert.deepEqual(run.steps.map((s) => s.state), ['ok', 'note', 'up', 'wait']);
    assert.equal(readFileSync(join(api, 'deployed.txt'), 'utf8'), 'rs-dev', 'the first step ran in the api repo with its variable');
    assert.deepEqual(run.steps[0].env, ['NAMESPACE'], 'names only reach the page');
    assert.equal(await (await fetch(run.url!)).text(), 'https://api-rs.okteto.vu.local', 'the app got its own variable');
    assert.equal(existsSync(join(api, 'destroyed.txt')), false);
    await runs.stop('c1');
    assert.equal(readFileSync(join(api, 'destroyed.txt'), 'utf8'), 'yes', 'stop: ran in the api repo');
    assert.equal(runs.get('c1')!.steps[3].state, 'ok');
    assert.equal(runs.get('c1')!.text, 'Stopped');

    await runs.start('c2', { repo: '', source: '', steps: ['@nowhere echo hi'] }, places);
    await until(() => runs.get('c2')?.state === 'failed');
    assert.match(runs.get('c2')!.steps[0].tail[0], /No repo called nowhere in this card or its workspace \(ws-api, ws-webapp\)/);
  } finally {
    runs.stopAll();
  }
});

test('a step line: ps:, wait: and answers:, in any order with @repo and stop:', () => {
  assert.deepEqual(parseStep('@api stop: ps: kubectl delete deployment x -n team-dev'),
    { line: '@api stop: ps: kubectl delete deployment x -n team-dev', cmd: 'kubectl delete deployment x -n team-dev', repo: 'api', env: {}, stop: true, note: false, ps: true });
  const s = parseStep('wait:"Now listening on" answers:"y, n" @api PORT=8080 okteto up')!;
  assert.deepEqual([s.wait, s.answers, s.repo, s.env, s.cmd], [{ text: 'Now listening on' }, ['y', 'n'], 'api', { PORT: '8080' }, 'okteto up']);
  assert.deepEqual(parseStep('wait:port:8080 okteto up')!.wait, { port: 8080 });
  assert.equal(waitLabel(parseStep('wait:port:8080 okteto up')!), 'port 8080');
  assert.equal(parseStep('echo wait:port:1 ps: x')!.cmd, 'echo wait:port:1 ps: x', 'only at the start');
});

test('a wait: step is ready only when its text shows, and its URL isn’t the app’s', async () => {
  const cwd = repo('wait', {
    'api.js': "console.log('Building...'); console.log('Listening at http://localhost:1'); setTimeout(()=>console.log('Now listening on: http://[::]:5999'), 600); setInterval(()=>{}, 1000)",
    'app.js': "const s=require('http').createServer((q,r)=>r.end('ok')).listen(0,()=>console.log('Local: http://localhost:'+s.address().port+'/'))",
  });
  const runs = new RunService(() => {}, process.env);
  try {
    await runs.start('w1', { repo: cwd, source: '', steps: ['wait:"now listening on" node api.js', 'node app.js'] }, cwd);
    await until(() => runs.get('w1')!.steps[0].tail.includes('Building...'));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(runs.get('w1')!.steps[0].state, 'go', 'a URL alone doesn’t make it ready');
    await until(() => runs.get('w1')?.state === 'up');
    assert.deepEqual(runs.get('w1')!.steps.map((s) => s.state), ['up', 'up']);
    assert.doesNotMatch(runs.get('w1')!.url!, /:5999|:1$/, 'the app is the last step');
  } finally {
    runs.stopAll();
  }
});

test('step variables fill in %NAME% from the environment, any case, and leave unknown ones', () => {
  assert.deepEqual(expandVars({ KUBECONFIG: '%USERPROFILE%/.kube/dev.yaml', X: '%NOPE%', Y: 'plain' }, { UserProfile: 'C:/Users/me' }),
    { KUBECONFIG: 'C:/Users/me/.kube/dev.yaml', X: '%NOPE%', Y: 'plain' });
});
