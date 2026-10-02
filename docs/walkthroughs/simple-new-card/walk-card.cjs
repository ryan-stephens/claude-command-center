// The open card (PLAN §80 onward) on the isolated server at :7802: seeds a Demo lane and one card
// per state through cards.seed (no terminal tab, no Claude session), opens each and screenshots it.
// Run walk-simple.cjs first for the lane, or let this one make it.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const PORT = process.env.PORT || '7802';
const OUT = path.join(__dirname, 'shots-card');
fs.mkdirSync(OUT, { recursive: true });
const DEMO = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/') + '/cc-demo';
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ask the server something through the page's own socket (the server checks Origin) and wait for the reply with the same reqId. */
async function ask(page, msg) {
  return page.evaluate((msg) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    const reqId = `w-${Math.random().toString(36).slice(2)}`;
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.reqId !== reqId) return;
      ws.close();
      if (m.type === 'error') reject(new Error(m.message)); else resolve(m);
    };
    ws.onopen = () => ws.send(JSON.stringify({ ...msg, reqId }));
    setTimeout(() => { ws.close(); reject(new Error('no answer')); }, 4000);
  }), msg);
}

(async () => {
  const dark = process.env.DARK === '1';
  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1440), height: 950 }, colorScheme: dark ? 'dark' : 'light' });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate((dark) => { localStorage.setItem('cc-control.welcomed.v2', '1'); if (dark) localStorage.setItem('cc-control.theme', 'dark'); }, dark);
  await page.evaluate(({ DEMO }) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'workspace.save', workspace: { id: 'ws-demo-simple', name: 'Demo', color: 'teal', repos: [`${DEMO}/web-app`, `${DEMO}/payments-api`], notes: 'Round money down, never to nearest.' } }));
      setTimeout(() => { ws.close(); resolve(); }, 600);
    };
  }), { DEMO });
  await page.reload();
  await sleep(800);

  // One card per state. Changes needs real folders: the demo repos themselves (web-app has uncommitted edits to show).
  const states = ['plan', 'tool', 'working', 'idle', 'done'];
  const ids = {};
  for (const [i, state] of states.entries()) {
    const r = await ask(page, { type: 'cards.seed', options: { repos: [`${DEMO}/web-app`, `${DEMO}/payments-api`], workspaceId: 'ws-demo-simple', key: `SHOP-${150 + i}`, state, title: `${state[0].toUpperCase()}${state.slice(1)}: save cart for signed-out users` } });
    ids[state] = r.id;
  }
  check('five cards seeded', Object.keys(ids).length === 5);
  await sleep(500);
  await page.keyboard.press('1');
  await sleep(400);
  await shot(page, 'board');

  for (const state of states) {
    await page.locator(`#card-${ids[state]}`).click();
    await sleep(700);
    const view = page.locator('section[aria-label^="SHOP-"]').first();
    check(`${state}: the card opens`, await view.isVisible());
    await shot(page, `card-${state}`);
    if (state === 'plan') {
      check('plan: the transcript shows the seeded plan', await view.getByText('Persist the guest cart to localStorage').first().isVisible().catch(() => false));
    }
    await page.keyboard.press('Escape');
    await sleep(300);
  }
  check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  // Leave the cards for other walkthroughs unless asked to clean up.
  if (process.env.CLEAN === '1') for (const id of Object.values(ids)) await page.evaluate((id) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify({ type: 'card.delete', id })); setTimeout(() => { ws.close(); resolve(); }, 200); }; }), id);
  await browser.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
