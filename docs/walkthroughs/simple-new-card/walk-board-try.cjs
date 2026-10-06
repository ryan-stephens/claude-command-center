// Try it from the board (PLAN §104) on an isolated server (PORT, default 7803): the buttons under a tile
// start, stop, restart and open a card's app without opening the card, and t / ⇧R / o do the same on the
// chosen card. Two cards: one in a lane with a stand-in stack (standins/), one on a single repo with a
// recipe of its own. DARK=1 for dark mode.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const PORT = process.env.PORT || '7803';
const dark = process.env.DARK === '1';
const OUT = path.join(__dirname, dark ? 'shots-board-try-dark' : 'shots-board-try');
fs.mkdirSync(OUT, { recursive: true });
const DEMO = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/') + '/cc-demo';
const STANDINS = path.join(__dirname, 'standins').replace(/\\/g, '/');
const SOLO_PORT = 18995;
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; };

async function ask(page, msg) {
  return page.evaluate((msg) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    const reqId = `w-${Math.random().toString(36).slice(2)}`;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.reqId !== reqId) return; ws.close(); if (m.type === 'error') reject(new Error(m.message)); else resolve(m); };
    ws.onopen = () => ws.send(JSON.stringify({ ...msg, reqId }));
    setTimeout(() => { ws.close(); reject(new Error('no answer')); }, 5000);
  }), msg);
}

/** The runs the server has for a card, as a fresh connection gets them. */
async function runsOf(page, id) {
  return page.evaluate((id) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'runs') { ws.close(); resolve(m.runs.filter((r) => r.cardId === id)); } };
    setTimeout(() => { ws.close(); resolve([]); }, 2000);
  }), id);
}

