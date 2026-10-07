// Try it on a stack (PLAN §113) on an isolated server (PORT, default 7808): the UI heads the services as
// the one that always starts, with why, and Space on it says so; a dev server that compiles is up only
// when its build is done, not when it first prints its address (standins/ui-compile.cjs: it serves at
// once, fails to compile, then compiles). DARK=1 for dark mode.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const PORT = process.env.PORT || '7808';
const dark = process.env.DARK === '1';
const OUT = path.join(__dirname, dark ? 'shots-try-compile-dark' : 'shots-try-compile');
fs.mkdirSync(OUT, { recursive: true });
const DEMO = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/') + '/cc-demo';
const STANDINS = path.join(__dirname, 'standins').replace(/\\/g, '/');
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
const serves = (port) => new Promise((r) => { http.get(`http://127.0.0.1:${port}/`, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => r(b)); }).on('error', () => r('')); });

async function ask(page, msg) {
  return page.evaluate((msg) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    const reqId = `w-${Math.random().toString(36).slice(2)}`;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.reqId !== reqId) return; ws.close(); if (m.type === 'error') reject(new Error(m.message)); else resolve(m); };
    ws.onopen = () => ws.send(JSON.stringify({ ...msg, reqId }));
    setTimeout(() => { ws.close(); reject(new Error('no answer')); }, 5000);
  }), msg);
}
async function runsOf(page, id) {
  return page.evaluate((id) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'runs') { ws.close(); resolve(m.runs.filter((r) => r.cardId === id)); } };
    setTimeout(() => { ws.close(); resolve([]); }, 2000);
  }), id);
}
async function cardIds(page, wsId) {
  return page.evaluate((wsId) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'cards') { ws.close(); resolve(m.cards.filter((c) => c.workspaceId === wsId).map((c) => c.id)); } };
    setTimeout(() => { ws.close(); resolve([]); }, 2000);
  }), wsId);
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, colorScheme: dark ? 'dark' : 'light' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate((dark) => { localStorage.setItem('cc-control.welcomed.v2', '1'); localStorage.removeItem('cc-control.stackPick'); if (dark) localStorage.setItem('cc-control.theme', 'dark'); }, dark);
  await page.evaluate((w) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify({ type: 'workspace.save', workspace: w })); setTimeout(() => { ws.close(); resolve(); }, 400); }; }),
    { id: 'ws-demo-compile', name: 'Compile', color: 'blue', repos: [`${DEMO}/web-app`, `${DEMO}/payments-api`], notes: '' });
  const UI_PORT = 18996;
  await ask(page, { type: 'stack.save', workspaceId: 'ws-demo-compile', stack: {
    choose: { env: ['dev', 'uat'] },
    api: { steps: [`wait:port:{{port}} node ${STANDINS}/api.cjs {{port}} {{name}}-{{env}}`, `stop: node ${STANDINS}/down.cjs {{deployment}}`] },
    apis: [{ repo: 'payments-api', values: { name: 'payments-api', appPort: '8080', route: 'payments' } }],
    ui: { repo: 'web-app', steps: [`node ${STANDINS}/ui-compile.cjs ${UI_PORT} 6`], url: `http://localhost:${UI_PORT}` },
  } });
  for (const id of await cardIds(page, 'ws-demo-compile')) await ask(page, { type: 'card.delete', id }).catch(() => {});
  const card = await ask(page, { type: 'cards.seed', options: { repos: [`${DEMO}/web-app`, `${DEMO}/payments-api`], workspaceId: 'ws-demo-compile', key: 'SHOP-180', state: 'idle', title: 'Compiling UI' } });
  await page.evaluate((id) => localStorage.setItem('cc-control.stackPick', JSON.stringify({ [id]: { values: { env: 'dev' }, apis: [] } })), card.id);
  await page.reload();
  await sleep(1000);

  // The Try it panel: the UI first, marked as always starting, with why.
  await page.locator(`#card-${card.id}`).click();
  await sleep(500);
  await page.keyboard.press('Shift+T');
  await sleep(800);
  const list = page.getByRole('listbox', { name: 'The environment and the services' });
  const services = list.getByRole('option');
  const firstService = services.nth(1);
  check('the UI is the first service, before the APIs', /web-app/.test(await firstService.innerText()) && /payments-api/.test(await services.nth(2).innerText()), (await firstService.innerText()).split('\n')[0]);
  check('it is marked as always starting, and says why', /Always starts: the UI is the app you try/.test(await firstService.innerText()));
  const box = firstService.getByRole('checkbox');
  check('its box is ticked and can’t be changed (for screen readers too)', (await box.getAttribute('aria-checked')) === 'true' && (await box.getAttribute('aria-disabled')) === 'true', await box.getAttribute('aria-label'));
  check('the note under it names the shared environment the unticked APIs use', /the rest are the shared dev ones/.test(await firstService.innerText()));
  await page.keyboard.press('j');
  await sleep(200);
  await page.keyboard.press('Space');
  check('Space on the UI says it always starts, and changes nothing', await until(async () => (await page.getByText(/The UI always starts: it is the app you try/).count()) > 0, 3000));
  check('the APIs are still unticked', (await services.nth(2).getByRole('checkbox').getAttribute('aria-checked')) === 'false');
  await shot(page, 'ui-first');

  // Start: the stand-in serves and prints its address at once, but isn't up until it compiles.
  await page.keyboard.press('t');
  const ui = async () => (await runsOf(page, card.id)).find((r) => r.service === 'ui');
  check('the UI serves and has printed its address', await until(async () => /compiling ui/.test(await serves(UI_PORT)) && ((await ui())?.steps?.[0]?.tail ?? []).some((l) => /Project is running at/.test(l)), 10000));
  const early = await ui();
  check('…but it is still starting, not up', early?.state === 'running', early?.state);
  check('the panel says it is compiling, with no Open', await until(async () => /compiling/.test(await firstService.innerText()), 3000) && (await firstService.getByRole('button', { name: /Open/ }).count()) === 0, (await firstService.innerText()).split('\n').slice(0, 3).join(' / '));
  await shot(page, 'compiling');
  check('a failed build says so', await until(async () => /didn’t compile/.test(await firstService.innerText()), 8000), (await firstService.innerText()).split('\n').slice(0, 3).join(' / '));
  await shot(page, 'didnt-compile');
  check('when the build is done it is up, with Open', await until(async () => (await ui())?.state === 'up' && (await firstService.getByRole('button', { name: /Open/ }).count()) === 1, 15000));
  const t0 = early?.startedAt ?? 0;
  const done = await ui();
  check('up only after the compiled line (about 6 s in)', done?.steps?.[0]?.tail?.some((l) => /compiled successfully/.test(l)), `${Math.round((Date.now() - t0) / 1000)} s`);
  await shot(page, 'up');

  await page.keyboard.press('t');
  check('t stops it', await until(async () => (await runsOf(page, card.id)).every((r) => r.state !== 'up' && r.state !== 'running')));
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.keyboard.press('Shift+Slash');
  await sleep(500);
  check('the ? row says the UI comes first and always starts', (await page.getByText(/the UI first: it always starts/).count()) > 0);
  await page.keyboard.press('Escape');
  await ask(page, { type: 'card.delete', id: card.id }).catch(() => {});

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
