// The way back out of an open card (PLAN §63): the breadcrumb, the back button at the top left,
// and the browser's own back and forward. On the isolated server at :7802 (seeded by
// walk-simple.cjs); it makes one card without a session through the WebSocket, then removes it.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const PORT = process.env.PORT || '7802';
const OUT = path.join(__dirname, 'shots-back');
fs.mkdirSync(OUT, { recursive: true });
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate(() => localStorage.setItem('cc-control.welcomed.v2', '1'));
  await page.reload();
  await sleep(1000);
  await page.keyboard.press('1');
  await sleep(300);
  const crumb = page.locator('header');
  const cardTiles = () => page.getByText(/^CARD-\d+$/);
  let hadCards = await cardTiles().count();
  check('the board’s breadcrumb is just Sessions', /Sessions/.test(await crumb.innerText()) && !/\//.test((await crumb.innerText()).replace(/Sessions/, '').split('\n')[0] || ''), (await crumb.innerText()).split('\n').slice(0, 3).join(' | '));

  // Open the first card on the board with Enter (the walkthroughs leave none; use the half-built card? no: focus a card tile).
  // There may be no card yet: this walkthrough needs one. Make a plain one straight on the board through the page's own socket.
  let tile = cardTiles().first();
  if (!(await tile.isVisible().catch(() => false))) {
    // No card yet: seed one (§80), with no terminal tab or session behind it.
    const DEMO = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/') + '/cc-demo';
    await page.evaluate(({ DEMO }) => new Promise((resolve) => {
      const ws = new WebSocket(`ws://${location.host}/ws`);
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.reqId === 'seed-back') { ws.close(); resolve(); } };
      ws.onopen = () => ws.send(JSON.stringify({ type: 'cards.seed', reqId: 'seed-back', options: { repos: [`${DEMO}/web-app`], workspaceId: 'ws-demo-simple', key: 'CARD-900', state: 'working', title: 'A seeded card for the way back' } }));
      setTimeout(() => { ws.close(); resolve(); }, 3000);
    }), { DEMO });
    await sleep(600);
    tile = cardTiles().first();
    check('a card was seeded to open', await tile.isVisible().catch(() => false));
    hadCards = await cardTiles().count();
  }
  await tile.click();
  await sleep(400);
  const view = page.locator('section[aria-label^="CARD-"], section[aria-label^="SHOP-"]').first();
  check('a card opens full screen', await view.isVisible());
  const crumbText = (await crumb.innerText()).split('\n').join(' ');
  check('the breadcrumb names the open card after Sessions', /Sessions\s*\/\s*(CARD|SHOP)-\d+/.test(crumbText), crumbText.slice(0, 120));
  const back = view.getByRole('button', { name: 'Back to the board' });
  const bb = await back.boundingBox();
  const vb = await view.boundingBox();
  check('the back button is at the top left of the card', bb && vb && bb.x - vb.x < 40 && bb.y - vb.y < 40, `${JSON.stringify(bb)} in ${JSON.stringify(vb)}`);
  check('the old Back to the board text on the right is gone', (await view.getByText('Back to the board').count()) === 0);
  await shot(page, 'card-open');

  // The browser's back leaves the card; forward reopens it.
  await page.goBack();
  await sleep(400);
  check('browser back closes the card', !(await view.isVisible().catch(() => false)));
  await page.goForward();
  await sleep(400);
  check('browser forward reopens it', await view.isVisible());
  // The breadcrumb's Sessions goes back too, and leaves one history entry behind (no pile-up).
  await crumb.getByRole('button', { name: 'Sessions', exact: true }).click();
  await sleep(400);
  check('the breadcrumb’s Sessions closes the card', !(await view.isVisible().catch(() => false)));
  await page.goForward();
  await sleep(400);
  check('forward after Sessions reopens the card (history stayed in step)', await view.isVisible());
  // The top-left button, then Esc after a reopen.
  await back.click();
  await sleep(400);
  check('the top-left button closes the card', !(await view.isVisible().catch(() => false)));
  await tile.click();
  await sleep(400);
  await page.keyboard.press('Escape');
  await sleep(400);
  check('Esc still closes it', !(await view.isVisible().catch(() => false)));
  // Esc went back in history rather than adding an entry: forward reopens the card, back closes it again.
  await page.goForward();
  await sleep(400);
  check('forward after Esc reopens the card (Esc went back, not forward)', await view.isVisible());
  await page.goBack();
  await sleep(400);
  check('and back closes it', !(await view.isVisible().catch(() => false)));
  await shot(page, 'board');
  check('card count unchanged', (await cardTiles().count()) === hadCards);
  check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
