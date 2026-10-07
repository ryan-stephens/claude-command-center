// Two cards on the same API and UI at once (PLAN §114). This walk starts its own isolated server (PORT,
// default 7809, a fresh DB) with stand-ins first on its PATH:
// - okteto: holds every forward and the remote: SSH port, failing as okteto does on a port in use;
// - nx: serves on its project's 4216 unless given --port, and asks when that is taken.
// It makes a demo API repo and a demo UI repo, each with a worktree per card. The API's steps run a
// helper that writes okteto.yml with remote: 22000 and a 5005 debugger forward, then okteto up. The
// UI's step is `nx serve app --proxyConfig={{proxy}}` with ui.url http://localhost:4216, as a stack
// saved before §114 has it. Card A is started, then card B, from the Try it panel with t.
// Run: pnpm exec vite build --outDir ../dist/web-test first. DARK=1 for dark mode.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const PORT = process.env.PORT || '7809';
const dark = process.env.DARK === '1';
const REPO = path.resolve(__dirname, '..', '..', '..').replace(/\\/g, '/');
const OUT = path.join(__dirname, dark ? 'shots-two-cards-dark' : 'shots-two-cards');
fs.mkdirSync(OUT, { recursive: true });
const TMP = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/');
const DEMO = `${TMP}/cc-demo`;
const STANDINS = path.join(__dirname, 'standins').replace(/\\/g, '/');
const BIN = `${DEMO}/two-bin`;
const API = `${DEMO}/two-api`, UI = `${DEMO}/two-ui`;
const DB = `${TMP}/cc-test-two-cards.db`;
const LOG = path.join(OUT, 'server.log');
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(300); } return false; };
const get = (port) => new Promise((r) => { http.get(`http://127.0.0.1:${port}/`, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => r(b)); }).on('error', () => r('')); });
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function removeRepo(dir) {
  if (!fs.existsSync(dir)) return;
  try { for (const wt of git(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)).slice(1)) git(dir, 'worktree', 'remove', '--force', wt); } catch { /* not a repo */ }
  fs.rmSync(dir, { recursive: true, force: true });
}
function makeRepo(dir, files) {
  removeRepo(dir);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), t);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'walk@example.invalid');
  git(dir, 'config', 'user.name', 'walk');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  for (const c of ['a', 'b']) git(dir, 'worktree', 'add', '-q', `${dir}-${c}`, '-b', `card-${c}`);
}

let server;
function startServer() {
  fs.mkdirSync(BIN, { recursive: true });
  fs.writeFileSync(`${BIN}/okteto.cmd`, `@node "${STANDINS}/okteto-up.cjs" %*\r\n`);
  fs.writeFileSync(`${BIN}/nx.cmd`, `@node "${STANDINS}/nx-serve.cjs" %*\r\n`);
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const env = { ...process.env, [pathKey]: `${BIN.replace(/\//g, '\\')};${process.env[pathKey]}`, CC_CONTROL_PORT: PORT, CC_CONTROL_DB: DB, CC_CONTROL_MODEL: 'claude-haiku-4-5-20251001', CC_CONTROL_WEB_DIST: `${REPO}/dist/web-test` };
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, LOG]) fs.rmSync(f, { force: true });
  const out = fs.openSync(LOG, 'a');
  server = spawn(process.execPath, ['server/index.ts'], { cwd: REPO, env, stdio: ['ignore', out, out], windowsHide: true });
}
function stopServer() { if (server) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true }); }

async function ask(page, msg, ms = 10000) {
  return page.evaluate(({ msg, ms }) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    const reqId = `w-${Math.random().toString(36).slice(2)}`;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.reqId !== reqId) return; ws.close(); if (m.type === 'error') reject(new Error(m.message)); else resolve(m); };
    ws.onopen = () => ws.send(JSON.stringify({ ...msg, reqId }));
    setTimeout(() => { ws.close(); reject(new Error('no answer')); }, ms);
  }), { msg, ms });
}
const fire = (page, msg) => page.evaluate((msg) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => ws.send(JSON.stringify(msg)); }, msg);
async function runsOf(page, id) {
  return page.evaluate((id) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'runs') { ws.close(); resolve(m.runs.filter((r) => r.cardId === id)); } };
    setTimeout(() => { ws.close(); resolve([]); }, 2000);
  }), id);
}
const tails = (rs) => rs.map((r) => `${r.service}:${r.state} ${r.steps.map((s) => (s.tail ?? []).slice(-2).join(' / ')).join(' | ')}`).join(' || ');

