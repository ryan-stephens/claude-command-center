import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import type { ChildProcess } from 'node:child_process';
import { BuilderLauncher, launchEnv, TAIL_LINES } from './verify-launch.ts';
import type { BuilderProc, VerifyConfig } from '../shared/verify.ts';

// A made-up test-data tool: nothing here is a real command or folder.
const CFG: VerifyConfig = { builder: { name: 'Sample data', url: 'http://localhost:5100', launch: ['run the api', 'run the ui'], cwd: tmpdir() } };

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: string | null = null;
  readonly cmd: string;
  readonly cwd: string;
  constructor(cmd: string, cwd: string) { super(); this.cmd = cmd; this.cwd = cwd; }
  end(code: number) { this.exitCode = code; this.emit('exit', code); }
}

function setup(cfg: VerifyConfig = CFG, opts: { up?: boolean } = {}) {
  let up = opts.up ?? false;
  let now = 1_000;
  const children: FakeChild[] = [];
  const killed: string[] = [];
  const heard: BuilderProc[] = [];
  const l = new BuilderLauncher({
    cfg: () => cfg,
    answers: async () => up,
    changed: (p) => heard.push(p),
    spawnCmd: (cmd, cwd) => { const c = new FakeChild(cmd, cwd); children.push(c); return c as unknown as ChildProcess; },
    kill: (c) => { const f = c as unknown as FakeChild; if (f.exitCode === null) { killed.push(f.cmd); f.exitCode = 1; } },
    now: () => now,
    probeMs: 5,
    waitMs: 60_000,
  });
  return { l, children, killed, heard, setUp: (v: boolean) => { up = v; }, tick: (ms: number) => { now += ms; } };
}
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test('Start runs each launch command in its folder, says starting, then up once the API answers', async () => {
  const t = setup();
  const p = await t.l.start();
  assert.equal(p.state, 'starting');
  assert.deepEqual(t.children.map((c) => [c.cmd, c.cwd]), [['run the api', tmpdir()], ['run the ui', tmpdir()]]);
  await wait();
  assert.equal(t.l.state().state, 'starting', 'not up until the API answers');
  t.setUp(true);
  await wait();
  assert.equal(t.l.state().state, 'up');
  assert.deepEqual(t.heard.map((h) => h.state), ['starting', 'up'], 'every page hears each change once');
  assert.equal(t.l.state().tail, undefined, 'its output isn’t sent while it is fine');
  assert.equal((await t.l.start()).state, 'up', 'a second Start while up starts nothing');
  assert.equal(t.children.length, 2);
});

test('A command that fails while starting: exited, its code and last lines; the others are stopped', async () => {
  const t = setup();
  await t.l.start();
  for (let i = 0; i < TAIL_LINES + 5; i++) t.children[0].stderr.emit('data', `\u001b[31mline ${i}\u001b[0m\r\n`);
  t.children[0].end(3);
  const p = t.l.state();
  assert.equal(p.state, 'exited');
  assert.equal(p.exitCode, 3);
  assert.equal(p.tail?.length, TAIL_LINES, 'only the last lines');
  assert.equal(p.tail?.at(-1), `line ${TAIL_LINES + 4}`, 'colour codes stripped');
  assert.deepEqual(t.killed, ['run the ui'], 'the other command is stopped');
  t.setUp(true);
  await wait();
  assert.equal(t.l.state().state, 'exited', 'a late probe of that start changes nothing');
});

test('A command that ends cleanly while starting (it handed off) keeps the wait going', async () => {
  const t = setup({ builder: { ...CFG.builder, launch: ['start it in the background'] } });
  await t.l.start();
  t.children[0].end(0);
  assert.equal(t.l.state().state, 'starting');
  t.setUp(true);
  await wait();
  assert.equal(t.l.state().state, 'up');
});

test('Not answering in time: slow, left running, its last lines shown; Stop stops it', async () => {
  const t = setup();
  await t.l.start();
  t.children[1].stdout.emit('data', 'building…\n');
  t.tick(61_000);
  await wait();
  const p = t.l.state();
  assert.equal(p.state, 'slow');
  assert.deepEqual(p.tail, ['building…']);
  assert.deepEqual(t.killed, [], 'left running');
  assert.equal(t.l.stop().state, 'off');
  assert.deepEqual(t.killed, ['run the api', 'run the ui']);
});

test('A tool stopping after it was up: exited, and the rest go too', async () => {
  const t = setup();
  await t.l.start();
  t.setUp(true);
  await wait();
  t.children[1].end(1);
  assert.equal(t.l.state().state, 'exited');
  assert.deepEqual(t.killed, ['run the api']);
});

test('Refused: no launch, no url, a missing folder, or already running (started by hand, never touched)', async () => {
  await assert.rejects(setup({ builder: { url: 'http://localhost:5100' } }).l.start(), /no "launch"/);
  await assert.rejects(setup({ builder: { launch: ['x'] } }).l.start(), /no "url"/);
  await assert.rejects(setup({ builder: { ...CFG.builder, cwd: `${tmpdir()}/no-such-folder-${process.pid}` } }).l.start(), /isn’t there/);
  const t = setup(CFG, { up: true });
  await assert.rejects(t.l.start(), /already running/);
  assert.equal(t.children.length, 0, 'nothing run');
  assert.throws(() => t.l.stop(), /wasn’t started here/, 'and Stop leaves it alone');
});

test('stopAll (the server going away) stops what was started; a late answer is ignored', async () => {
  const t = setup();
  await t.l.start();
  t.l.stopAll();
  assert.deepEqual(t.killed, ['run the api', 'run the ui']);
  t.setUp(true);
  await wait();
  assert.notEqual(t.l.state().state, 'up');
});

test('launchEnv: no Claude Code session markers and no secrets are handed on', () => {
  const env = launchEnv({ PATH: 'p', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CODE_ENTRYPOINT: 'e', CC_CONTROL_JIRA_TOKEN: 't', DOTNET_ENVIRONMENT: 'Development' });
  assert.equal(env.PATH, 'p');
  assert.equal(env.DOTNET_ENVIRONMENT, 'Development');
  assert.equal(env.CC_CONTROL_JIRA_TOKEN, undefined, 'a secret');
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT']) assert.equal(env[k], undefined, k);
});