async function cardIds(page, workspaceIds) {
  return page.evaluate((wss) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'cards') { ws.close(); resolve(m.cards.filter((c) => wss.includes(c.workspaceId)).map((c) => c.id)); } };
    setTimeout(() => { ws.close(); resolve([]); }, 2000);
  }), workspaceIds);
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, colorScheme: dark ? 'dark' : 'light' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate((dark) => { localStorage.setItem('cc-control.welcomed.v2', '1'); localStorage.removeItem('cc-control.stackPick'); if (dark) localStorage.setItem('cc-control.theme', 'dark'); }, dark);
  for (const w of [
    { id: 'ws-demo-board-stack', name: 'Stack', color: 'blue', repos: [`${DEMO}/web-app`, `${DEMO}/payments-api`], notes: '' },
    { id: 'ws-demo-board-solo', name: 'Docs', color: 'green', repos: [`${DEMO}/docs-site`], notes: '' },
  ]) await page.evaluate((w) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify({ type: 'workspace.save', workspace: w })); setTimeout(() => { ws.close(); resolve(); }, 400); }; }), w);
  await ask(page, { type: 'stack.save', workspaceId: 'ws-demo-board-stack', stack: {
    choose: { env: ['dev', 'uat'] },
    api: { steps: [`wait:port:{{port}} node ${STANDINS}/api.cjs {{port}} {{name}}-{{env}}`, `stop: node ${STANDINS}/down.cjs {{deployment}}`] },
    apis: [{ repo: 'payments-api', values: { name: 'payments-api', appPort: '8080', route: 'payments' } }],
    ui: { repo: 'web-app', steps: [`node ${STANDINS}/ui.cjs {{uiPort}}`], url: 'http://localhost:{{uiPort}}' },
  } });
  await ask(page, { type: 'recipe.save', repo: `${DEMO}/docs-site`, steps: [`wait:port:${SOLO_PORT} node ${STANDINS}/ui.cjs ${SOLO_PORT}`], url: `http://localhost:${SOLO_PORT}` });
  for (const id of await cardIds(page, ['ws-demo-board-stack', 'ws-demo-board-solo'])) await page.evaluate((id) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify({ type: 'card.delete', id })); setTimeout(() => { ws.close(); resolve(); }, 150); }; }), id);
  const stack = await ask(page, { type: 'cards.seed', options: { repos: [`${DEMO}/web-app`, `${DEMO}/payments-api`], workspaceId: 'ws-demo-board-stack', key: 'SHOP-170', state: 'idle', title: 'Saved carts' } });
  const planning = await ask(page, { type: 'cards.seed', options: { repos: [`${DEMO}/web-app`, `${DEMO}/payments-api`], workspaceId: 'ws-demo-board-stack', key: 'SHOP-171', state: 'working', title: 'Gift cards' } });
  const solo = await ask(page, { type: 'cards.seed', options: { repos: [`${DEMO}/docs-site`], workspaceId: 'ws-demo-board-solo', key: 'DOC-40', state: 'idle', title: 'Release notes page' } });
  // The stack card's pick, as the Try it panel would have remembered it: the API ticked, on dev.
  await page.evaluate((id) => localStorage.setItem('cc-control.stackPick', JSON.stringify({ [id]: { values: { env: 'dev' }, apis: ['payments-api'] } })), stack.id);
  await page.reload();
  await sleep(1000);

  const group = (id) => page.locator(`#card-${id}`).locator('xpath=..').getByRole('group');
  const btn = (id, name) => group(id).getByRole('button', { name });
  const opened = () => page.locator('section[aria-label^="SHOP-170"], section[aria-label^="DOC-40"]').count();

  // The buttons show on cards in Try it; not on a card in Build that isn't chosen.
  check('a card in Try it shows Start under its tile', await btn(stack.id, /^Start/).isVisible());
  check('a card in Build, not chosen, shows no buttons', (await group(planning.id).count()) === 0);
  await shot(page, 'board');

  // Start from the stack card's tile: the board stays, the stack comes up.
  await btn(stack.id, /^Start/).click();
  await sleep(300);
  check('Start leaves the board as it is (the card doesn’t open)', (await opened()) === 0);
  check('the stack comes up: Stop, Restart and Open', await until(async () => await btn(stack.id, /^Open/).isEnabled().catch(() => false) && await btn(stack.id, /^Stop/).isVisible()));
  await until(async () => (await runsOf(page, stack.id)).every((r) => r.state === 'up'));
  const before = await runsOf(page, stack.id);
  check('both services run', before.length === 2 && before.every((r) => r.state === 'up'), before.map((r) => `${r.service}:${r.state}`).join(' '));
  await shot(page, 'stack-up');

  // Open: the UI in a new tab.
  const [tab] = await Promise.all([context.waitForEvent('page'), btn(stack.id, /^Open/).click()]);
  await tab.waitForLoadState().catch(() => {});
  check('Open opens the stack’s UI in a new tab', /stand-in ui/.test(await tab.content()), tab.url());
  await tab.close();

  // Restart: both services start again (new runs), and come back up.
  const t0 = Math.max(...before.map((r) => r.startedAt));
  await btn(stack.id, /^Restart/).click();
  check('Restart starts every service again', await until(async () => { const r = await runsOf(page, stack.id); return r.length === 2 && r.every((x) => x.startedAt > t0 && x.state === 'up'); }));
  check('the card still didn’t open', (await opened()) === 0);

  // Stop: everything stops, and the tile offers Start again.
  await btn(stack.id, /^Stop/).click();
  check('Stop stops the stack; the tile offers Start again', await until(async () => await btn(stack.id, /^Start/).isVisible().catch(() => false)));
  const after = await runsOf(page, stack.id);
  check('no service of the stack still runs', after.every((r) => r.state !== 'up' && r.state !== 'running'), after.map((r) => `${r.service}:${r.state}`).join(' '));

  // The keys on the chosen card: Start the single-recipe card from its button, then ⇧R, o, t from the keyboard.
  await btn(solo.id, /^Start/).click();
  check('the single-recipe card comes up from its Start button', await until(async () => await btn(solo.id, /^Open/).isEnabled().catch(() => false)));
  const s0 = (await runsOf(page, solo.id))[0]?.startedAt ?? 0;
  await page.keyboard.press('Shift+R');
  check('⇧R on the chosen card restarts its app', await until(async () => { const r = (await runsOf(page, solo.id))[0]; return Boolean(r && r.startedAt > s0 && r.state === 'up'); }));
  const [tab2] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('o')]);
  await tab2.waitForLoadState().catch(() => {});
  check('o opens it', tab2.url().includes(String(SOLO_PORT)), tab2.url());
  await tab2.close();
  await shot(page, 'solo-up');
  await page.keyboard.press('t');
  check('t stops it', await until(async () => await btn(solo.id, /^Start/).isVisible().catch(() => false)));

  // A card in Build shows the buttons once it is chosen (the arrows move the choice there).
  for (let i = 0; i < 12 && !(await group(planning.id).count()); i += 1) await page.keyboard.press(i < 6 ? 'ArrowLeft' : 'ArrowDown');
  check('a card in Build shows Start once it is chosen', (await group(planning.id).count()) === 1);

  // ⇧R in the open card: with nothing running it starts, as t does.
  await page.locator(`#card-${solo.id}`).click();
  await sleep(600);
  check('the tile opens the card', (await opened()) === 1);
  await page.keyboard.press('Shift+R');
  check('⇧R on the open card starts its app when nothing runs', await until(async () => (await runsOf(page, solo.id))[0]?.state === 'up'));
  await page.keyboard.press('t');
  await until(async () => (await runsOf(page, solo.id))[0]?.state !== 'up');
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.keyboard.press('Shift+Slash');
  await sleep(500);
  check('the ? overlay has the R row and the tile buttons', (await page.getByText(/a card: Restart its app.*the tile has these as buttons/).count()) > 0);
  await shot(page, 'keys');
  await page.keyboard.press('Escape');

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
