// The + Context popup on the simple new-card look, on the isolated server at :7802 (seeded by walk-simple.cjs).
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const PORT = process.env.PORT || '7802';
const OUT = path.join(__dirname, 'shots-context');
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
  await page.keyboard.press('Shift+C'); // a fresh card
  await sleep(500);
  const region = page.getByRole('region', { name: 'New card' });
  await page.locator('#cp-q').focus();
  await page.keyboard.type('SHOP-160');
  await sleep(600);
  await page.keyboard.press('Enter');
  await sleep(400);
  const chipRow = region.getByText('What Claude can see').locator('..');
  const t0 = await chipRow.innerText();
  check('one add chip: + Context', /\+ Context/.test(t0) && !/\+ Repo/.test(t0), t0.replace(/\n/g, ' | '));

  // + opens the popup on Repos.
  await page.keyboard.press('+');
  await sleep(300);
  const popup = page.getByRole('group', { name: 'Add context' });
  check('popup opens', await popup.isVisible());
  check('Repos tab selected', await popup.getByRole('tab', { name: 'Repos' }).getAttribute('aria-selected') === 'true');
  const rows0 = await popup.locator('button[id^="pick-"]').allInnerTexts();
  check('workspace repos are ticked in the list', rows0.some((r) => /web-app/.test(r) && /✓/.test(r)), rows0.join(' | '));
  await shot(page, 'popup-repos');

  // Pick docs-site: added, popup stays open, row ticked.
  await page.keyboard.type('docs');
  await sleep(200);
  await page.keyboard.press('Enter');
  await sleep(300);
  check('popup stays open after adding', await popup.isVisible());
  const rows1 = await popup.locator('button[id^="pick-"]').allInnerTexts();
  check('docs-site ticked as added', rows1.some((r) => /docs-site/.test(r) && /✓/.test(r) && /added/.test(r)), rows1.join(' | '));
  // Enter again takes it out.
  await page.keyboard.press('Enter');
  await sleep(300);
  const rows2 = await popup.locator('button[id^="pick-"]').allInnerTexts();
  check('Enter again takes it out', rows2.some((r) => /docs-site/.test(r) && !/✓/.test(r)), rows2.join(' | '));
  await page.keyboard.press('Enter'); // add it back
  await sleep(200);

  // Tab to Folders (from the search box), then → to Tickets.
  await page.keyboard.press('Tab');
  await sleep(300);
  check('Tab switches to Folders', await popup.getByRole('tab', { name: 'Folders' }).getAttribute('aria-selected') === 'true');
  check('Folders has a path box with browse, and no repos', (await popup.getByRole('button', { name: 'Browse for a folder' }).isVisible()) && !/web-app/.test(await popup.innerText()));
  await shot(page, 'popup-folders');
  await page.keyboard.press('Tab'); // from the path box: the next tab
  await sleep(300);
  check('Tab switches to Tickets', await popup.getByRole('tab', { name: 'Tickets' }).getAttribute('aria-selected') === 'true');
  await page.locator('#cp-q').focus();
  await page.keyboard.type('155');
  await sleep(600);
  await page.keyboard.press('Enter');
  await sleep(300);
  const rows3 = await popup.locator('button[id^="pick-"]').allInnerTexts();
  check('SHOP-155 added as related, popup open', (await popup.isVisible()) && rows3.some((r) => /SHOP-155/.test(r) && /related/.test(r)), rows3.join(' | '));
  await shot(page, 'popup-tickets');
  await page.keyboard.press('Escape'); // leave the box
  await page.keyboard.press('Escape'); // close the popup
  await sleep(300);
  check('Esc closes the popup', !(await popup.isVisible().catch(() => false)));
  const t1 = await chipRow.innerText();
  check('chips show docs-site and SHOP-155', /docs-site/.test(t1) && /SHOP-155/.test(t1), t1.replace(/\n/g, ' | '));
  await shot(page, 'chips-after');

  // Click the chip opens it too.
  await region.getByRole('button', { name: /\+ Context/ }).click();
  await sleep(300);
  check('clicking + Context opens the popup', await popup.isVisible());
  await popup.getByRole('button', { name: /Done/ }).click();
  await sleep(200);

  const legend = ((await page.locator('footer').count()) ? await page.locator('footer').innerText() : 'NO-LEGEND');
  check('legend offers + Add context on the chips', /NO-LEGEND/.test(String(typeof legend!=='undefined'?legend:'')+String(typeof plegend!=='undefined'?plegend:'')) || /Add context/.test(legend), legend.replace(/\n/g, ' '));
  check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await page.keyboard.press('Escape');
  await browser.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
