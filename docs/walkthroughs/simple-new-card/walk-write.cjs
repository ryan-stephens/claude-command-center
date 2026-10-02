// "Have Claude write it" (PLAN §62) on the isolated server at :7802 (seeded by walk-simple.cjs).
// Spends one cheap-model turn, so it is not part of the regression set: run it by hand.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const PORT = process.env.PORT || '7802';
const OUT = path.join(__dirname, 'shots-write');
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
  await sleep(200);
  await page.keyboard.press('Shift+C');
  await sleep(500);
  const region = page.getByRole('region', { name: 'New card' });
  const msg = page.locator('#cp-msg');
  await page.locator('#cp-q').focus();
  await page.keyboard.type('SHOP-155');
  await sleep(700);
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.keyboard.press('ArrowDown'); // the message
  // w with nothing to go on: a flash, no request.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Escape');
  await page.keyboard.press('w');
  await sleep(300);
  const status = await page.locator('[role=status]').allInnerTexts().catch(() => []);
  check('w with an empty box says to write rough words first', status.some((t) => /rough words/.test(t)), status.join(' | '));
  // Rough words, then w: the box is read-only while Claude writes, then holds its answer.
  await page.keyboard.press('Enter');
  await page.keyboard.type('review the ticket and plan, need the api too, dont touch the checkout flow');
  await page.keyboard.press('Escape');
  await page.keyboard.press('w');
  await sleep(400);
  check('the button says Claude is writing', /Claude is writing/.test(await region.innerText()));
  await shot(page, 'writing');
  const t0 = Date.now();
  await page.waitForFunction(() => !/Claude is writing/.test(document.body.innerText), null, { timeout: 90_000 });
  const text = await msg.inputValue();
  check('the answer replaced the rough words', !/dont touch/.test(text) && text.length > 80, `${Date.now() - t0} ms: ${text.slice(0, 160).replace(/\n/g, ' ')}`);
  check('it keeps the facts: the ticket, the API, the checkout flow', /SHOP-155/.test(text) && /payments-api/.test(text) && /checkout/i.test(text), text.replace(/\n/g, ' '));
  check('and names nothing from this machine’s settings (no CLAUDE.md was loaded)', !/trello|paddock|coolify/i.test(text), text.replace(/\n/g, ' ').slice(0, 200));
  check('the message is the card’s own now', /Your own/.test(await region.getByRole('button', { name: /Prompt ·/ }).innerText()));
  await shot(page, 'written');
  await page.keyboard.press('Escape');
  await sleep(300);
  check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
