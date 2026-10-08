// The chat's scrolling (PLAN §130). This walk starts its own isolated server (PORT, default 7828, a
// fresh DB), seeds a working card in a Demo workspace and makes its session stream through
// perf.stream (made-up turns through the server's real path, no model), then checks on the open card:
// following the newest line while at the bottom; small scroll steps up (a trackpad, a smooth wheel)
// staying where they are while it streams; the ↓ over the box, counting Claude's new messages; the
// message box growing and shrinking (Ctrl+Shift+↑ / ↓, typed lines) keeping the chat's distance from
// the bottom; End and a click going back down and following again. Then the same in the full-screen
// session. Screenshots of the ↓ in light or dark. DARK=1 for dark mode.
// Run: pnpm exec vite build --outDir ../dist/web-test first.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const PORT = process.env.PORT || '7828';
const dark = process.env.DARK === '1';
const REPO = path.resolve(__dirname, '..', '..', '..').replace(/\\/g, '/');
const OUT = path.join(__dirname, dark ? 'shots-chat-scroll-dark' : 'shots-chat-scroll');
fs.mkdirSync(OUT, { recursive: true });
const TMP = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/');
const DEMO = `${TMP}/cc-demo`;
const DB = `${TMP}/cc-test-chat-scroll.db`;
const LOG = path.join(OUT, 'server.log');
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(100); } return false; };

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
const cardsNow = (page) => page.evaluate(() => new Promise((resolve) => {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'cards') { ws.close(); resolve(m.cards); } };
  setTimeout(() => { ws.close(); resolve([]); }, 3000);
}));

/** The scroller's numbers: how far from the bottom, where it is, how tall. */
const at = (page, sel) => page.evaluate((sel) => { const el = document.querySelector(sel); return { gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight), top: Math.round(el.scrollTop), h: el.clientHeight }; }, sel);
/** Sample while it streams: the largest gap from the bottom, and how far scrollTop moved. */
async function watch(page, sel, ms) {
  const s = [];
  const t = Date.now();
  while (Date.now() - t < ms) { s.push(await at(page, sel)); await sleep(80); }
  return { samples: s.map((x) => x.gap).join(' '), maxGap: Math.max(...s.map((x) => x.gap)), drift: Math.max(...s.map((x) => x.top)) - Math.min(...s.map((x) => x.top)), last: s.at(-1) };
}

async function suite(page, label, sel, stream) {
  // Before it streams, so nothing lands while it is measured: the message box taller and shorter
  // keeps the chat's distance from the bottom, scrolled up or at the bottom.
  if (label === 'card') {
    const box0 = await page.locator(sel).boundingBox();
    await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
    await page.mouse.wheel(0, -300);
    await sleep(300);
    for (const [dir, key] of [['taller', 'Control+Shift+ArrowUp'], ['shorter', 'Control+Shift+ArrowDown']]) {
      const a = await at(page, sel);
      await page.keyboard.press(key);
      await sleep(150);
      const b = await at(page, sel);
      check(`card, scrolled up: Ctrl+Shift+${dir === 'taller' ? '↑' : '↓'} makes the box ${dir}; the chat keeps its distance from the bottom`, b.h !== a.h && Math.abs(b.gap - a.gap) <= 2, `chat ${a.h} → ${b.h} px high, ${a.gap} → ${b.gap} px from the bottom`);
    }
    await page.locator('#card-say').focus();
    const a = await at(page, sel);
    await page.keyboard.type('one');
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Shift+Enter'); await page.keyboard.type('more'); }
    await sleep(150);
    const b = await at(page, sel);
    check('card, scrolled up: typing more lines grows the box; the chat keeps its distance from the bottom', b.h < a.h && Math.abs(b.gap - a.gap) <= 2, `chat ${a.h} → ${b.h} px, ${a.gap} → ${b.gap} px from the bottom`);
    await page.locator('#card-say').fill('');
    await sleep(150);
    const c = await at(page, sel);
    check('card, scrolled up: emptying the box shrinks it back; still the same distance', c.h === a.h && Math.abs(c.gap - a.gap) <= 2, `chat ${c.h} px, ${c.gap} px from the bottom`);
    await page.locator('#card-say').blur();
    await page.keyboard.press('End');
    await sleep(200);
    await page.keyboard.press('Control+Shift+ArrowUp'); await sleep(150);
    const g1 = await at(page, sel);
    await page.keyboard.press('Control+Shift+ArrowDown'); await sleep(150);
    const g2 = await at(page, sel);
    check('card, at the bottom: the box resized keeps the newest line in view', g1.gap <= 4 && g2.gap <= 4, `${g1.gap}, ${g2.gap} px`);
  }

  // Following while at the bottom.
  await stream();
  await sleep(1200);
  const follow = await watch(page, sel, 1500);
  check(`${label}: at the bottom, it follows Claude as it writes`, follow.maxGap <= 4, `largest gap ${follow.maxGap} px`);
  check(`${label}: no ↓ while it follows`, (await page.locator('[data-jump]').count()) === 0);

  // Small steps up, as a trackpad or a smooth wheel scrolls: they stay where they are.
  const box = await page.locator(sel).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -15); await sleep(40); }
  await sleep(300);
  const held = await watch(page, sel, 2000);
  check(`${label}: eight 15 px steps up stay put while it streams (it used to snap back)`, held.drift <= 1 && held.last.gap > 60, `moved ${held.drift} px, ${held.last.gap} px from the bottom`);
  check(`${label}: the ↓ shows while you are up`, await page.locator('[data-jump]').isVisible());

  // Reading further up: still put; a message that lands is counted on the ↓.
  await page.mouse.wheel(0, -400);
  await sleep(300);
  const before = (await at(page, sel)).top;
  const counted = await until(async () => /\d+ new message/.test(await page.locator('[data-jump]').innerText()), 9000);
  const jumpText = (await page.locator('[data-jump]').innerText()).replace(/\s+/g, ' ');
  check(`${label}: a message that lands while you read is counted on the ↓, and you stay put`, counted && Math.abs((await at(page, sel)).top - before) <= 1, jumpText);
  await shot(page, `${label.replace(/\W+/g, '-')}-jump`);

  // End: to the newest, following again.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('End');
  await sleep(300);
  const back = await watch(page, sel, 1500);
  check(`${label}: End goes to the newest and follows again; the ↓ goes`, back.maxGap <= 4 && (await page.locator('[data-jump]').count()) === 0, `largest gap ${back.maxGap} px (${back.samples})${(await page.locator('[data-jump]').count()) ? `, the ↓ still says ${(await page.locator('[data-jump]').innerText()).replace(/\s+/g, ' ')}` : ''}`);

  // A click on the ↓ does the same.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await until(() => page.locator('[data-jump]').isVisible(), 2000);
  await sleep(300);
  await page.locator('[data-jump]').click();
  await sleep(300);
  const clicked = await watch(page, sel, 1200);
  check(`${label}: a click on the ↓ does the same`, clicked.maxGap <= 4 && (await page.locator('[data-jump]').count()) === 0, `largest gap ${clicked.maxGap} px (${clicked.samples})`);

}

