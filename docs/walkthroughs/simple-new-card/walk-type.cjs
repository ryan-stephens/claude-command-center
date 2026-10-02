// The way in when channels aren't allowed (PLAN §87), on the isolated server at :7802: a card is
// seeded with a token and no channel; the real launcher (hooks/cc-control-launch.ps1) is started
// in a Windows Terminal tab the way the server starts it, with a stand-in for claude that writes
// every key it receives to a file. The launcher polls the server, the card says it can be typed
// into, the page's message box sends, y and n press keys, and the file shows what arrived. A
// terminal tab opens on screen for a minute. Run walk-simple.cjs first (the Demo lane).
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const PORT = process.env.PORT || '7802';
const OUT = path.join(__dirname, 'shots-type');
fs.mkdirSync(OUT, { recursive: true });
const DEMO = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/') + '/cc-demo';
const STANDINS = path.join(__dirname, 'standins');
const LAUNCHER = path.resolve(__dirname, '../../../hooks/cc-control-launch.ps1');
const KEYS_FILE = path.join(os.tmpdir(), 'cc-walk-type-keys.txt');
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; };
const keysSoFar = () => { try { return fs.readFileSync(KEYS_FILE, 'utf8'); } catch { return ''; } };
const shown = (s) => JSON.stringify(s);

async function ask(page, msg, timeout = 5000) {
  return page.evaluate(({ msg, timeout }) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    const reqId = `w-${Math.random().toString(36).slice(2)}`;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.reqId !== reqId) return; ws.close(); if (m.type === 'error') reject(new Error(m.message)); else resolve(m); };
    ws.onopen = () => ws.send(JSON.stringify({ ...msg, reqId }));
    setTimeout(() => { ws.close(); reject(new Error('no answer')); }, timeout);
  }), { msg, timeout });
}
const cardNow = (page, id) => page.evaluate((id) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'cards') { ws.close(); resolve(m.cards.find((c) => c.id === id) ?? null); } };
  setTimeout(() => { ws.close(); resolve(null); }, 2000);
}), id);

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate(() => { localStorage.setItem('cc-control.welcomed.v2', '1'); });
  const token = 'walk-type-token-1234';
  const seeded = await ask(page, { type: 'cards.seed', options: { repos: [`${DEMO}/web-app`], workspaceId: 'ws-demo-simple', key: 'KEY-9', state: 'idle', title: 'Typed into its tab', channel: false, token } });
  check('a card is seeded with a token and no channel', Boolean(seeded.id));

  // The launcher, as the server starts it: a tab titled with the key, the card's variables in its environment, a stand-in for claude.
  const payload = Buffer.from(JSON.stringify([process.execPath, path.join(STANDINS, 'tab.cjs'), KEYS_FILE]), 'utf8').toString('base64');
  const env = { ...process.env, CC_CONTROL_CARD: seeded.id, CC_CONTROL_TOKEN: token, CC_CONTROL_URL: `http://127.0.0.1:${PORT}` };
  for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_)/.test(k)) delete env[k];
  const wt = spawn('wt.exe', ['-w', '0', 'nt', '--title', 'KEY-9', '--suppressApplicationTitle', '-d', `${DEMO}/web-app`, 'powershell.exe', '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', LAUNCHER, payload], { env, stdio: 'ignore', detached: true, windowsHide: true });
  wt.unref();
  const alive = await until(async () => (await cardNow(page, seeded.id))?.keys === true, 30000);
  check('the launcher polls and the card says its tab can be typed into', alive);

  await page.reload();
  await sleep(900);
  await page.locator(`#card-${seeded.id}`).click();
  await sleep(700);
  const view = page.locator('section[aria-label^="KEY-9"]').first();
  check('the card opens with Send (not Resume) and the typed-into-its-tab note', await view.getByRole('button', { name: /Send$/ }).isVisible() && /Typed into its tab/.test(await view.getByRole('note').innerText()));
  await shot(page, 'reachable');
  // The message box: Enter focuses it, typing fills it, Enter sends; the stand-in receives the characters and Enter.
  await page.keyboard.press('Enter');
  await sleep(200);
  const focused = await page.evaluate(() => document.activeElement?.id ?? '');
  check('Enter puts the cursor in the message box', focused === 'card-say', focused);
  if (focused !== 'card-say') await view.locator('#card-say').click();
  await page.keyboard.type('hello from the page');
  await page.keyboard.press('Enter');
  const landed = await until(() => /hello from the page\r/.test(keysSoFar()), 15000);
  check('what was typed in the message box arrives in the tab, with Enter', landed, shown(keysSoFar().slice(-60)));
  // Two lines: a backslash then Enter between them, the way the prompt takes a new line.
  await ask(page, { type: 'card.send', id: seeded.id, text: 'line one\nline two' }, 30000);
  const twoLines = await until(() => /line one\\\rline two\r/.test(keysSoFar()), 15000);
  check('a new line is typed as backslash + Enter', twoLines, shown(keysSoFar().slice(-60)));
  // y / n with no channel: the prompt's keys (1, Escape).
  await ask(page, { type: 'card.answer', id: seeded.id, behavior: 'allow' }, 30000);
  await ask(page, { type: 'card.answer', id: seeded.id, behavior: 'deny' }, 30000);
  const keysPressed = await until(() => /1\x1b$/.test(keysSoFar()), 15000);
  check('allow types 1, deny presses Escape', keysPressed, shown(keysSoFar().slice(-20)));
  // g finds the tab by its title: no second tab is opened on the session.
  const focus = await ask(page, { type: 'card.focusTab', id: seeded.id }, 25000);
  check('g finds the tab (nothing reopened)', focus.type === 'ok' && focus.note !== 'reopened', JSON.stringify(focus));
  await shot(page, 'after-typing');
  // Done: the stand-in exits on bye, and the launcher with it.
  await ask(page, { type: 'card.send', id: seeded.id, text: 'bye' }, 30000);
  await sleep(1500);
  check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await page.evaluate((id) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify({ type: 'card.delete', id })); setTimeout(() => { ws.close(); resolve(); }, 300); }; }), seeded.id);
  await browser.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
