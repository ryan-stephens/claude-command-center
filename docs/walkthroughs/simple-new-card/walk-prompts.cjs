// The opening message and saved prompts (PLAN §62) on the simple new-card look, on the isolated
// server at :7802 (seeded by walk-simple.cjs). Picks a prompt, sees the ticket and repos filled in,
// adds a repo and a folder and sees the message follow, edits the text and sees it detach, saves it
// as a prompt, picks that, edits the list, and starts nothing.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const PORT = process.env.PORT || '7802';
const OUT = path.join(__dirname, 'shots-prompts');
fs.mkdirSync(OUT, { recursive: true });
const TEMP = (process.env.TEMP || process.env.TMP);
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
  const cardsBefore = await page.getByText(/^CARD-\d+$/).count();
  await page.keyboard.press('Shift+C'); // a fresh card
  await sleep(500);
  const region = page.getByRole('region', { name: 'New card' });
  const msg = page.locator('#cp-msg');
  const promptButton = region.getByRole('button', { name: /Prompt ·/ });

  // The popup uses the page: two columns at 1440, the message block beside the ticket.
  const box = await region.boundingBox();
  check('popup is inset about 16px', box && box.x <= 20 && box.width >= 1380, JSON.stringify(box));
  await page.locator('#cp-q').focus();
  await page.keyboard.type('SHOP-155');
  await sleep(700);
  await page.keyboard.press('Enter');
  await sleep(500);
  const ticketBox = await region.locator('section', { hasText: 'Ticket' }).first().boundingBox();
  const msgBox = await region.locator('section', { hasText: 'Opening message' }).first().boundingBox();
  check('two columns: the message block sits to the right of the ticket', ticketBox && msgBox && msgBox.x > ticketBox.x + ticketBox.width - 10, `${JSON.stringify(ticketBox)} ${JSON.stringify(msgBox)}`);
  check('the default message before a prompt is picked', /Plan SHOP-155/.test(await msg.inputValue()), await msg.inputValue());
  await shot(page, 'wide');

  // ↓ from the context row to the message; Space opens the saved prompts, Develop ones first.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await sleep(300);
  const list = region.getByRole('listbox', { name: 'Saved prompts' });
  check('Space opens the list of saved prompts', await list.isVisible());
  check('and nothing else: no context picker over it', (await region.getByRole('group').count()) === 0);
  const rows = await list.getByRole('option').allInnerTexts();
  check('Write your own first, then the Develop prompts, then QA', /Write your own/.test(rows[0]) && /Fix a bug/.test(rows[1]) && /Review and plan/.test(rows[2]) && /QA this change/.test(rows[3]), rows.join(' | ').replace(/\n/g, ' '));
  check('the row the keys are on is marked softly, not with the hard focus ring (§71)', (await list.locator('.is-focus').count()) === 0 && (await list.locator('[role=option][aria-selected=true]').count()) === 1);
  check('no tick yet: the default message is neither a prompt nor your own', (await list.locator('svg').count()) === 0);
  check('the control reads as a dropdown: expanded, with the chevron', (await promptButton.getAttribute('aria-expanded')) === 'true' && (await promptButton.locator('svg').count()) === 1);
  await shot(page, 'prompt-list');
  // A click outside the list closes it, like any dropdown; Space opens it again on the same row.
  await region.getByText('What Claude can see').click();
  await sleep(200);
  check('a click outside closes the list', !(await list.isVisible().catch(() => false)));
  await page.keyboard.press('ArrowDown'); // the click moved the block to the context row; ↓ is the message
  await page.keyboard.press('Space');
  await sleep(200);
  check('Space opens it again', await list.isVisible());
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(300);
  let text = await msg.inputValue();
  check('the prompt is filled in: ticket key and title', /SHOP-155 \(Save cart for signed-out users\)/.test(text), text.slice(0, 120));
  check('the lane repos, the home repo first', /these repos: web-app, payments-api\. Start in web-app\./.test(text), text);
  check('the branch', /on branch shop-155-/.test(text), text);
  check('the folders line is left out (no folders yet)', !/business logic/.test(text));
  check('the button names the prompt', /Review and plan/.test(await promptButton.innerText()) && !/Edited/.test(await promptButton.innerText()));
  check('the note says what was filled in and what is missing', /nothing yet for \{\{folders\}\}/.test(await region.locator('section', { hasText: 'Opening message' }).innerText()));
  await shot(page, 'prompt-picked');

  // Add a repo through + Context: the message follows.
  await page.keyboard.press('ArrowUp'); // context row
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight'); // to + Context
  await page.keyboard.press('Enter');
  await sleep(300);
  await page.keyboard.type('docs');
  await sleep(300);
  await page.keyboard.press('Enter');
  await sleep(400);
  text = await msg.inputValue();
  check('a repo added: the message now names docs-site', /web-app, payments-api, docs-site/.test(text), text);
  // A folder from disk, typed on the Folders tab: the folders line appears.
  await page.keyboard.press('Escape'); // leave the box
  await page.keyboard.press('ArrowRight'); // Folders tab
  await sleep(200);
  await page.keyboard.type(TEMP);
  await page.keyboard.press('Enter');
  await sleep(600);
  text = await msg.inputValue();
  check('a folder added: the folders line is back with its path', /business logic and other material is in .*Temp/i.test(text), text);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await sleep(300);
  check('the note no longer lists folders as missing', !/nothing yet for/.test(await region.locator('section', { hasText: 'Opening message' }).innerText()));
  await shot(page, 'follows-context');

  // Edit the text: it detaches; another context change leaves it alone.
  await page.keyboard.press('ArrowDown'); // message
  await page.keyboard.press('Enter');
  await sleep(150);
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Also check the cart.');
  await page.keyboard.press('Escape');
  await sleep(200);
  check('edited: the button says so', /Edited from: Review and plan/.test(await promptButton.innerText()), await promptButton.innerText());
  const edited = await msg.inputValue();
  await page.keyboard.press('ArrowUp'); // context
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter'); // leave web-app out
  await sleep(300);
  check('an edited message does not follow the card', (await msg.inputValue()) === edited);
  await page.keyboard.press('Enter'); // back in
  await sleep(200);
  await shot(page, 'edited');

  // Picking the prompt again re-renders it (the list opens on the prompt in use).
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await sleep(200);
  check('the list opens on the prompt in use', await list.getByRole('option', { selected: true }).innerText().then((t) => /Review and plan/.test(t)));
  await page.keyboard.press('Enter');
  await sleep(300);
  text = await msg.inputValue();
  check('picking the prompt again fills it in afresh', !/Also check the cart/.test(text) && /docs-site/.test(text) && /^Please review SHOP-155/.test(text), text.slice(0, 80));

  // s: save the (edited) message as a prompt; the card's values go back to placeholders.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Also check the cart.');
  await page.keyboard.press('Escape');
  await sleep(100);
  await page.keyboard.press('s');
  await sleep(400);
  const dlg = page.locator('[role=dialog]');
  check('s opens the prompt editor', await dlg.isVisible() && /New prompt/.test(await dlg.innerText()));
  const body = await dlg.locator('textarea').inputValue();
  check('the body has placeholders back in place of the card’s values', /\{\{tickets\}\}/.test(body) && /\{\{repos\}\}/.test(body) && /\{\{branch\}\}/.test(body) && /Also check the cart/.test(body) && !/SHOP-155/.test(body), body.slice(0, 160));
  check('the example beside it is rendered from this card', /SHOP-155/.test(await dlg.locator('pre').innerText()));
  await page.keyboard.type('My review');
  await shot(page, 'save-as-prompt');
  await page.keyboard.press('Control+Enter');
  await sleep(500);
  check('saved: the dialog closes', !(await dlg.isVisible().catch(() => false)));
  await page.keyboard.press('Space');
  await sleep(300);
  const rows2 = await list.getByRole('option').allInnerTexts();
  check('the new prompt is in the list, for any kind', rows2.some((r) => /My review/.test(r) && /any kind/.test(r)), rows2.join(' | ').replace(/\n/g, ' '));
  const at = rows2.findIndex((r) => /My review/.test(r));
  for (let i = 0; i < rows2.length; i++) await page.keyboard.press('ArrowUp'); // the list opens on the prompt in use
  for (let i = 0; i < at; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(300);
  check('the saved prompt renders back to the edited text', /SHOP-155/.test(await msg.inputValue()) && /Also check the cart/.test(await msg.inputValue()) && /My review/.test(await promptButton.innerText()));

  // Shift+E: the list; Delete twice removes the new one.
  await page.keyboard.press('Shift+E');
  await sleep(400);
  check('Shift+E opens the saved prompts', /Saved prompts/.test(await dlg.innerText()));
  await shot(page, 'prompts-dialog');
  const items = await dlg.getByRole('option').allInnerTexts();
  const mine = items.findIndex((r) => /My review/.test(r));
  for (let i = 0; i < mine; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Delete');
  await sleep(200);
  check('Delete asks again', /Delete again/.test(await dlg.innerText()));
  await page.keyboard.press('Delete');
  await sleep(500);
  check('Delete again removes it', !/My review/.test(await dlg.innerText()));
  // e opens the editor on a default; Esc comes back.
  await page.keyboard.press('e');
  await sleep(300);
  check('e opens the editor with the placeholder list', /Edit prompt/.test(await dlg.innerText()) && /\{\{tickets\}\}/.test(await dlg.innerText()));
  await shot(page, 'edit-prompt');
  await page.keyboard.press('Escape');
  await sleep(200);
  check('Esc goes back to the list', /Saved prompts/.test(await dlg.innerText()));
  await page.keyboard.press('Escape');
  await sleep(300);
  check('a deleted prompt leaves its text as the card’s own', /Your own/.test(await promptButton.innerText()) && /Also check the cart/.test(await msg.inputValue()));

  // ? lists the keys.
  await page.keyboard.press('Shift+Slash');
  await sleep(400);
  const help = await dlg.innerText();
  // The overlay draws the key part as keycaps, so match the descriptions.
  check('? has the message rows', /Pick a saved prompt/.test(help) && /Save the message as a new prompt/.test(help) && /Saved prompts: /.test(help), (help.match(/.{0,60}opening message.{0,60}/g) || ['(no "opening message" in the overlay)']).join(' | ').replace(/\n/g, ' '));
  await page.keyboard.press('Escape');
  await sleep(300);

  // One column under 1100px.
  await page.setViewportSize({ width: 1000, height: 950 });
  await sleep(300);
  const t2 = await region.locator('section', { hasText: 'Ticket' }).first().boundingBox();
  const m2 = await region.locator('section', { hasText: 'Opening message' }).first().boundingBox();
  check('one column at 1000px: the message block is under the ticket', t2 && m2 && Math.abs(m2.x - t2.x) < 5 && m2.y > t2.y, `${JSON.stringify(t2)} ${JSON.stringify(m2)}`);
  await shot(page, 'narrow');
  await page.setViewportSize({ width: 1440, height: 950 });

  // Esc: nothing started.
  await page.keyboard.press('Escape');
  await sleep(400);
  check('nothing was started', (await page.getByText(/^CARD-\d+$/).count()) === cardsBefore);
  check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
