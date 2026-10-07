// A card's worktree and its packages (PLAN §110), on an isolated server (PORT, default 7807): a demo
// UI repo whose start line is node_modules\.bin\standin-ui.cmd (as an nx UI's is), its main
// checkout installed once.
// 1. A real card started in worktrees (Haiku, one short reply): its worktree gets a junction to the
//    main checkout's node_modules at once, and the card says so.
// 2. A card on a worktree with no packages (seeded): Try it's run gets a packages step first (it
//    links them), then the UI comes up and serves.
// 3. Removing the cards' worktrees (Shift+X's message) leaves the main checkout's node_modules whole.
// Needs npm on PATH; nothing goes over the network (the package is a local folder).
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const PORT = process.env.PORT || '7807';
const TMP = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/');
const OUT = path.join(__dirname, 'shots-deps');
fs.mkdirSync(OUT, { recursive: true });
const REPO = `${TMP}/cc-demo/deps-ui`;
const UI_PORT = 18990, UI_PORT_2 = 18991;
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(300); } return false; };
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const serves = (port) => new Promise((r) => { http.get(`http://127.0.0.1:${port}/`, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => r(b)); }).on('error', () => r('')); });

/** The demo repo: a package.json naming a local package with a bin, its lockfile, committed; no node_modules anywhere. */
function makeRepo() {
  if (fs.existsSync(REPO)) {
    for (const wt of git(REPO, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)).slice(1)) git(REPO, 'worktree', 'remove', '--force', wt);
    fs.rmSync(REPO, { recursive: true, force: true });
  }
  fs.mkdirSync(`${REPO}/tools/standin-ui`, { recursive: true });
  fs.writeFileSync(`${REPO}/tools/standin-ui/package.json`, JSON.stringify({ name: 'standin-ui', version: '1.0.0', bin: { 'standin-ui': 'serve.js' } }, null, 2));
  fs.writeFileSync(`${REPO}/tools/standin-ui/serve.js`, "#!/usr/bin/env node\nconst port = Number(process.argv[2]);\nrequire('node:http').createServer((q, s) => s.end('<h1>deps-ui</h1>')).listen(port, () => console.log(`Local: http://localhost:${port}/`));\n");
  fs.writeFileSync(`${REPO}/package.json`, JSON.stringify({ name: 'deps-ui', version: '1.0.0', private: true, devDependencies: { 'standin-ui': 'file:./tools/standin-ui' } }, null, 2));
  fs.writeFileSync(`${REPO}/.gitignore`, 'node_modules/\n');
  // Files as written: npm rewrites a local package's bin script with LF endings, which git would show as a change had it checked it out with CRLF.
  fs.writeFileSync(`${REPO}/.gitattributes`, '* -text\n');
  execFileSync('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund'], { cwd: REPO, shell: true, stdio: 'ignore' });
  git(REPO, 'init', '-q', '-b', 'main');
  git(REPO, 'config', 'user.email', 'walk@example.invalid');
  git(REPO, 'config', 'user.name', 'walk');
  git(REPO, 'add', '.');
  git(REPO, 'commit', '-q', '-m', 'deps-ui');
  // The main checkout, installed once: what the worktrees link to.
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: REPO, shell: true, stdio: 'ignore' });
}

async function ask(page, msg, ms = 10000) {
  return page.evaluate(({ msg, ms }) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    const reqId = `w-${Math.random().toString(36).slice(2)}`;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.reqId !== reqId) return; ws.close(); if (m.type === 'error') reject(new Error(m.message)); else resolve(m); };
    ws.onopen = () => ws.send(JSON.stringify({ ...msg, reqId }));
    setTimeout(() => { ws.close(); reject(new Error('no answer')); }, ms);
  }), { msg, ms });
}
const latest = (page, type) => page.evaluate((type) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === type) { ws.close(); resolve(m); } };
  setTimeout(() => { ws.close(); resolve(null); }, 3000);
}), type);
const cardOf = async (page, id) => (await latest(page, 'cards'))?.cards.find((c) => c.id === id);
const runOf = async (page, id) => (await latest(page, 'runs'))?.runs.find((r) => r.cardId === id);

