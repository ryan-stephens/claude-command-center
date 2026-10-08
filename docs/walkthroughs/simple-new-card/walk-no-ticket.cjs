// A card without a ticket (PLAN §131): it is a Claude session like any other. This walk starts its own
// isolated server (PORT, default 7829, a fresh DB, Haiku), opens the new-card screen (the simple look)
// in a Demo workspace of docs-site, and checks: with no ticket the opening message is empty and asks
// what Claude should do, and the session settings say the repo as it is and asking first; Ctrl+Enter
// with nothing typed says what is missing; a message alone starts the card, its first line the title,
// in the repo's own checkout (no worktree) and in Asks first; Claude answers it. Screenshots of the
// screen in light or dark. DARK=1 for dark mode.
// Run: pnpm exec vite build --outDir ../dist/web-test first.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const PORT = process.env.PORT || '7829';
const dark = process.env.DARK === '1';
const REPO = path.resolve(__dirname, '..', '..', '..').replace(/\\/g, '/');
const OUT = path.join(__dirname, dark ? 'shots-no-ticket-dark' : 'shots-no-ticket');
fs.mkdirSync(OUT, { recursive: true });
const TMP = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/');
const HOME_REPO = `${TMP}/cc-demo/docs-site`;
const DB = `${TMP}/cc-test-no-ticket.db`;
const LOG = path.join(OUT, 'server.log');
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, every = 250) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(every); } return false; };

let server;
function startServer() {
  const env = { ...process.env, CC_CONTROL_PORT: PORT, CC_CONTROL_DB: DB, CC_CONTROL_MODEL: 'claude-haiku-4-5-20251001', CC_CONTROL_WEB_DIST: `${REPO}/dist/web-test` };
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, LOG]) fs.rmSync(f, { force: true });
  const out = fs.openSync(LOG, 'a');
  server = spawn(process.execPath, ['server/index.ts'], { cwd: REPO, env, stdio: ['ignore', out, out], windowsHide: true });
}
function stopServer() { if (server) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true }); }
const fire = (page, msgs) => page.evaluate((msgs) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { for (const m of msgs) ws.send(JSON.stringify(m)); setTimeout(() => { ws.close(); resolve(); }, 600); }; }), msgs);
const cards = (page) => page.evaluate(() => new Promise((resolve) => {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'cards') { ws.close(); resolve(m.cards); } };
  setTimeout(() => { ws.close(); resolve([]); }, 3000);
}));

(async () => {
  startServer();
  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, colorScheme: dark ? 'dark' : 'light' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(m.text()); });
  let card;
  try {
    check('the isolated server comes up', await until(async () => { await page.goto(`http://127.0.0.1:${PORT}/`); return true; }, 20000));
    await page.evaluate((dark) => { localStorage.setItem('cc-control.welcomed.v2', '1'); if (dark) localStorage.setItem('cc-control.theme', 'dark'); }, dark);
    await fire(page, [{ type: 'workspace.save', workspace: { id: 'ws-demo-nt', name: 'Demo', color: 'teal', repos: [HOME_REPO] } }, { type: 'settings.set', settings: { newCardLook: 'simple' } }]);
    await page.reload(); await sleep(900);
    await page.keyboard.press('1'); await sleep(200);
    await page.keyboard.press('c');
    check('c opens the new-card screen', await until(() => page.locator('#cp-msg').isVisible(), 5000));
    const msg = page.locator('#cp-msg');
    check('no ticket: the opening message is empty and asks what Claude should do', (await msg.inputValue()) === '' && /What should Claude do\? Just say it/.test(await msg.getAttribute('placeholder')), JSON.stringify(await msg.inputValue()));
    const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    check('no ticket: it runs in the repo as it is and asks before edits', /Branch the current checkout/.test(await body()) && /Ask before edits/i.test(await body()), (await body()).match(/Branch.{0,80}/)?.[0]);
    await shot(page, 'new-card-no-ticket');

    await msg.focus();
    await page.keyboard.press('Control+Enter');
    check('Ctrl+Enter with nothing typed says what is missing', await until(async () => /Say what Claude should do/.test(await body()), 3000), '');

    await msg.fill('Reply with exactly the word pong and nothing else.\nThis is a quick test of a card with no ticket: change nothing.');
    await page.keyboard.press('Control+Enter');
    const started = await until(async () => { card = (await cards(page)).find((c) => c.key === 'CARD-1'); return Boolean(card?.sessionId); }, 30000);
    check('a message alone starts the card, its session linked', started, card?.sessionId);
    check('its first line is the card’s title', card?.title === 'Reply with exactly the word pong and nothing else.', card?.title);
    check('it runs in the repo’s own checkout, asking first: no worktree', card?.launch?.branch === 'current' && card?.launch?.mode === 'default' && !fs.existsSync(`${HOME_REPO}-card-1`), `${card?.launch?.branch}, ${card?.launch?.mode}`);
    // Claude's own reply (the message asked for pong too, so the chat's text alone proves nothing).
    const answered = await until(async () => { const c = (await cards(page)).find((x) => x.key === 'CARD-1'); return /pong/i.test(c?.live?.lastMessage ?? ''); }, 120000, 1000);
    check('Claude answers it', answered, (await cards(page)).find((x) => x.key === 'CARD-1')?.live?.lastMessage);
    await sleep(800);
    await shot(page, 'card-no-ticket');
    check('no errors on the page', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    check('the walk ran to the end', false, String(e).slice(0, 300));
  } finally {
    await browser.close();
    stopServer();
  }
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
