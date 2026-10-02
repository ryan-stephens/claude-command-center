import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runFormFrom, runFromForm, runFromSteps, stepsFromRun } from './run-setup.ts';

test('the four answers write the lines, and the lines read back as the same answers (§86)', () => {
  const steps = stepsFromRun({ install: 'pnpm install', start: 'pnpm dev', stop: 'docker compose down' });
  assert.deepEqual(steps, ['pnpm install', 'pnpm dev', 'stop: docker compose down']);
  assert.deepEqual(runFromSteps(steps), { install: 'pnpm install', start: 'pnpm dev', stop: 'docker compose down' });
  assert.deepEqual(runFromSteps(['pnpm dev']), { install: '', start: 'pnpm dev', stop: '' });
  assert.deepEqual(stepsFromRun({ install: ' ', start: 'pnpm dev', stop: '' }), ['pnpm dev']);
});

test('lines the answers can’t say are custom', () => {
  assert.equal(runFromSteps(['pnpm i', 'pnpm build', 'pnpm dev']), undefined, 'three commands');
  assert.equal(runFromSteps(['@api okteto up']), undefined, 'a repo prefix');
  assert.equal(runFromSteps(['wait:port:8080 node app.js']), undefined, 'a wait');
  assert.equal(runFromSteps(['PORT=3000 node app.js']), undefined, 'a variable');
  assert.equal(runFromSteps(['! sign in first', 'pnpm dev']), undefined, 'a by-hand note');
  assert.equal(runFromSteps(['stop: x', 'pnpm dev']), undefined, 'a stop line before the app');
  assert.equal(runFromSteps(['stop: x']), undefined, 'nothing starts the app');
  assert.equal(runFromSteps([]), undefined);
});

test('the form from a repo’s lines, and what it saves', () => {
  const f = runFormFrom({ repo: 'D:\\r\\web', steps: ['pnpm install', 'pnpm dev'], url: 'http://localhost:5173', source: 'detected from package.json' });
  assert.deepEqual([f.install, f.start, f.url, f.stop, f.custom], ['pnpm install', 'pnpm dev', 'http://localhost:5173', '', false]);
  assert.deepEqual(runFromForm(f), { steps: ['pnpm install', 'pnpm dev'], url: 'http://localhost:5173' });
  const c = runFormFrom({ repo: 'D:\\r\\api', steps: ['wait:http:8080/self PORT=8080 dotnet run', 'stop: docker compose down'], source: 'written by you' });
  assert.equal(c.custom, true);
  assert.equal(c.start, '', 'custom lines are kept as lines, not guessed into answers');
  assert.deepEqual(runFromForm(c).steps, ['wait:http:8080/self PORT=8080 dotnet run', 'stop: docker compose down']);
  assert.deepEqual(runFormFrom(undefined), { install: '', start: '', url: '', stop: '', steps: [], custom: false });
  assert.throws(() => runFromForm({ ...f, start: '', install: '' }), /what starts the app/);
  assert.throws(() => runFromForm({ ...f, url: 'localhost' }), /http:\/\/localhost:5173/);
  assert.throws(() => runFromForm({ ...c, steps: ['stop: only'] }), /what starts the app/);
});
