// The home page as Your Move (PLAN §126). This walk starts its own isolated server (PORT, default
// 7827, a fresh DB), seeds a Demo lane with eight cards through cards.seed (a plan, a tool, a
// question, two working, two finished, one done) and the demo tickets, and checks: the three bands
// by whose turn it is; a going round Your move; m and opening a card marking a finished turn seen,
// which leaves it Ready to try; l (looks good) parking it, with a glow as it moves; p (found a
// problem) sending what you saw as a reply (caught in the page, not sent);
// ← → on an open card keeping the order it was opened in; the arrows across bands; Done folding;
// the tickets strip (i folds it, v switches it); the digits still picking the lane; ? listing the
// new keys. Screenshots in light, dark and at 1024 px.
// Run: pnpm exec vite build --outDir ../dist/web-test first. DARK=1 for dark mode.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const PORT = process.env.PORT || '7827';
const dark = process.env.DARK === '1';
const REPO = path.resolve(__dirname, '..', '..', '..').replace(/\\/g, '/');
const OUT = path.join(__dirname, dark ? 'shots-your-move-dark' : 'shots-your-move');
fs.mkdirSync(OUT, { recursive: true });
const TMP = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/');
const DEMO = `${TMP}/cc-demo`;
const DB = `${TMP}/cc-test-your-move.db`;
const LOG = path.join(OUT, 'server.log');
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };

let server;
function startServer() {
  const env = { ...process.env, CC_CONTROL_PORT: PORT, CC_CONTROL_DB: DB, CC_CONTROL_MODEL: 'claude-haiku-4-5-20251001', CC_CONTROL_WEB_DIST: `${REPO}/dist/web-test` };
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, LOG]) fs.rmSync(f, { force: true });
  const out = fs.openSync(LOG, 'a');
  server = spawn(process.execPath, ['server/index.ts'], { cwd: REPO, env, stdio: ['ignore', out, out], windowsHide: true });
}
function stopServer() { if (server) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true }); }

async function ask(page, msg, ms = 10000) {
  return page.evaluate(({ msg, ms }) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    const reqId = `w-${Math.random().toString(36).slice(2)}`;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.reqId !== reqId) return; ws.close(); if (m.type === 'error') reject(new Error(m.message)); else resolve(m); };
    ws.onopen = () => ws.send(JSON.stringify({ ...msg, reqId }));
    setTimeout(() => { ws.close(); reject(new Error('no answer')); }, ms);
  }), { msg, ms });
}
const fire = (page, msg) => page.evaluate((msg) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify(msg)); setTimeout(() => { ws.close(); resolve(); }, 300); }; }), msg);

