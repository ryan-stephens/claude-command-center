import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { findUrl, parseSteps, portOf, recipeText } from '../shared/recipes.ts';
import { appLike, detectRecipe, recipeOf, RunService, saveRecipe, urlFromScript } from './recipes.ts';
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
