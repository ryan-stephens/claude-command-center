// The open card (PLAN §80, §81: direction F) on the isolated server at :7802: seeds a Demo lane and
// one card per state through cards.seed (no terminal tab, no Claude session), opens each, walks the
// dock's panels and the keys, and screenshots what it sees. DARK=1 for dark mode, W=900 for a narrow window.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const PORT = process.env.PORT || '7802';
const OUT = path.join(__dirname, process.env.DARK === '1' ? 'shots-card-dark' : process.env.W ? `shots-card-${process.env.W}` : 'shots-card');
fs.mkdirSync(OUT, { recursive: true });
const DEMO = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/') + '/cc-demo';
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; };

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
  await page.evaluate((dark) => { localStorage.setItem('cc-control.welcomed.v2', '1'); localStorage.removeItem('cc-control.seen'); if (dark) localStorage.setItem('cc-control.theme', 'dark'); }, dark);
  await page.evaluate(({ DEMO }) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'workspace.save', workspace: { id: 'ws-demo-simple', name: 'Demo', color: 'teal', repos: [`${DEMO}/web-app`, `${DEMO}/payments-api`], notes: 'Round money down, never to nearest.' } }));
      setTimeout(() => { ws.close(); resolve(); }, 600);
    };
  }), { DEMO });
  await page.reload();
  await sleep(800);

  // Earlier runs' cards go first, so the board holds one card per state.
  const old = await page.evaluate(() => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'cards') { ws.close(); resolve(m.cards.map((c) => c.id)); } };
    setTimeout(() => { ws.close(); resolve([]); }, 2000);
  }));
  for (const id of old) await page.evaluate((id) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify({ type: 'card.delete', id })); setTimeout(() => { ws.close(); resolve(); }, 150); }; }), id);

  // One card per state. Changes needs real folders: the demo repos themselves (web-app has uncommitted edits to show).
  const states = ['plan', 'tool', 'working', 'idle', 'done'];
  const ids = {};
  for (const [i, state] of states.entries()) {
    // The idle card has no channel (its tab closed, say): the message box stays and says what sending does (§85).
    const r = await ask(page, { type: 'cards.seed', options: { repos: [`${DEMO}/web-app`, `${DEMO}/payments-api`], workspaceId: 'ws-demo-simple', key: `SHOP-${150 + i}`, state, title: `${state[0].toUpperCase()}${state.slice(1)}: save cart for signed-out users`, ...(state === 'idle' ? { channel: false } : {}) } });
    ids[state] = r.id;
  }
  check('five cards seeded', Object.keys(ids).length === 5);
  await sleep(500);
  await page.keyboard.press('1');
  await sleep(400);
  await shot(page, 'board');

  const view = () => page.locator('section[aria-label^="SHOP-"]').first();
  const kcCount = async () => view().locator('.kc:visible').count();

  // The plan card: the chat is the page, the ask under it with y / n, the dock on the left, no panel open.
  await page.locator(`#card-${ids.plan}`).click();
  await sleep(800);
  check('plan: the card opens', await view().isVisible());
  const dockBox = await view().getByRole('button', { name: 'Back to the board' }).boundingBox();
  const viewBox = await view().boundingBox();
  check('the way back is at the top left of the dock', dockBox && viewBox && dockBox.x - viewBox.x < 20 && dockBox.y - viewBox.y < 20, JSON.stringify(dockBox));
  check('no panel open at first', (await view().getByRole('region').count()) === 0);
  check('the ask is under the chat with Approve', await view().getByRole('button', { name: /Approve/ }).isVisible());
  check('the plan text is in the chat', await view().getByText('Persist the guest cart to localStorage').first().isVisible().catch(() => false));
  check('no tabs', (await view().getByText('Overview').count()) === 0);
  console.log(`keycaps on the plan card: ${await kcCount()}`);
  await shot(page, 'plan-chat');

  // Shift+D: the Changes panel opens beside the dock, grouped by repo, with real git diffs from the demo repos.
  await page.keyboard.press('D');
  await sleep(1500);
  const changes = view().getByRole('region', { name: 'Changes' });
  check('Shift+D opens the Changes panel', await changes.isVisible());
  check('Changes groups by repo (web-app)', await changes.getByText('web-app', { exact: true }).first().isVisible().catch(() => false));
  const diffShown = await changes.locator('pre').count();
  check('the chosen file’s diff shows under it', diffShown >= 1);
  await shot(page, 'plan-changes');
  await page.keyboard.press('j');
  await sleep(200);
  const pressed = await changes.locator('button[aria-pressed="true"]').first().innerText().catch(() => '');
  check('j moves to the next file', pressed.length > 0, pressed.replace(/\n/g, ' '));
  // The panel's width (a wide window only: narrower, the panel lies over the chat): ] widens by 40px, the edge drags, and the width is remembered.
  if (Number(process.env.W || 1440) >= 1024) {
  const w0 = (await changes.boundingBox()).width;
  await page.keyboard.press(']');
  await sleep(150);
  const w1 = (await changes.boundingBox()).width;
  check('] widens the panel by 40px', Math.round(w1 - w0) === 40, `${w0} → ${w1}`);
  const handle = view().getByRole('separator', { name: 'Resize the panel' });
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 300);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 120, hb.y + 300, { steps: 6 });
  await page.mouse.up();
  await sleep(150);
  const w2 = (await changes.boundingBox()).width;
  check('dragging the edge widens it', Math.round(w2 - w1) === 120, `${w1} → ${w2}`);
  await shot(page, 'plan-changes-wider');
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  await sleep(150);
  check('[ narrows it back', Math.round((await changes.boundingBox()).width) === Math.round(w0), String((await changes.boundingBox()).width));
  check('the width is remembered', (await page.evaluate(() => localStorage.getItem('cc-control.panelWidth'))) === String(Math.round(w0)));
  }
  check('a Pop out link sits under the open diff', await changes.getByRole('button', { name: /Pop out/ }).isVisible());
  await page.keyboard.press('f');
  await sleep(600);
  const sheet = page.getByRole('dialog', { name: 'Changes' });
  check('f pops the Changes sheet out', await sheet.isVisible());
  const chosenInSheet = await sheet.locator('[role=option][aria-selected="true"]').innerText();
  check('the sheet opens on the file the panel had chosen (the second)', chosenInSheet.includes('dist/app.min.js'), chosenInSheet.replace(/\s+/g, ' '));
  await shot(page, 'plan-changes-full');
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Esc closes the sheet, the panel stays', await changes.isVisible());

  // The other dock keys.
  await page.keyboard.press('T');
  await sleep(300);
  check('Shift+T: Try it replaces Changes', await view().getByRole('region', { name: 'Try it' }).isVisible() && !(await changes.isVisible()));
  await shot(page, 'plan-try');
  // t on a lane of two repos with no stack yet (§86): the stack form opens filled from the repos, with Save and start; Esc leaves it.
  await page.keyboard.press('t');
  await sleep(1500);
  const setup = page.getByRole('dialog', { name: 'Set up the stack' });
  check('t with no stack opens the stack form, with Save and start', await setup.isVisible() && await setup.getByRole('button', { name: /Save and start/ }).isVisible());
  check('no “recipe” on the form', !/recipe/i.test(await setup.innerText()));
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Esc closes the form, the card stays open', !(await setup.isVisible().catch(() => false)) && await view().isVisible());
  await page.keyboard.press('C');
  await sleep(300);
  const ctx = view().getByRole('region', { name: 'Context' });
  check('Shift+C: Context, with what was added since', await ctx.isVisible() && await ctx.getByText('Round money down').isVisible());
  await shot(page, 'plan-context');
  // c: + Context is a popup over the chat (§88), the new-card screen's picker with a note; Ctrl+Enter adds, the card stays open.
  await page.keyboard.press('c');
  await sleep(500);
  const popup = page.getByRole('group', { name: 'Add context to SHOP-150' });
  check('c opens the Add context popup over the card', await popup.isVisible() && await view().isVisible() && (await page.getByText('Add context to a running card').count()) === 0);
  check('the card’s repos are marked as already there', (await popup.getByText('has it').count()) >= 1);
  await shot(page, 'plan-add-context');
  await popup.locator('#cp-note').fill('Round the fee down, never up');
  await page.keyboard.press('Control+Enter');
  await sleep(800);
  check('Ctrl+Enter adds the note and closes the popup', !(await popup.isVisible().catch(() => false)));
  check('the note waits under Added since', await until(async () => /Round the fee down, never up/.test(await view().getByRole('region', { name: 'Context' }).innerText()), 5000));
  await page.keyboard.press('c');
  await sleep(400);
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Esc on the popup goes back to the chat', (await page.getByRole('group', { name: 'Add context to SHOP-150' }).count()) === 0 && await view().isVisible());
  await page.keyboard.press('m');
  await sleep(300);
  const more = view().getByRole('region', { name: 'More' });
  check('m: More, with the steps and where it runs', await more.isVisible() && await more.getByText('Where it runs').isVisible());
  await shot(page, 'plan-more');
  await page.keyboard.press('v');
  await sleep(300);
  check('v: Verify', await view().getByRole('region', { name: 'Verify' }).isVisible());
  await page.keyboard.press('v');
  await sleep(300);
  check('v again closes it', (await view().getByRole('region').count()) === 0);

  // The panel stays open from card to card: open Changes, → to the next card, it is still open.
  await page.keyboard.press('D');
  await sleep(300);
  await page.keyboard.press('ArrowRight');
  await sleep(1200);
  check('→ opens the next card', /SHOP-151/.test(await view().getAttribute('aria-label')));
  check('the Changes panel stayed open', await view().getByRole('region', { name: 'Changes' }).isVisible());
  check('tool: the ask names the command with Allow', await view().getByRole('button', { name: /Allow/ }).isVisible());
  await shot(page, 'tool-changes');
  await page.keyboard.press('D');
  await sleep(300);

  // Working, idle, done: by their tiles (the board orders cards by column, so → from a Needs-you card goes to Try it).
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.locator(`#card-${ids.working}`).click();
  await sleep(900);
  check('working: nothing asked, the status line says what Claude is doing', (await view().getByRole('button', { name: /Allow|Approve/ }).count()) === 0 && await view().getByText('editing sign-in.ts').isVisible());
  await shot(page, 'working');
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.locator(`#card-${ids.idle}`).click();
  await sleep(900);
  check('idle: the Changes badge counts its files', /3/.test(await view().getByRole('button', { name: /Changes/ }).innerText()));
  check('idle, no channel: the message box stays, with Resume and send and a note', (await view().locator('#card-say').count()) === 1 && await view().getByRole('button', { name: /Resume and send/ }).isVisible() && /can’t be reached/.test(await view().getByRole('note').innerText()));
  await shot(page, 'idle');
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.locator(`#card-${ids.done}`).click();
  await sleep(900);
  check('done: the session ended, so the box says sending resumes it', /session ended/.test(await view().getByRole('note').innerText()));
  await page.keyboard.press('m');
  await sleep(300);
  check('done: More shows the merged PR', await view().getByRole('region', { name: 'More' }).getByRole('link', { name: /#418/ }).isVisible());
  await shot(page, 'done-more');
  await page.keyboard.press('m');

  // Back to the board with Esc, then reopen the plan card: the "new since you last looked" line is not there (nothing new).
  await page.keyboard.press('Escape');
  await sleep(400);
  check('Esc goes back to the board', !(await view().isVisible().catch(() => false)));
  await page.locator(`#card-${ids.plan}`).click();
  await sleep(700);
  check('reopened: no "new since" line when nothing changed', (await view().getByRole('separator', { name: 'New since you last looked' }).count()) === 0);
  await page.keyboard.press('Escape');
  await sleep(300);

  check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