(async () => {
  makeRepo(API, { 'README.md': 'demo api\n' });
  makeRepo(UI, { 'proxy.conf.json': '{\n  "/assets/**": { "target": "http://localhost:9999" }\n}\n' });
  startServer();
  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, colorScheme: dark ? 'dark' : 'light' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  check('the isolated server comes up', await until(async () => { await page.goto(`http://127.0.0.1:${PORT}/`); return true; }, 20000));
  await page.evaluate((dark) => { localStorage.setItem('cc-control.welcomed.v2', '1'); localStorage.removeItem('cc-control.stackPick'); if (dark) localStorage.setItem('cc-control.theme', 'dark'); }, dark);
  await page.evaluate((w) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify({ type: 'workspace.save', workspace: w })); setTimeout(() => { ws.close(); resolve(); }, 400); }; }),
    { id: 'ws-demo-two', name: 'Two cards', color: 'blue', repos: [API, UI], notes: '' });
  await ask(page, { type: 'stack.save', workspaceId: 'ws-demo-two', stack: {
    choose: { env: ['dev'] },
    api: { steps: [`node ${STANDINS}/okteto-helper.cjs`, 'wait:"Now listening on" okteto up', 'stop: okteto down'], proxy: { '/api/{{route}}/**': { target: 'http://localhost:{{port}}' } } },
    apis: [{ repo: 'two-api', values: { name: 'two-api', appPort: '8080', route: 'orders' } }],
    ui: { repo: 'two-ui', proxyFile: 'proxy.conf.json', steps: ['nx serve app --proxyConfig={{proxy}}'], url: 'http://localhost:4216' },
  } });
  const cards = {};
  for (const c of ['a', 'b']) cards[c] = await ask(page, { type: 'cards.seed', options: { repos: [API, UI], worktrees: [`${API}-${c}`, `${UI}-${c}`], workspaceId: 'ws-demo-two', key: `TWO-${c.toUpperCase()}`, state: 'idle', title: `Card ${c.toUpperCase()}` } });
  await page.evaluate((ids) => localStorage.setItem('cc-control.stackPick', JSON.stringify(Object.fromEntries(ids.map((id) => [id, { values: { env: 'dev' }, apis: ['two-api'] }])))), [cards.a.id, cards.b.id]);
  await page.reload();
  await sleep(1000);

  const up = async (id) => { const r = await runsOf(page, id); return r.length === 2 && r.every((x) => x.state === 'up'); };
  const start = async (c) => {
    await page.locator(`#card-${cards[c].id}`).click();
    await sleep(500);
    await page.keyboard.press('Shift+T');
    await sleep(600);
    await page.keyboard.press('t');
  };

  // Card A, then card B while A runs: both come up.
  await start('a');
  check('card A: its API and UI come up', await until(() => up(cards.a.id), 30000), tails(await runsOf(page, cards.a.id)));
  await page.keyboard.press('Escape');
  await sleep(400);
  await start('b');
  check('card B, while A runs: its API and UI come up too', await until(() => up(cards.b.id), 30000), tails(await runsOf(page, cards.b.id)));
  await sleep(500);
  await shot(page, 'card-b-up');
  const ra = await runsOf(page, cards.a.id), rb = await runsOf(page, cards.b.id);
  const ui = (rs) => rs.find((r) => r.service === 'ui');
  const portOf = (u) => Number(/:(\d+)/.exec(u ?? '')?.[1]);
  const uiA = portOf(ui(ra)?.url), uiB = portOf(ui(rb)?.url);
  check('each UI on a port of its own, not the project’s 4216', uiA && uiB && uiA !== uiB && uiA !== 4216 && uiB !== 4216, `${uiA} ${uiB}`);
  check('each UI’s step was given --port', [ra, rb].every((rs) => / --port \d+/.test(ui(rs)?.steps?.[0]?.cmd ?? '')), ui(rb)?.steps?.[0]?.cmd);
  const copy = (c) => fs.readFileSync(`${API}-${c}/okteto.cc-control.yml`, 'utf8');
  const fwd = (t) => [...t.matchAll(/-\s*(\d+):(\d+)/g)].map((m) => `${m[1]}:${m[2]}`);
  check('each card’s manifest copy: no fixed SSH port', !/remote:/.test(copy('a')) && !/remote:/.test(copy('b')));
  check('each card’s API and debugger on ports of their own', new Set([...fwd(copy('a')), ...fwd(copy('b'))].map((f) => f.split(':')[0])).size === 4 && !/\b5005:5005|8080:8080/.test(copy('a') + copy('b')), `${fwd(copy('a')).join(' ')} | ${fwd(copy('b')).join(' ')}`);
  const apiPort = (c) => Number(fwd(copy(c))[0].split(':')[0]);
  check('card A’s API answers as card A’s, card B’s as B’s, at once', (await get(apiPort('a'))) === 'api two-api-a' && (await get(apiPort('b'))) === 'api two-api-b');
  check('card A’s UI proxies to card A’s API, B’s to B’s', (await get(uiA)).includes(`localhost:${apiPort('a')}`) && (await get(uiB)).includes(`localhost:${apiPort('b')}`));
  const logA = await page.evaluate((key) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'run.follow', keys: [key] }));
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'run.log' && m.key === key) { ws.close(); resolve(m.lines.map((l) => l.text)); } };
    setTimeout(() => { ws.close(); resolve([]); }, 3000);
  }), `${cards.a.id}#two-api`);
  check('…in its output: 5005 → its own port, and okteto picks the SSH port', logA.some((l) => /other forwards: 5005 → \d+; okteto picks its own SSH port/.test(l)), logA.filter((l) => /forwards|SSH/.test(l)).join(' | '));
  check('the Try it panel shows card B’s UI on its own port', (await page.getByText(new RegExp(`UI.*:${uiB}|:${uiB}`)).count()) > 0);

  // Stop both: their ports are free again.
  const apiA = apiPort('a');
  for (const c of ['a', 'b']) await fire(page, { type: 'card.stopRun', id: cards[c].id });
  check('both stop', await until(async () => (await runsOf(page, cards.a.id)).concat(await runsOf(page, cards.b.id)).every((r) => r.state !== 'up' && r.state !== 'running')));
  await sleep(800);
  check('their APIs and UIs no longer answer', !(await get(apiA)) && !(await get(uiB)));
  check('the manifest copies go with the runs', !fs.existsSync(`${API}-a/okteto.cc-control.yml`) && !fs.existsSync(`${API}-b/okteto.cc-control.yml`));
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  stopServer();
  await sleep(500);
  removeRepo(API); removeRepo(UI); fs.rmSync(BIN, { recursive: true, force: true });
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); stopServer(); process.exit(1); });
