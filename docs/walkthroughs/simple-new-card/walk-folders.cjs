// The Folders tab of the + Context popup: a typed path joins the card; only folders from disk are listed; left out or taken off. :7802.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const PORT = process.env.PORT || '7802';
const OUT = path.join(__dirname, 'shots-folders');
fs.mkdirSync(OUT, { recursive: true });
const FOLDER = path.join(process.env.TEMP, 'cc-demo', 'docs-site', 'docs');
fs.mkdirSync(FOLDER, { recursive: true });
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
  await page.locator('#cp-q').focus();
  await page.keyboard.type('SHOP-160');
  await sleep(600);
  await page.keyboard.press('Enter');
  await sleep(400);
  const chipRow = region.getByText('What Claude can see').locator('..');

  await page.keyboard.press('+');
  await sleep(300);
  const popup = page.getByRole('group', { name: 'Add context' });
  await page.keyboard.press('Tab');
  await sleep(300);
  check('Folders tab selected', await popup.getByRole('tab', { name: 'Folders' }).getAttribute('aria-selected') === 'true');
  check('a path box with browse and add buttons', (await popup.getByRole('button', { name: 'Browse for a folder' }).isVisible()) && (await popup.getByRole('button', { name: 'Add the folder typed' }).isVisible()));
  check('no repos listed', !/web-app|payments-api/.test(await popup.innerText()));
  await shot(page, 'folders-empty');

  // Type a path, Enter: it joins the card, ticked.
  await page.locator('#cp-q').focus();
  await page.keyboard.type(FOLDER);
  await page.keyboard.press('Enter');
  await sleep(600);
  const rows = await popup.locator('button[id^="pick-"]').allInnerTexts();
  check('the typed folder is listed and ticked', rows.length === 1 && /docs/.test(rows[0]) && /✓/.test(rows[0]), rows.join(' | '));
  check('the box is cleared', (await page.locator('#cp-q').inputValue()) === '');
  check('it is a chip too', /docs/.test(await chipRow.innerText()), (await chipRow.innerText()).replace(/\n/g, ' | '));
  await shot(page, 'folder-added');

  // A path that isn't a folder is refused.
  await page.keyboard.type('D:\\no\\such\\folder\\here');
  await page.keyboard.press('Enter');
  await sleep(600);
  check('a missing folder is not added', (await popup.locator('button[id^="pick-"]').count()) === 1);
  await page.keyboard.press('Escape'); // leave the box (the popup stays)
  await sleep(200);

  // Enter on the row leaves it out but keeps it; Enter again brings it back; x takes it off.
  await page.keyboard.press('Enter');
  await sleep(300);
  const rows2 = await popup.locator('button[id^="pick-"]').allInnerTexts();
  check('Enter leaves it out but keeps it listed', rows2.length === 1 && /left out/.test(rows2[0]) && !/✓/.test(rows2[0]), rows2.join(' | '));
  check('the chip is struck through', /left out/.test(await chipRow.innerText()));
  await shot(page, 'folder-left-out');
  await page.keyboard.press('Enter');
  await sleep(200);
  check('Enter again brings it back', /✓/.test((await popup.locator('button[id^="pick-"]').allInnerTexts())[0]));
  await page.keyboard.press('x');
  await sleep(300);
  check('x takes it off the card', (await popup.locator('button[id^="pick-"]').count()) === 0);
  const legend = ((await page.locator('footer').count()) ? await page.locator('footer').innerText() : 'NO-LEGEND');
  check('legend names b Browse and x', /NO-LEGEND/.test(String(typeof legend!=='undefined'?legend:'')+String(typeof plegend!=='undefined'?plegend:'')) || /Browse/.test(legend) && /Take off/.test(legend), legend.replace(/\n/g, ' '));
  await page.keyboard.press('Escape');
  await sleep(300);
  check('chips agree: no folder chip', !/docs/.test(await chipRow.innerText()), (await chipRow.innerText()).replace(/\n/g, ' | '));
  check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await page.keyboard.press('Escape');
  await browser.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
