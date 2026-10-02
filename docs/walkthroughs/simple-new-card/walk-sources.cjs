// Another folder of repos for one card (PLAN §65) in the + Context popup's Repos tab, on the isolated server at :7802 (seeded by walk-simple.cjs).
// Seeds a second folder of repos under %TEMP%\cc-extra by git init, never added to the library or the lane.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const PORT = process.env.PORT || '7802';
const OUT = path.join(__dirname, 'shots-sources');
fs.mkdirSync(OUT, { recursive: true });
const EXTRA = path.join(process.env.TEMP, 'cc-extra');
for (const name of ['side-api', 'side-web']) {
  const dir = path.join(EXTRA, name);
  if (!fs.existsSync(path.join(dir, '.git'))) { fs.mkdirSync(dir, { recursive: true }); execSync('git init -q', { cwd: dir }); }
}
const PLAIN = path.join(EXTRA, 'notes-only');
fs.mkdirSync(PLAIN, { recursive: true });
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
  const popup = page.getByRole('group', { name: 'Add context' });
  const flash = async () => (await popup.locator('[role=status]').innerText().catch(() => '')).replace(/\n/g, ' '); // the note inside the popup (§68)

  await page.keyboard.press('+');
  await sleep(300);
  const rows = async () => popup.locator('[id^="pick-"]').allInnerTexts();
  const r0 = await rows();
  check('Repos lists the library then the row that adds a folder', r0.length > 1 && !/for this card/.test(r0[0]) && /Another folder of repos/.test(r0[r0.length - 1]), r0.join(' | '));
  check('no heading yet', !r0.some((r) => /for this card · x/.test(r)));
  await shot(page, 'repos-before');

  // A folder with no repos in it is refused, with a pointer to the Folders tab.
  await page.locator('#cp-q').focus();
  await page.keyboard.type(PLAIN);
  await sleep(200);
  const r1 = await rows();
  check('a path in the box leaves the list as it is and names the scan on the last row', r1.length === r0.length && /Scan .*notes-only for repos/.test(r1[r1.length - 1]), r1[r1.length - 1]);
  await page.keyboard.press('Enter');
  await sleep(800);
  check('a folder with no repos is refused inside the popup, pointing at Folders', /No git repos in/.test(await flash()) && /Folders tab/.test(await flash()) && !/No git repos/.test(await page.locator('header').innerText()), await flash());
  check('nothing was added for it', !(await rows()).some((r) => /notes-only/.test(r) && /x takes it off/.test(r)));
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');

  // The extra folder, pasted as a path: its repos under a heading with its path, highlight on the first.
  await page.keyboard.type(EXTRA);
  await page.keyboard.press('Enter');
  await sleep(800);
  const r2 = await rows();
  const h = r2.findIndex((r) => /cc-extra/.test(r) && /for this card/.test(r));
  check('the folder heads its repos after the library', h > 0 && h === r0.length - 1 && /side-(api|web)/.test(r2[h + 1]) && /side-(api|web)/.test(r2[h + 2]), r2.join(' | '));
  check('the box is cleared', (await page.locator('#cp-q').inputValue()) === '');
  check('the highlight is on its first repo', await popup.locator(`#pick-${h + 1}`).evaluate((el) => el.classList.contains('is-focus')));
  check('the popup says how many, under its box, for this card only', /2 repos in .*cc-extra, listed below for this card only/.test(await flash()), await flash());
  await shot(page, 'folder-added');

  // The same folder again is refused; the library's own folder too.
  await page.locator('#cp-q').focus();
  await page.keyboard.type(EXTRA);
  await page.keyboard.press('Enter');
  await sleep(600);
  check('the same folder again: listed already', /listed already/.test(await flash()));
  check('still one heading', (await rows()).filter((r) => /for this card · x/.test(r)).length === 1);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape'); // leave the box; the popup stays
  await sleep(200);

  // Enter on side-api (typing put the highlight back on the first row: ↓ to it): a card repo, ticked, and a chip whose sub names the folder.
  const target = (await rows()).findIndex((r) => /side-api/.test(r));
  for (let i = 0; i < target; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(300);
  const r3 = await rows();
  check('side-api ticked as added', r3.some((r) => /side-api/.test(r) && /✓/.test(r) && /added/.test(r)), r3.join(' | '));
  const chips1 = await chipRow.innerText();
  check('its chip says which folder it came from', /side-api\s*\n?\s*cc-extra/.test(chips1), chips1.replace(/\n/g, ' | '));
  await shot(page, 'repo-picked');

  // The search filters every group; a search that matches nothing under the heading hides it.
  await page.keyboard.press('/');
  await sleep(150); // / focuses the box on the next tick
  await page.keyboard.type('side');
  await sleep(200);
  const r4 = await rows();
  check('the search filters the library and the folder alike', !r4.some((r) => /web-app/.test(r)) && r4.some((r) => /side-web/.test(r)) && r4.some((r) => /cc-extra/.test(r)), r4.join(' | '));
  await page.keyboard.press('Control+A');
  await page.keyboard.type('web-app');
  await sleep(200);
  const r5 = await rows();
  check('a heading goes when nothing under it matches', r5.some((r) => /web-app/.test(r)) && !r5.some((r) => /cc-extra/.test(r)), r5.join(' | '));
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await sleep(200);

  // Folders tab does not list the repo picked from the folder.
  await page.keyboard.press('ArrowRight');
  await sleep(300);
  check('Folders does not list a repo picked from the folder', !/side-api/.test(await popup.innerText()));
  await page.keyboard.press('Escape'); // the tab switch focused the box
  await page.keyboard.press('ArrowLeft');
  await sleep(300);
  await page.keyboard.press('Escape'); // and so did this one: the keys below are the popup's, not the box's
  await sleep(100);

  // ↑ to the heading: the legend offers x; x takes the folder off; the chip stays.
  const r6 = await rows();
  const h2 = r6.findIndex((r) => /cc-extra/.test(r) && /for this card/.test(r));
  const ai = await popup.locator('.is-focus').getAttribute('id');
  const cur = Number((ai || 'pick-0').replace('pick-', ''));
  for (let i = cur; i > h2; i--) await page.keyboard.press('ArrowUp');
  for (let i = cur; i < h2; i++) await page.keyboard.press('ArrowDown');
  await sleep(200);
  check('the heading can take the highlight', await popup.locator(`#pick-${h2}`).evaluate((el) => el.classList.contains('is-focus')));
  const legend = ((await page.locator('footer').count()) ? await page.locator('footer').innerText() : 'NO-LEGEND');
  check('legend offers b and x on the heading', /NO-LEGEND/.test(legend) || (/A folder of repos/.test(legend) && /Take the folder off/.test(legend)), legend.replace(/\n/g, ' '));
  await shot(page, 'on-heading');
  await page.keyboard.press('Enter');
  await sleep(300);
  check('Enter on the heading only says what x does', /x takes this folder/.test(await flash()));
  await page.keyboard.press('x');
  await sleep(300);
  const r7 = await rows();
  check('x takes the folder and side-web off the list', !r7.some((r) => /cc-extra|side-web/.test(r)), r7.join(' | '));
  const chips2 = await chipRow.innerText();
  check('side-api stays on the card, its chip still naming the folder', /side-api\s*\n?\s*cc-extra/.test(chips2), chips2.replace(/\n/g, ' | '));
  await shot(page, 'folder-off');

  // Esc keeps the card; c picks it up with the folder gone and the repo still there; and nothing started.
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(400);
  await page.keyboard.press('c');
  await sleep(400);
  check('c picks the card up with side-api', /side-api/.test(await page.getByRole('region', { name: 'New card' }).innerText()));
  await page.keyboard.press('Shift+Slash');
  await sleep(300);
  check('? has the Repos tab row', /Another folder of repos to pick from, for this card only/.test(await page.locator('[role=dialog]').innerText()));
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(300);
  check('no card was started', !(await page.getByText('Started in a terminal tab').isVisible().catch(() => false)));
  check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