(async () => {
  startServer();
  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, colorScheme: dark ? 'dark' : 'light' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    check('the isolated server comes up', await until(async () => { await page.goto(`http://127.0.0.1:${PORT}/`); return true; }, 20000));
    await page.evaluate((dark) => { localStorage.setItem('cc-control.welcomed.v2', '1'); localStorage.removeItem('cc-control.sayHeight'); if (dark) localStorage.setItem('cc-control.theme', 'dark'); }, dark);
    await fire(page, { type: 'workspace.save', workspace: { id: 'ws-demo-scroll', name: 'Demo', color: 'teal', repos: [`${DEMO}/web-app`] } });
    const m = await ask(page, { type: 'cards.seed', options: { repos: [`${DEMO}/web-app`], workspaceId: 'ws-demo-scroll', key: 'SCROLL-1', state: 'working', title: 'Read while it streams', size: 60 } });
    const sid = (await cardsNow(page)).find((c) => c.id === m.id)?.sessionId;
    check('a seeded card streams through perf.stream', Boolean(sid), sid);
    // Short deltas so a message lands (every 400) within a few seconds.
    const stream = () => ask(page, { type: 'perf.stream', sessionIds: [sid], seconds: 40, deltaMs: 12 });
    await page.reload(); await sleep(900);
    await page.keyboard.press('1'); await sleep(300);
    await page.locator(`[id="card-${m.id}"]`).click();
    check('the card opens on its chat', await until(() => page.locator('[data-chat]').isVisible(), 5000));
    await suite(page, 'card', '[data-chat]', stream);

    // The full-screen session: its own scroller (#transcript), the same behaviour.
    await page.keyboard.press('Control+Enter');
    check('Ctrl+Enter opens its session full screen', await until(() => page.locator('#transcript').isVisible(), 5000));
    // Esc leaves the message box (as a person would), so End reaches the conversation.
    await page.keyboard.press('Escape'); await sleep(200);
    check('Esc leaves the box and the session stays open', await page.locator('#transcript').isVisible());
    await suite(page, 'full screen', '#transcript', stream);
    // The turn ends: the streamed text is swapped for the message. At the bottom, it stays there,
    // with no ↓ (the browser's scroll anchoring once moved it up here, which read as scrolling up).
    const ended = await until(async () => (await page.locator('[data-partial]').count()) === 0, 45000);
    await sleep(800);
    const end = await at(page, '#transcript');
    check('full screen: the turn ends at the bottom: it stays there, no ↓', ended && end.gap <= 4 && (await page.locator('[data-jump]').count()) === 0, `${end.gap} px from the bottom`);
    check('no errors on the page', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    check('the walk ran to the end', false, String(e).slice(0, 300));
  } finally {
    await browser.close();
    stopServer();
  }
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