(async () => {
  makeRepo();
  const MAIN_BIN = `${REPO}/node_modules/.bin/standin-ui.cmd`;
  check('the main checkout is installed once', fs.existsSync(MAIN_BIN));
  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate(() => localStorage.setItem('cc-control.welcomed.v2', '1'));
  await page.evaluate((REPO) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify({ type: 'workspace.save', workspace: { id: 'ws-demo-deps', name: 'Deps', color: 'green', repos: [REPO], notes: '' } })); setTimeout(() => { ws.close(); resolve(); }, 400); }; }), REPO);
  await ask(page, { type: 'recipe.save', repo: REPO, steps: [`wait:port:${UI_PORT} node_modules\\.bin\\standin-ui.cmd ${UI_PORT}`], url: `http://localhost:${UI_PORT}` });

  // 1. A real card in worktrees: the packages are installed in the background as it starts.
  const item = { kind: 'repo', id: REPO, label: 'deps-ui', on: true };
  const started = await ask(page, { type: 'card.start', draft: { title: 'Deps walk', workspaceId: 'ws-demo-deps', packet: { workspace: [item], ticket: [], card: [], note: '' }, launch: { home: REPO, branch: 'worktree', mode: 'default', model: 'haiku', message: 'Reply with the single word ok. Use no tools.' } } }, 60000);
  const id = started.card?.id ?? started.id;
  const card = await cardOf(page, id);
  const wt = card?.folders?.[0]?.dir;
  check('the card starts in a worktree of the demo repo', Boolean(wt) && fs.existsSync(wt), wt);
  check('the card says it linked the main checkout’s node_modules', (card?.boot ?? []).some((b) => /deps-ui-card-\d+: Linked node_modules from the main checkout/.test(b.text) && b.state === 'ok'), (card?.boot ?? []).map((b) => b.text).join(' | '));
  check('the worktree’s node_modules is a link to the main checkout’s', fs.lstatSync(`${wt}/node_modules`).isSymbolicLink() && fs.existsSync(`${wt}/node_modules/.bin/standin-ui.cmd`));
  check('nothing for git to show in the worktree', git(wt, 'status', '--porcelain') === '', git(wt, 'status', '--porcelain'));
  await page.reload();
  await sleep(800);
  await page.locator(`#card-${id}`).click();
  await sleep(500);
  await page.keyboard.press('Shift+C');
  await sleep(500);
  await shot(page, 'card-installed');
  await page.keyboard.press('Escape');

  // 2. A worktree with no packages, on a card (seeded): Try it installs them first, then the UI serves.
  const wt2 = `${TMP}/cc-demo/deps-ui-bare`;
  git(REPO, 'worktree', 'add', '-q', wt2, '-b', 'deps-bare');
  const seeded = await ask(page, { type: 'cards.seed', options: { repos: [REPO], worktrees: [wt2], workspaceId: 'ws-demo-deps', key: 'DEPS-2', state: 'idle', title: 'Bare worktree' } });
  await ask(page, { type: 'recipe.save', repo: REPO, steps: [`wait:port:${UI_PORT_2} node_modules\\.bin\\standin-ui.cmd ${UI_PORT_2}`], url: `http://localhost:${UI_PORT_2}` });
  await ask(page, { type: 'card.try', id: seeded.id }, 30000);
  const up = await until(async () => (await runOf(page, seeded.id))?.state === 'up', 120000);
  const run = await runOf(page, seeded.id);
  check('Try it’s run has a packages step first, then the UI', run?.steps?.length === 2 && /link-deps\.ts/.test(run.steps[0].cmd) && /standin-ui/.test(run.steps[1].cmd), (run?.steps ?? []).map((s) => `${s.state}: ${s.cmd}`).join(' | '));
  check('the UI comes up and serves', up && /deps-ui/.test(await serves(UI_PORT_2)), run?.state);
  check('the packages step said what it did', (run?.steps?.[0]?.tail ?? []).some((l) => /Linked node_modules from the main checkout/.test(l)), (run?.steps?.[0]?.tail ?? []).slice(-3).join(' | '));
  await page.reload();
  await sleep(800);
  await page.locator(`#card-${seeded.id}`).click();
  await sleep(500);
  await page.keyboard.press('Shift+T');
  await sleep(700);
  await shot(page, 'try-it-run');
  await page.keyboard.press('Escape');

  // A second Try it on the same worktree: the packages are there, so no packages step.
  page.keyboard.press('Escape');
  await ask(page, { type: 'card.stopRun', id: seeded.id }).catch(() => {});
  await until(async () => (await runOf(page, seeded.id))?.state !== 'up');
  await ask(page, { type: 'card.try', id: seeded.id }, 30000);
  await until(async () => (await runOf(page, seeded.id))?.state === 'up', 30000);
  const again = await runOf(page, seeded.id);
  check('Try it again: no packages step (they are there)', again?.steps?.length === 1, (again?.steps ?? []).map((s) => s.cmd).join(' | '));
  page.evaluate((id) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => ws.send(JSON.stringify({ type: 'card.stopRun', id })); }, seeded.id);
  await sleep(1500);

  // 3. Remove the cards' worktrees: the main checkout is as it was.
  for (const cid of [id, seeded.id]) await ask(page, { type: 'card.removeWorktrees', id: cid, force: true, thenDelete: true }, 120000).catch((e) => console.log('remove:', e.message));
  check('the worktrees are gone', await until(async () => !fs.existsSync(wt) && !fs.existsSync(wt2), 30000), `${fs.existsSync(wt)} ${fs.existsSync(wt2)}`);
  check('the main checkout is as it was, its node_modules whole', git(REPO, 'status', '--porcelain') === '' && fs.existsSync(MAIN_BIN) && fs.existsSync(`${REPO}/node_modules/standin-ui/package.json`));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