(async () => {
  startServer();
  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, colorScheme: dark ? 'dark' : 'light' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    check('the isolated server comes up', await until(async () => { await page.goto(`http://127.0.0.1:${PORT}/`); return true; }, 20000));
    await page.evaluate((dark) => { localStorage.setItem('cc-control.welcomed.v2', '1'); if (dark) localStorage.setItem('cc-control.theme', 'dark'); }, dark);
    await fire(page, { type: 'workspace.save', workspace: { id: 'ws-demo-move', name: 'Demo', color: 'teal', repos: [`${DEMO}/web-app`] } });
    await page.reload();
    await sleep(900);
    check('a browser with no record yet starts with one', await page.evaluate(() => localStorage.getItem('cc-control.seen.v1') !== null));

    // One per state, a little apart so the waits have an order: the plan has waited longest.
    const seeds = [['plan', 'Plan the saved-cart migration'], ['tool', 'Save cart for signed-out users'], ['working', 'Fix the login redirect loop'], ['idle', 'Cache headers on static assets'], ['done', 'Footer links open in a new tab'], ['question', 'Refund flow for partial orders'], ['working', 'Filters on the search page'], ['idle', 'A glossary page']];
    const ids = [];
    for (const [i, [state, title]] of seeds.entries()) {
      const r = await ask(page, { type: 'cards.seed', options: { repos: [`${DEMO}/web-app`], workspaceId: 'ws-demo-move', key: `MOVE-${10 + i}`, state, title } });
      ids.push(r.id);
      await sleep(150);
    }
    const [plan, tool, working, idle, done, question, working2, idle2] = ids;
    await sleep(600);
    await page.keyboard.press('1');
    await sleep(400);
    const band = (name) => page.locator(`section[aria-label="${name}"]`);
    const inBand = async (name, id) => (await band(name).locator(`[id="card-${id}"]`).count()) === 1;
    const count = (name) => band(name).locator('[id^="card-"]').count();
    check('Your move: the plan, the tool, the question and both finished turns', (await count('Your move')) === 5 && await inBand('Your move', plan) && await inBand('Your move', idle2), String(await count('Your move')));
    check('Claude’s move: the two working cards', (await count('Claude’s move')) === 2 && await inBand('Claude’s move', working));
    check('Parked is empty, and Done is folded with its one card', (await count('Parked')) === 0 && (await page.locator(`[id="card-${done}"]`).count()) === 0 && /Done\s*1/.test(await page.locator('[id="card-g:done"]').innerText()));
    const bandBody = (name) => band(name).evaluate((s) => s.children[1].getBoundingClientRect().height);
    const parkedEmpty = await bandBody('Parked');
    check('an empty band keeps one tile row of room (§128)', parkedEmpty >= 28, `Parked ${parkedEmpty} px`);
    check('the bar counts the bands', /5\s*your move/.test(await page.locator('body').innerText()) && /2\s*Claude working/.test(await page.locator('body').innerText()) && /0\s*parked/.test(await page.locator('body').innerText()));
    check('a finished turn shows what Claude said and m Seen', await band('Your move').getByRole('button', { name: /Seen/ }).first().isVisible());
    check('the tool asks with Allow / Deny on its tile', await band('Your move').getByRole('button', { name: /^y\s*Allow/ }).isVisible() && await band('Your move').getByRole('button', { name: /^n\s*Deny/ }).isVisible());
    const order = await band('Your move').locator('[id^="card-"]').evaluateAll((els) => els.map((e) => e.id.slice(5)));
    check('Your move is the longest wait first', order[0] === plan && order.indexOf(tool) < order.indexOf(question), order.map((id) => ids.indexOf(id)).join(','));
    await shot(page, 'home');

    // a goes round Your move in its order.
    const focused = () => page.evaluate(() => (document.querySelector('[id^="card-"].is-focus') ?? document.querySelector('.is-focus [id^="card-"]'))?.id.slice(5) ?? null);
    const a0 = await focused();
    await page.keyboard.press('a'); await sleep(150);
    const a1 = await focused();
    await page.keyboard.press('a'); await sleep(150);
    const a2 = await focused();
    check('the page arrives on the longest wait; a goes on to the next, and the next', a0 === order[0] && a1 === order[1] && a2 === order[2], `${ids.indexOf(a0)} → ${ids.indexOf(a1)} → ${ids.indexOf(a2)}`);

    // m on a finished turn: it leaves Your move for Parked.
    for (let i = 0; i < 6 && (await focused()) !== idle; i++) { await page.keyboard.press('a'); await sleep(120); }
    await page.keyboard.press('m'); await sleep(300);
    const tileText = (id) => page.locator(`[data-flip="${id}"]`).innerText();
    check('m marks a finished turn seen: it stays as Ready to try, with Looks good and Found a problem', await inBand('Your move', idle) && /Ready to try/.test(await tileText(idle)) && /Looks good/.test(await tileText(idle)) && /Found a problem/.test(await tileText(idle)));
    await shot(page, 'ready-to-try');

    // l: tried, looks good. It goes to Parked, and glows as it moves.
    await page.keyboard.press('l');
    const glowed = await until(async () => await inBand('Parked', idle) && await page.locator(`[data-flip="${idle}"]`).evaluate((el) => el.getAnimations().length > 0), 1500);
    check('l parks it, and it glows as it moves', glowed);
    check('the band is no taller with its chip than it was empty (§128)', Math.abs((await bandBody('Parked')) - parkedEmpty) <= 1, `${parkedEmpty} → ${await bandBody('Parked')} px`);
    check('the try is kept in this browser', await page.evaluate((id) => JSON.parse(localStorage.getItem('cc-control.tried.v1') || '{}')[id]?.ok === true, idle));

    // ↓ from Your move reaches Claude's move.
    await page.keyboard.press('a'); await sleep(150);
    for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowDown'); await sleep(120); if (await inBand('Claude’s move', await focused())) break; }
    check('↓ crosses from Your move into Claude’s move', await inBand('Claude’s move', await focused()), String(ids.indexOf(await focused())));

    // Open the first card that needs you; → walks the order it was opened in, even as the read turn leaves Your move.
    const openLabel = () => page.evaluate(() => document.querySelector('section[data-card]')?.getAttribute('aria-label') ?? '');
    const before = await band('Your move').locator('[id^="card-"]').evaluateAll((els) => els.map((e) => e.id.slice(5)));
    await page.locator(`[id="card-${before[0]}"]`).click(); await sleep(600);
    const seen = [];
    for (let i = 0; i < before.length; i++) {
      const label = await openLabel();
      seen.push(label.split(' ')[0]);
      await page.keyboard.press('ArrowRight'); await sleep(450);
    }
    const want = before.map((id) => `MOVE-${10 + ids.indexOf(id)}`);
    check('→ on an open card steps through Your move in order, skipping none', want.every((k, i) => seen[i] === k), `${seen.join(' ')} (wanted ${want.join(' ')})`);
    await page.keyboard.press('Escape'); await sleep(400);
    check('a finished turn you opened is seen: Ready to try now', await inBand('Your move', idle2) && /Ready to try/.test(await tileText(idle2)));

    // p: what went wrong, sent to the card's session as a reply. The page's message is caught before it leaves.
    await page.evaluate(() => {
      window.__sent = [];
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) { try { const m = JSON.parse(data); if (m.type === 'card.send') { window.__sent.push(m); return; } } catch { /* not ours */ } return send.call(this, data); };
    });
    for (let i = 0; i < 6 && (await focused()) !== idle2; i++) { await page.keyboard.press('a'); await sleep(120); }
    await page.keyboard.press('p'); await sleep(250);
    check('p opens the Found a problem box on the tile, focused', await page.evaluate(() => document.activeElement?.id === 'problem-say'));
    await page.keyboard.press('Escape'); await sleep(200);
    check('Esc closes it', (await page.locator('#problem-say').count()) === 0);
    await page.keyboard.press('p'); await sleep(250);
    await page.keyboard.type('the badge overlaps the header on small screens');
    await page.keyboard.press('Enter'); await sleep(300);
    const sent = await page.evaluate(() => window.__sent);
    check('Enter sends what you saw to its session', sent.length === 1 && sent[0].id === idle2 && sent[0].text === 'I tried it and found a problem: the badge overlaps the header on small screens', JSON.stringify(sent[0] ?? {}).slice(0, 160));
    check('…and the try is kept as a problem, so it leaves Your move', await page.evaluate((id) => JSON.parse(localStorage.getItem('cc-control.tried.v1') || '{}')[id]?.ok === false, idle2) && !(await inBand('Your move', idle2)));

    // Done opens and folds again.
    await page.locator('[id="card-g:done"]').click(); await sleep(250);
    check('Done opens on a click', (await page.locator(`[id="card-${done}"]`).count()) === 1);
    await page.keyboard.press('Enter'); await sleep(250);
    check('Enter on its header folds it', (await page.locator(`[id="card-${done}"]`).count()) === 0);

    // The digits: a lane, and nothing on a card without a plain question.
    await page.keyboard.press('0'); await sleep(250);
    check('0 shows every lane', await page.locator('button', { hasText: 'All' }).first().evaluate((el) => /ring/.test(el.className)));

    // Tickets to start: the demo tickets fill the strip; i folds it, v switches it.
    await fire(page, { type: 'tickets.demo', on: true });
    check('the tickets strip shows the demo tickets', await until(async () => /tickets? to start/.test(await band('Tickets to start').innerText()), 8000));
    const chips = await band('Tickets to start').locator('[id^="card-t:"]').count();
    check('…as chips', chips > 0, String(chips));
    await shot(page, 'tickets');
    await page.keyboard.press('i'); await sleep(250);
    check('i folds the strip', (await band('Tickets to start').locator('[id^="card-t:"]').count()) === 0);
    await page.keyboard.press('i'); await sleep(250);
    await page.keyboard.press('v'); await sleep(300);
    check('v switches to Ready for QA', /Ready for QA in your projects/.test(await band('Tickets to start').innerText()));
    await page.keyboard.press('v'); await sleep(300);

    // ? lists the new keys.
    await page.keyboard.press('Shift+Slash');
    const opened = await until(async () => /Every key/.test(await page.locator('body').innerText()), 4000);
    const help = await page.locator('body').innerText();
    const rows = [/The next card that needs you/, /Seen: a turn that finished/, /You tried its change/, /Fold or show the tickets to start/, /right on its tile/];
    check('? lists a, m, l / p, i and the answers on a tile', opened && rows.every((r) => r.test(help)), opened ? rows.filter((r) => !r.test(help)).join(' ') : 'the overlay didn’t open');
    await page.keyboard.press('Escape'); await sleep(300);

    await page.keyboard.press('1'); await sleep(300);
    await page.setViewportSize({ width: 1024, height: 800 });
    await sleep(300);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check('at 1024 px nothing scrolls sideways', wide);
    await shot(page, 'home-1024');
    check('no errors on the page', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    check('the walk ran to the end', false, String(e).split('\n')[0]);
  } finally {
    await browser.close();
    stopServer();
  }
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
