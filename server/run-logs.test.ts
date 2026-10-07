import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { logsText } from '../shared/cards.ts';
import { RunService } from './recipes.ts';
import { cardLogsDir, LOG_FILE_MAX, logName, RunLogFile } from './run-logs.ts';

const dir = mkdtempSync(join(tmpdir(), 'cc-runlogs-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const until = async (ok: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('§117: a card’s logs folder and file names', () => {
  assert.equal(cardLogsDir('C:\\runs', 'SHOP-155'), join('C:\\runs', 'logs', 'SHOP-155'));
  assert.equal(cardLogsDir('C:\\runs', 'a/b c'), join('C:\\runs', 'logs', 'a_b_c'));
  assert.deepEqual([logName(), logName('ui'), logName('orders-api'), logName('a/b')], ['app', 'ui', 'orders-api', 'a_b']);
  assert.match(logsText('C:\\runs\\logs\\SHOP-155'), /## Try it logs\n.*C:\\runs\\logs\\SHOP-155: <service>\.log.*\.prev\.log/s);
});

test('§117: a run’s log file: the last run kept as .prev, lines timed and numbered, a full one rolled over', async () => {
  const d = join(dir, 'f');
  const a = new RunLogFile(d, 'orders-api', 'cc-control Try it · orders-api');
  a.line(Date.now(), 0, '$ okteto up');
  a.line(Date.now(), 0, 'Now listening on: http://[::]:18000');
  a.flush();
  await until(() => /Now listening/.test(readFileSync(a.path, 'utf8')));
  const text = readFileSync(a.path, 'utf8');
  assert.match(text, /^# cc-control Try it · orders-api · started \d{4}-/);
  assert.match(text, /\n\d\d:\d\d:\d\d\.\d{3} \[1\] \$ okteto up\n/);
  const b = new RunLogFile(d, 'orders-api', 'again');
  assert.match(readFileSync(join(d, 'orders-api.prev.log'), 'utf8'), /Now listening/, 'the run before is kept');
  assert.doesNotMatch(readFileSync(b.path, 'utf8'), /Now listening/, 'this run starts afresh');
  // Past the cap: the full file becomes .prev and the run carries on in a new one.
  writeFileSync(b.path, 'x'.repeat(10));
  b.line(Date.now(), 1, 'y'.repeat(LOG_FILE_MAX + 10));
  b.flush();
  await until(() => readFileSync(b.path, 'utf8').length > LOG_FILE_MAX);
  assert.match(readFileSync(b.path, 'utf8'), /^# continued/);
});

test('§117: a card’s run writes its output to the card’s logs folder; a run that isn’t a card’s writes none', async () => {
  const cwd = mkdtempSync(join(dir, 'app-'));
  writeFileSync(join(cwd, 'app.js'), "const s=require('http').createServer((q,r)=>r.end('ok')).listen(0,()=>{console.log('Local: http://localhost:'+s.address().port+'/');console.log('GET /health 200')})");
  const logs = join(dir, 'logs-card');
  const runs = new RunService(() => {}, process.env, { logDir: (id) => (id === 'card-1' ? logs : undefined) });
  try {
    await runs.start('card-1#ui', { repo: cwd, source: '', steps: ['node app.js'] }, cwd, { cardId: 'card-1', service: 'ui' });
    await runs.start('other', { repo: cwd, source: '', steps: ['node app.js'] }, cwd);
    await until(() => runs.get('card-1#ui')?.state === 'up');
    // Both lines read from the app before it is stopped (under load the second can come a moment later).
    await until(() => runs.log('card-1#ui').some((l) => l.text.includes('GET /health 200')));
    await runs.stop('card-1#ui');
    await until(() => existsSync(join(logs, 'ui.log')) && /\(stopped\)/.test(readFileSync(join(logs, 'ui.log'), 'utf8')));
    assert.match(readFileSync(join(logs, 'ui.log'), 'utf8'), /GET \/health 200/);
    const text = readFileSync(join(logs, 'ui.log'), 'utf8');
    assert.match(text, /\[1\] \$ node app\.js/);
    assert.match(text, /\[1\] Local: http:\/\/localhost:\d+\//);
    assert.match(text, /\(stopped\)/, 'how it ended is there too');
  } finally {
    runs.stopAll();
  }
});
