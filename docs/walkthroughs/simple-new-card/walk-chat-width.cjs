// The card chat fits its column (PLAN §120) on an isolated server (PORT, default 7811): a seeded card
// whose transcript holds what is wider than the chat in real use (a 14-column table, a long code line,
// a long path and URL with no spaces, a long command and its output). At 1440 and 1024 px wide, with
// a panel open and not: nothing in the page scrolls sideways; the wide parts scroll inside themselves
// (the table, the code) or wrap (the path, the URL). DARK=1 for dark mode.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const PORT = process.env.PORT || '7811';
const dark = process.env.DARK === '1';
const OUT = path.join(__dirname, dark ? 'shots-chat-width-dark' : 'shots-chat-width');
fs.mkdirSync(OUT, { recursive: true });
const DEMO = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/') + '/cc-demo';
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(page, msg) {
  return page.evaluate((msg) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    const reqId = `w-${Math.random().toString(36).slice(2)}`;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.reqId !== reqId) return; ws.close(); if (m.type === 'error') reject(new Error(m.message)); else resolve(m); };
    ws.onopen = () => ws.send(JSON.stringify({ ...msg, reqId }));
    setTimeout(() => { ws.close(); reject(new Error('no answer')); }, 5000);
  }), msg);
}

/** What scrolls sideways: the page, the chat, and the widest element past the chat's right edge. */
const overflow = (page) => page.evaluate(() => {
  const chat = document.querySelector('[data-chat]');
  const doc = document.scrollingElement;
  const r = chat.getBoundingClientRect();
  let worst = null;
  for (const el of chat.querySelectorAll('*')) {
    const b = el.getBoundingClientRect();
    // Inside something that scrolls on its own (a code block, a table's box): that's its scroll, not the chat's.
    let p = el.parentElement, clipped = false;
    while (p && p !== chat) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX)) { clipped = true; break; } p = p.parentElement; }
    if (clipped) continue;
    const past = b.right - r.right;
    if (past > 1 && (!worst || past > worst.past)) worst = { past: Math.round(past), tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), text: (el.textContent || '').slice(0, 50) };
  }
  return { page: doc.scrollWidth - doc.clientWidth, chat: chat.scrollWidth - chat.clientWidth, worst };
});

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate((dark) => { localStorage.setItem('cc-control.welcomed.v2', '1'); if (dark) localStorage.setItem('cc-control.theme', 'dark'); }, dark);
  await page.evaluate((w) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify({ type: 'workspace.save', workspace: w })); setTimeout(() => { ws.close(); resolve(); }, 400); }; }),
    { id: 'ws-demo-wide', name: 'Wide', color: 'blue', repos: [`${DEMO}/web-app`], notes: '' });
  const card = await ask(page, { type: 'cards.seed', options: { repos: [`${DEMO}/web-app`], workspaceId: 'ws-demo-wide', key: 'WIDE-1', state: 'idle', title: 'A chat with wide things in it', wide: true } });
  await page.reload();
  await sleep(1000);
  await page.locator(`#card-${card.id}`).click();
  await sleep(1200);
  await page.locator('[data-chat]').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await sleep(300);
  for (const [w, panel] of [[1440, false], [1440, true], [1024, false], [1024, true]]) {
    await page.setViewportSize({ width: w, height: 900 });
    if (panel) { await page.keyboard.press('Shift+C'); await sleep(400); }
    await sleep(300);
    const o = await overflow(page);
    check(`${w} px${panel ? ', a panel open' : ''}: nothing scrolls sideways (page, chat), nothing pokes out of the chat`, o.page <= 0 && o.chat <= 0 && !o.worst, `page +${o.page}, chat +${o.chat}${o.worst ? `; widest past the edge by ${o.worst.past}: <${o.worst.tag} class="${o.worst.cls}"> ${o.worst.text}` : ''}`);
    await shot(page, `${w}${panel ? '-panel' : ''}`);
    if (panel) { await page.keyboard.press('Shift+C'); await sleep(300); }
  }
  // The wide parts stay readable: the table and the code scroll inside themselves.
  const inner = await page.evaluate(() => {
    const chat = document.querySelector('[data-chat]');
    const scrolls = (el) => { let p = el; while (p && p !== chat) { if (/(auto|scroll)/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth) return true; p = p.parentElement; } return false; };
    const table = chat.querySelector('table');
    const pre = [...chat.querySelectorAll('pre')].find((p) => p.textContent.includes('option29'));
    return { table: Boolean(table && scrolls(table)), pre: Boolean(pre && scrolls(pre)) };
  });
  check('the wide table and the long code line scroll inside themselves', inner.table && inner.pre, JSON.stringify(inner));
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ask(page, { type: 'card.delete', id: card.id }).catch(() => {});
  await browser.close();
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
