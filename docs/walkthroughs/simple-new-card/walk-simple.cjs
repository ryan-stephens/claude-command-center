// Walkthrough of the simple new-card look (PLAN §59) on the isolated server at :7802.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const PORT = process.env.PORT || '7802';
const OUT = path.join(__dirname, 'shots-simple');
fs.mkdirSync(OUT, { recursive: true });
const DEMO = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/') + '/cc-demo';
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
  await sleep(800);

  // Seed from inside the page (the server checks Origin): a Demo workspace of two demo repos, the demo tickets, SHOP → Demo.
  await page.evaluate(({ DEMO }) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => {
      const id = 'ws-demo-simple';
      ws.send(JSON.stringify({ type: 'workspace.save', workspace: { id, name: 'Demo', color: 'teal', repos: [`${DEMO}/web-app`, `${DEMO}/payments-api`], notes: 'Round money down, never to nearest.' } }));
      ws.send(JSON.stringify({ type: 'library.setSources', sources: [DEMO] }));
      ws.send(JSON.stringify({ type: 'library.scan' }));
      ws.send(JSON.stringify({ type: 'tickets.demo', on: true }));
      ws.send(JSON.stringify({ type: 'tickets.map', project: 'SHOP', workspaceId: id }));
      ws.send(JSON.stringify({ type: 'settings.set', settings: { newCardLook: 'simple' } }));
      setTimeout(() => { ws.close(); resolve(); }, 1500);
    };
  }), { DEMO });
  await page.reload();
  await sleep(1200);
  await page.keyboard.press('1'); // the Demo workspace
  await sleep(300);
  await shot(page, 'board');

  // n on the first Inbox ticket: the simple screen opens with the ticket.
  const inboxTicket = page.locator('[id^="t:"], [data-ticket]').first();
  await page.keyboard.press('ArrowDown');
  await sleep(200);
  // Find a ticket in the Inbox by key text and open the composer with n.
  const hasInbox = await page.getByText(/SHOP-\d+/).first().isVisible().catch(() => false);
  check('demo tickets in the Inbox', hasInbox);
  await page.keyboard.press('c'); // new card, no ticket
  await sleep(500);
  const region = page.getByRole('region', { name: 'New card' });
  check('simple screen opens with c', await region.isVisible());
  check('kind control shows Develop', await region.getByRole('radio', { name: 'Develop' }).getAttribute('aria-checked') === 'true');
  const kcCount = await region.locator('.kc').count();
  check('few keycaps on screen', kcCount <= 3, `(${kcCount})`);
  await shot(page, 'simple-empty');

  // Find a ticket: the search box has focus on the ticket block; type and pick.
  await page.locator('#cp-q').focus();
  await page.keyboard.type('SHOP-155');
  await sleep(700);
  await shot(page, 'simple-ticket-search');
  await page.keyboard.press('Enter');
  await sleep(500);
  const title = await region.locator('h1').textContent().catch(() => '');
  check('ticket picked: its title is the heading', /cart/i.test(title || ''), `"${title}"`);
  const chipsText = await region.getByText('What Claude can see').locator('..').innerText();
  check('workspace repos are chips', /web-app/.test(chipsText) && /payments-api/.test(chipsText), chipsText.replace(/\n/g, ' | '));
  const settings = await region.locator('section', { hasText: 'Session settings' }).innerText();
  check('Session settings list branch, Plan first, model', /Branch/.test(settings) && /Plan first/.test(settings) && /Model/.test(settings), settings.replace(/\n/g, ' | ').slice(0, 200));
  await shot(page, 'simple-with-ticket');

  // Picking a ticket lands on the context row: → to + Context, Enter: the popup; pick docs-site.
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await sleep(300);
  const picker = page.getByRole('group', { name: 'Add context' });
  check('+ Context opens the popup', await picker.isVisible());
  await page.keyboard.type('docs');
  await sleep(300);
  await shot(page, 'simple-repo-picker');
  await page.keyboard.press('Enter');
  await sleep(400);
  const chips2 = await region.getByText('What Claude can see').locator('..').innerText();
  check('docs-site added as a chip of the card’s own', /docs-site/.test(chips2), chips2.replace(/\n/g, ' | '));
  await page.keyboard.press('Escape'); // leave the box
  await page.keyboard.press('Escape'); // close the popup
  await sleep(300);
  check('Esc closes the popup', !(await picker.isVisible().catch(() => false)));

  // → to the docs-site chip and x removes it.
  const chipButtons = region.getByText('What Claude can see').locator('..').locator('button');
  const labels = await chipButtons.allInnerTexts();
  const at = labels.findIndex((l) => /docs-site/.test(l));
  // ci is where we left it (on + Repo = index 2 before the add); move to docs-site
  const cur = 2; // after the add, ci stays 2: payments-api(1)... compute by stepping from 0
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < at; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('x');
  await sleep(300);
  const chips3 = await region.getByText('What Claude can see').locator('..').innerText();
  check('x takes docs-site out again', !/docs-site/.test(chips3), chips3.replace(/\n/g, ' | '));

  // Enter on the first (workspace) chip leaves it out, Enter again includes it.
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await sleep(200);
  const struck = await chipButtons.first().evaluate((el) => el.className.includes('line-through'));
  check('Enter leaves a workspace repo out (struck through)', struck);
  await shot(page, 'simple-chip-out');
  await page.keyboard.press('Enter');
  await sleep(200);

  // ↓ the opening message: write your own.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(150);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('The totals must round down.');
  await page.keyboard.press('Escape');
  await sleep(150);
  check('message typed', (await page.locator('#cp-msg').inputValue()) === 'The totals must round down.');
  check('typing detaches: the prompt button says your own', /Your own/.test(await region.getByRole('button', { name: /Prompt ·/ }).innerText()));

  // ↓ how it starts: Enter opens the options; → on the First step row changes the mode; the sentence follows.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(300);
  check('options open under the sentence', (await region.getByRole('radiogroup', { name: 'First step' }).count()) === 1);
  await shot(page, 'simple-options-open');
  check('no Folders row for a Develop card', !(await region.getByText('Folders', { exact: true }).isVisible().catch(() => false)));
  await page.keyboard.press('ArrowDown'); // Starts in
  await page.keyboard.press('ArrowDown'); // First step
  await page.keyboard.press('ArrowRight');
  await sleep(200);
  check('→ on First step changes the mode', /Ask before edits/.test(await region.locator('section', { hasText: 'Session settings' }).innerText()));
  await page.keyboard.press('ArrowLeft');
  await sleep(100);
  await page.keyboard.press('Escape'); // closes the options
  await sleep(200);
  check('Esc closes the options', (await region.getByRole('radiogroup', { name: 'First step' }).count()) === 0);

  // p: the preview shows the opening message, then the ticket in the hook's text.
  await page.keyboard.press('p');
  await sleep(300);
  const pre = (await region.locator('pre').allTextContents()).join('\n');
  check('preview holds the message and the ticket', /SHOP-155/.test(pre) && /round down/.test(pre));
  check('preview is in the order Claude gets it: the hook’s context, then the opening message', pre.indexOf('SHOP-155') < pre.indexOf('round down') && /1 · The context, first/i.test(await region.innerText()));
  await shot(page, 'simple-preview');
  const plegend = ((await page.locator('footer').count()) ? await page.locator('footer').innerText() : 'NO-LEGEND');
  check('preview legend is only Back and Start', /NO-LEGEND/.test(plegend) || /Back/.test(plegend) && !/options/.test(plegend), plegend.replace(/\n/g, ' '));
  await page.keyboard.press('p');
  await sleep(200);

  // ? lists the simple look's keys.
  await page.keyboard.press('Shift+Slash');
  await sleep(400);
  const help = page.locator('[role=dialog]');
  const helpText = await help.innerText();
  check('? has the simple look section', /simple look/i.test(helpText) && /Shift\+L/.test(helpText));
  await shot(page, 'help');
  await page.keyboard.press('Escape');
  await sleep(300);

  // Shift+L: the full look, with the same ticket and note.
  await page.keyboard.press('Shift+L');
  await sleep(600);
  const full = page.getByRole('region', { name: 'New card' });
  const fullText = await full.innerText();
  check('Shift+L shows the full three-panel screen with the same card', /How it starts/.test(fullText) && /What Claude will know/.test(fullText) && /SHOP-155/.test(fullText));
  check('full look kept the message', (await page.locator('#cp-msg').inputValue()) === 'The totals must round down.');
  await shot(page, 'full-look');
  await page.keyboard.press('Shift+L');
  await sleep(500);
  check('Shift+L back to the simple look', await page.getByText('What Claude can see').isVisible());

  // The legend shows the simple keys.
  const legend = ((await page.locator('footer').count()) ? await page.locator('footer').innerText() : 'NO-LEGEND');
  check('legend is the simple look’s', /NO-LEGEND/.test(legend) || /Preview/.test(legend) && /Full look/.test(legend) && !/Next panel/.test(legend), legend.replace(/\n/g, ' '));

  // Esc keeps the half-built card; c picks it up.
  await page.keyboard.press('Escape');
  await sleep(400);
  check('Esc leaves the screen', !(await region.isVisible().catch(() => false)));
  await page.keyboard.press('c');
  await sleep(400);
  check('c picks the card up again', /SHOP-155/.test(await page.getByRole('region', { name: 'New card' }).innerText()));
  await shot(page, 'picked-up');

  // The ? B settings row.
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.keyboard.press('Shift+Slash');
  await sleep(300);
  await page.keyboard.press('B');
  await sleep(400);
  const dlg = await page.locator('[role=dialog]').innerText();
  check('B has the new-card look row', /new-card screen/i.test(dlg) && /Simple/.test(dlg));
  await shot(page, 'settings');

  check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
