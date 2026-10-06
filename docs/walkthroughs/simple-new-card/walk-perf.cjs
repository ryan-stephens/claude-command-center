// The speed budget (PLAN §95, docs/prompts/continue-speed.md), measured and enforced. This walk starts
// its own isolated server (:7791, a fresh DB, Haiku), seeds 20 cards with 300-item transcripts in a
// Demo lane, and measures in the page: a key in the message box → painted (idle, and while three
// cards stream), ← / → and Enter → the card's chat on screen (cold and warm), the board while three
// sessions stream (long tasks, frames, WebSocket bytes), and on one real Haiku card: Ctrl+Enter →
// the card open, new card → first streamed text, Enter → the message in the chat, send → first
// text (and how much of it is ours), y → the tool ran, Ctrl+K → a session on screen, a server
// restart → the next message's first text. The streaming of the seeded cards is made up
// (`perf.stream`) but goes through the server's real path (SessionManager.feed, the card hooks).
// It prints every number against its budget and fails when one is over (--report: never fails).
// Run: node docs/walkthroughs/simple-new-card/walk-perf.cjs (pnpm exec vite build --outDir ../dist/web-test first).
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PORT = process.env.PORT || '7791';
const REPORT_ONLY = process.argv.includes('--report');
const SKIP_REAL = process.argv.includes('--no-real');
const OUT = path.join(__dirname, 'shots-perf');
fs.mkdirSync(OUT, { recursive: true });
const REPO = 'D:/repos/cc-control';
const TEMP = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/');
const DEMO = `${TEMP}/cc-demo`;
const HOME_REPO = `${DEMO}/docs-site`;
const SEED_REPO = `${DEMO}/web-app`;
const DB = `${TEMP}/cc-perf-walk.db`;
const LOG = path.join(OUT, 'server.log');
const MODEL = 'claude-haiku-4-5-20251001';
const SEEDS = 20;
const SIZE = 300;
const STREAMING = 3;

// The budget (ms), as continue-speed.md sets it.
const BUDGET = {
  keyPaint: 16, keyPaintStreaming: 16, switchWarm: 100, switchCold: 300, palette: 150, sendEcho: 50,
  sendOverhead: 100, yRan: 100, newCardOpen: 300, boardLongTask: 50, restartFirst: 2500,
};

const results = []; const numbers = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
/** A measured number against its budget: fails above it (unless --report). */
const measure = (name, value, budget, note = '') => {
  const ok = value !== null && value >= 0 && (budget === undefined || value <= budget);
  numbers.push({ name, value, budget, note });
  results.push([ok || REPORT_ONLY ? 'PASS' : 'FAIL', name, `${value} ms${budget !== undefined ? ` (budget ${budget})` : ''} ${note}`]);
  console.log(`${ok ? 'OK  ' : 'OVER'} ${name}: ${value === null ? '—' : `${Math.round(value)} ms`}${budget !== undefined ? ` / ${budget}` : ''} ${note}`);
};
const info = (name, value, note = '') => { numbers.push({ name, value, note }); console.log(`     ${name}: ${value} ${note}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, every = 250) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(every); } return false; };
const git = (...args) => spawnSync('git', ['-C', HOME_REPO, ...args], { encoding: 'utf8' });
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const median = (xs) => pct(xs, 0.5);
const max = (xs) => (xs.length ? Math.max(...xs) : null);
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);

// ---- The isolated server, started (and restarted) by the walk ----
let server = null;
function startServer() {
  const env = { ...process.env, CC_CONTROL_PORT: PORT, CC_CONTROL_DB: DB, CC_CONTROL_MODEL: MODEL, CC_CONTROL_WEB_DIST: `${REPO}/dist/web-test` };
  for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_)/.test(k)) delete env[k];
  const out = fs.openSync(LOG, 'a');
  server = spawn(process.execPath, ['server/index.ts'], { cwd: REPO, env, stdio: ['ignore', out, out], windowsHide: true });
  return until(async () => { try { return (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { return false; } }, 30000, 100);
}
function stopServer() {
  if (server) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
  server = null;
}
const logText = () => { try { return fs.readFileSync(LOG, 'utf8'); } catch { return ''; } };

// ---- In the page: byte counts, long tasks, frames, and key → on-screen timers ----
const INSTRUMENT = () => {
  const P = window.__perf = { bytes: 0, msgs: 0, byType: {}, long: [], frames: null };
  const Raw = window.WebSocket;
  window.__RawWS = Raw;
  window.WebSocket = class extends Raw {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (e) => {
        const n = typeof e.data === 'string' ? e.data.length : 0;
        P.bytes += n; P.msgs += 1;
        const type = /"type":"([^"]+)"/.exec(e.data.slice(0, 60))?.[1] ?? '?';
        const t = P.byType[type] ??= { n: 0, bytes: 0 };
        t.n += 1; t.bytes += n;
      });
    }
  };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push({ at: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* no longtask */ }
  /** After the frame that shows it: the next animation frame, then a task (the paint has happened by then). */
  const afterPaint = (fn) => requestAnimationFrame(() => { const c = new MessageChannel(); c.port1.onmessage = () => fn(performance.now()); c.port2.postMessage(0); });
  window.__afterPaint = afterPaint;
  /** Arm a timer: from the next keydown (its timestamp) to the frame where `ready()` first holds. */
  window.__arm = (ready) => {
    window.__res = undefined;
    const on = (e) => {
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      window.removeEventListener('keydown', on, true);
      const t0 = e.timeStamp;
      const tick = () => {
        let ok = false;
        try { ok = ready(); } catch { ok = false; }
        if (ok) afterPaint((t) => { window.__res = t - t0; });
        else if (performance.now() - t0 > 20000) window.__res = -1;
        else requestAnimationFrame(tick);
      };
      tick();
    };
    window.addEventListener('keydown', on, true);
  };
  /** Each key typed into a box: keydown → after the frame that paints it. */
  window.__typing = [];
  window.addEventListener('keydown', (e) => {
    if (!(e.target instanceof HTMLTextAreaElement) || e.key.length !== 1) return;
    const t0 = e.timeStamp;
    afterPaint((t) => window.__typing.push(t - t0));
  }, true);
  /** Frame gaps over a stretch of time. */
  window.__framesStart = () => {
    P.frames = []; let last = performance.now(); P.framesOn = true;
    const loop = (t) => { if (!P.framesOn) return; P.frames.push(t - last); last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  };
  window.__framesStop = () => { P.framesOn = false; return P.frames; };
};

/** A one-off request on its own socket (not counted with the app's traffic). */
async function ask(page, msg, timeout = 8000) {
  return page.evaluate(({ msg, timeout }) => new Promise((resolve, reject) => {
    const ws = new window.__RawWS(`ws://${location.host}/ws`);
    const reqId = `w-${Math.random().toString(36).slice(2)}`;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.reqId !== reqId) return; ws.close(); if (m.type === 'error') reject(new Error(m.message)); else resolve(m); };
    ws.onopen = () => ws.send(JSON.stringify({ ...msg, reqId }));
    setTimeout(() => { ws.close(); reject(new Error('no answer')); }, timeout);
  }), { msg, timeout });
}
const allCards = (page) => page.evaluate(() => new Promise((resolve) => {
  const ws = new window.__RawWS(`ws://${location.host}/ws`);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'cards') { ws.close(); resolve(m.cards); } };
  setTimeout(() => { ws.close(); resolve([]); }, 3000);
}));
const cardByKey = async (page, key) => (await allCards(page)).find((c) => c.key === key) ?? null;
const idle = async (page, key) => { const c = await cardByKey(page, key); return c?.live?.phase === 'waiting' || c?.live?.phase === 'needs'; };

/** Press a key with a timer armed for `ready` (a function source run in the page each frame). */
async function timedKey(page, key, ready, timeout = 20000) {
  await page.evaluate((src) => window.__arm(new Function(`return (${src})()`)), ready);
  await page.keyboard.press(key);
  await page.waitForFunction(() => window.__res !== undefined, null, { timeout });
  return page.evaluate(() => window.__res);
}
const openLabel = (page) => page.evaluate(() => document.querySelector('section[data-card]')?.getAttribute('aria-label') ?? null);
/** The open card is another than `from`, and its chat shows its transcript's last message. */
const chatOf = (from) => `() => { const s = document.querySelector('section[data-card]'); if (!s || s.getAttribute('aria-label') === ${JSON.stringify(from)}) return false; const md = s.querySelectorAll('[data-chat] .md'); const last = md[md.length - 1]; return Boolean(last && /Both apps are up|survives a closed tab/.test(last.textContent)); }`;

/** Open the card with this key: open any, then step ← and → through the board until it is the one. */
async function openByKey(page, key) {
  const re = new RegExp(`^${key} `);
  const on = async () => re.test(await openLabel(page) ?? '');
  if (!(await openLabel(page))) { await page.keyboard.press('Enter'); await sleep(400); }
  for (const dir of ['ArrowLeft', 'ArrowRight']) {
    for (let i = 0; i < 30 && !(await on()); i++) {
      const before = await openLabel(page);
      await page.keyboard.press(dir); await sleep(150);
      if ((await openLabel(page)) === before) break; // the end of the board
    }
  }
  return on();
}

/** The page's main thread: how busy it was over a window (CDP Performance metrics: TaskDuration is seconds of work). */
let cdp = null;
const heapMb = async () => Math.round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576);
const taskSecs = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;

async function wsWindow(page, fn) {
  const busy0 = await taskSecs();
  const before = await page.evaluate(() => ({ bytes: window.__perf.bytes, msgs: window.__perf.msgs, byType: JSON.parse(JSON.stringify(window.__perf.byType)), long: window.__perf.long.length }));
  const t0 = Date.now();
  await fn();
  const secs = (Date.now() - t0) / 1000;
  const cpu = Math.round(((await taskSecs()) - busy0) / secs * 100);
  const after = await page.evaluate(() => ({ bytes: window.__perf.bytes, msgs: window.__perf.msgs, byType: window.__perf.byType, long: window.__perf.long }));
  const byType = Object.entries(after.byType).map(([t, v]) => [t, v.n - (before.byType[t]?.n ?? 0), v.bytes - (before.byType[t]?.bytes ?? 0)]).filter((x) => x[1] > 0).sort((a, b) => b[2] - a[2]);
  console.log(`     (JS heap ${await heapMb()} MB)`);
  return { secs, cpu, bytesPerSec: Math.round((after.bytes - before.bytes) / secs), msgsPerSec: Math.round((after.msgs - before.msgs) / secs), byType, long: after.long.slice(before.long).map((l) => l.ms) };
}

(async () => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, LOG]) fs.rmSync(f, { force: true });
  const cleanCard = () => {
    git('worktree', 'remove', '--force', `${HOME_REPO}-card-1`);
    for (let i = 0; i < 10; i++) { try { fs.rmSync(`${HOME_REPO}-card-1`, { recursive: true, force: true }); break; } catch { spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500']); } }
    git('worktree', 'prune');
    git('branch', '-D', 'card-1-perf-walk-note');
  };
  cleanCard();
  check('the isolated server starts', await startServer());

  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: 'light' });
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();
  cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('crash', () => console.log(`!!! the page crashed (${new Date().toISOString()})`));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate(() => { localStorage.setItem('cc-control.welcomed.v2', '1'); localStorage.removeItem('cc-control.seen'); });
  await ask(page, { type: 'workspace.save', workspace: { id: 'ws-demo-perf', name: 'Demo', color: 'teal', repos: [HOME_REPO, SEED_REPO] } }).catch(() => {});
  await ask(page, { type: 'settings.set', settings: { newCardLook: 'full' } }).catch(() => {});
  await sleep(300);

  // ---- 20 seeded cards, 300 items each; three of them will stream ----
  const seeded = [];
  for (let i = 1; i <= SEEDS; i++) {
    const state = i <= STREAMING ? 'working' : 'idle';
    const m = await ask(page, { type: 'cards.seed', options: { repos: [SEED_REPO], workspaceId: 'ws-demo-perf', key: `PERF-${i}`, title: `Perf card ${i}`, state, size: SIZE } });
    seeded.push({ id: m.id, key: `PERF-${i}`, state });
  }
  const cardsNow = await allCards(page);
  for (const s of seeded) s.sessionId = cardsNow.find((c) => c.id === s.id)?.sessionId;
  check(`${SEEDS} cards seeded with ${SIZE}-item transcripts`, seeded.every((s) => s.sessionId));
  const streamers = seeded.filter((s) => s.state === 'working').map((s) => s.sessionId);

  await page.reload();
  await page.waitForFunction(() => window.__perf.msgs > 5);
  await sleep(800);
  info('page load: bytes over the WebSocket', await page.evaluate(() => window.__perf.bytes), `(${await page.evaluate(() => Object.entries(window.__perf.byType).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 4).map(([t, v]) => `${t} ${v.bytes}`).join(', '))})`);
  await page.keyboard.press('1');
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, '01-board.png') });

  // ---- The board while three sessions stream: long tasks, frames, bytes ----
  await page.keyboard.press('ArrowRight');
  await sleep(100);
  await ask(page, { type: 'perf.stream', sessionIds: streamers, seconds: 14 });
  await sleep(4000);
  await page.evaluate(() => window.__framesStart());
  const board = await wsWindow(page, async () => {
    const keys = ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'];
    for (let i = 0; i < 40; i++) { await page.keyboard.press(keys[i % keys.length]); await sleep(90); }
    await page.mouse.move(700, 500);
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, i % 2 ? -400 : 400); await sleep(80); }
  });
  const frames = await page.evaluate(() => window.__framesStop());
  info('board, 3 streaming: WebSocket bytes/s', board.bytesPerSec, `(main thread ${board.cpu}% busy; ${board.msgsPerSec} messages/s; ${board.byType.slice(0, 5).map(([t, n, b]) => `${t} ${n}×/${Math.round(b / 1024)}k`).join(', ')})`);
  info('board, 3 streaming: frames', `p50 ${r1(median(frames))} ms, p95 ${r1(pct(frames, 0.95))} ms, max ${r1(max(frames))} ms`, `(${frames.filter((f) => f > 34).length} of ${frames.length} over 34 ms)`);
  measure('board, 3 streaming: longest task', max(board.long) ?? 0, BUDGET.boardLongTask, `(${board.long.filter((l) => l > 50).length} long tasks)`);
  await sleep(6000);

  // ---- Opening and switching cards ----
  await page.keyboard.press('Escape');
  await sleep(200);
  const cold = []; const warm = [];
  let from = await openLabel(page);
  let t = await timedKey(page, 'Enter', chatOf(from));
  cold.push(t);
  const first = await openLabel(page);
  check('Enter opens a card on its chat', Boolean(first), first ?? '');
  await page.screenshot({ path: path.join(OUT, '02-card.png') });
  for (let i = 0; i < 5; i++) { from = await openLabel(page); cold.push(await timedKey(page, 'ArrowRight', chatOf(from))); await sleep(150); }
  for (let i = 0; i < 5; i++) { from = await openLabel(page); warm.push(await timedKey(page, 'ArrowLeft', chatOf(from))); await sleep(150); }
  const switchLong = await page.evaluate(() => window.__perf.long.map((l) => l.ms));
  measure(`Enter / → to a card, cold (${SIZE} items), median`, median(cold), BUDGET.switchCold, `(all: ${cold.map(Math.round).join(', ')})`);
  measure(`← to a card, warm (${SIZE} items), median`, median(warm), BUDGET.switchWarm, `(all: ${warm.map(Math.round).join(', ')})`);
  info('longest task so far', r1(max(switchLong)));

  // ---- A key in the message box → painted ----
  const typeInto = async (text) => {
    await page.evaluate(() => { window.__typing = []; });
    await page.locator('#card-say').focus();
    await page.keyboard.type(text, { delay: 45 });
    await sleep(200);
    const xs = await page.evaluate(() => window.__typing);
    await page.locator('#card-say').fill('');
    await page.locator('#card-say').blur();
    return xs;
  };
  const quiet = await typeInto('the quick brown fox jumps over the lazy dog');
  measure('a key in the message box → painted (nothing streaming), p95', r1(pct(quiet, 0.95)), BUDGET.keyPaint, `(median ${r1(median(quiet))}, max ${r1(max(quiet))})`);
  await ask(page, { type: 'perf.stream', sessionIds: streamers, seconds: 14 });
  await sleep(5000);
  const busy = await typeInto('the quick brown fox jumps over the lazy dog');
  measure('a key → painted, 3 other cards streaming, p95', r1(pct(busy, 0.95)), BUDGET.keyPaintStreaming, `(median ${r1(median(busy))}, max ${r1(max(busy))})`);
  await sleep(9500);
  // The open card itself streaming: step to PERF-1 (a streamer).
  await openByKey(page, 'PERF-1');
  check('PERF-1 (a streaming card) is open', /^PERF-1 /.test(await openLabel(page) ?? ''), await openLabel(page) ?? '');
  await ask(page, { type: 'perf.stream', sessionIds: streamers, seconds: 14 });
  await sleep(5000);
  let own;
  const openStream = await wsWindow(page, async () => { own = await typeInto('the quick brown fox jumps over the lazy dog'); });
  measure('a key → painted, the open card streaming, p95', r1(pct(own, 0.95)), BUDGET.keyPaintStreaming, `(median ${r1(median(own))}, max ${r1(max(own))})`);
  info('open card streaming: WebSocket bytes/s', openStream.bytesPerSec, `(main thread ${openStream.cpu}% busy; ${openStream.byType.slice(0, 4).map(([ty, n, b]) => `${ty} ${n}×/${Math.round(b / 1024)}k`).join(', ')})`);
  measure('open card streaming: longest task', max(openStream.long) ?? 0, BUDGET.boardLongTask, `(${openStream.long.filter((l) => l > 50).length} long tasks)`);
  await page.screenshot({ path: path.join(OUT, '03-streaming.png') });
  await sleep(9500);
  await page.keyboard.press('Escape');
  await sleep(200);

  if (!SKIP_REAL) {
    // ---- A real card: Ctrl+Enter, first text, y, send, Ctrl+K, restart ----
    console.log(`     (JS heap ${await heapMb()} MB before the real card)`);
    for (let i = 0; i < 4 && (await openLabel(page)); i++) { await page.keyboard.press('Escape'); await sleep(300); }
    check('back on the board before the new card', !(await openLabel(page)));
    await page.keyboard.press('Shift+C');
    await sleep(500);
    await page.locator('#cp-title').fill('Perf walk: a note');
    await page.locator('#cp-note').fill('This is a quick test. Plan: create NOTE.md containing the one line "Fast." Present that plan with ExitPlanMode straight away, without reading anything first. Once approved, only write the file: run no commands, and don’t commit.');
    await page.locator('#cp-msg').fill('Plan CARD-1.');
    await page.locator('#cp-title').focus();
    await page.screenshot({ path: path.join(OUT, '04-new-card.png') });
    await page.evaluate(() => { window.__partialAt = undefined; window.__t0 = undefined; const on = (e) => { if (e.key === 'Enter' && e.ctrlKey) { window.__t0 = e.timeStamp; window.removeEventListener('keydown', on, true); } }; window.addEventListener('keydown', on, true); clearInterval(window.__pw); window.__pw = setInterval(() => { if (window.__partialAt === undefined && document.querySelector('[data-partial]')) window.__partialAt = performance.now(); }, 10); });
    const tOpen = await timedKey(page, 'Control+Enter', `() => { const s = document.querySelector('section[aria-label^="CARD-1 "]'); return Boolean(s && s.querySelector('[data-chat]')); }`, 60000);
    measure('Ctrl+Enter on the new-card screen → the card open with its chat', tOpen, BUDGET.newCardOpen);
    await page.screenshot({ path: path.join(OUT, '05-new-card-open.png') });
    const firstText = await until(() => page.evaluate(() => window.__partialAt !== undefined), 120000, 100);
    const newFirst = firstText ? await page.evaluate(() => window.__partialAt - window.__t0) : null;
    info('new card → first streamed text', newFirst === null ? '—' : `${Math.round(newFirst)} ms`, '(API-bound; the server log has the CLI start)');
    const real = await cardByKey(page, 'CARD-1');
    const sid = real?.sessionId;
    const planUp = await until(async () => (await cardByKey(page, 'CARD-1'))?.live?.ask?.kind === 'plan', 180000, 1000);
    check('the real card presents its plan', planUp);
    await sleep(300);
    await page.keyboard.press('y');
    await until(async () => { const c = await cardByKey(page, 'CARD-1'); return c?.live?.ask?.kind === 'tool' || (c?.files ?? []).some((f) => /NOTE\.md$/i.test(f)); }, 120000, 1000);
    if ((await cardByKey(page, 'CARD-1'))?.live?.ask?.kind === 'tool') { await sleep(200); await page.keyboard.press('y'); }
    await until(async () => ((await cardByKey(page, 'CARD-1'))?.files ?? []).some((f) => /NOTE\.md$/i.test(f)), 60000, 1000);
    await until(() => idle(page, 'CARD-1'), 90000, 1000);
    for (let i = 0; i < 3 && (await cardByKey(page, 'CARD-1'))?.live?.ask?.kind === 'tool'; i++) { await page.keyboard.press('n'); await sleep(1500); await until(() => idle(page, 'CARD-1'), 60000, 1000); }
    const yLines = logText().split('\n').filter((l) => /send CARD-1: y → .* ran after/.test(l)).map((l) => Number(/after (\d+) ms/.exec(l)[1]));
    measure('y → the tool ran (ours, the plan approval)', yLines.length ? Math.min(...yLines) : null, BUDGET.yRan, `(all: ${yLines.join(', ')})`);

    // Send: Enter → the message in the chat; → first streamed text.
    const sendOnce = async (text, word) => {
      await page.locator('#card-say').focus();
      await page.keyboard.type(text);
      await page.evaluate(() => { window.__partialAt = undefined; window.__echoAt = undefined; window.__t0 = undefined; });
      await page.evaluate((text) => {
        window.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.__t0 = e.timeStamp; }, { capture: true, once: true });
        clearInterval(window.__pw);
        const look = () => {
          if (window.__t0 !== undefined) {
            const chat = document.querySelector('[data-chat]');
            if (window.__echoAt === undefined && chat && [...chat.querySelectorAll('.whitespace-pre-wrap')].some((e) => e.textContent === text)) window.__echoAt = performance.now();
            if (window.__partialAt === undefined && document.querySelector('[data-partial]')) window.__partialAt = performance.now();
          }
          if (window.__partialAt === undefined || window.__echoAt === undefined) requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      }, text);
      const logBefore = logText().length;
      await page.keyboard.press('Enter');
      await page.locator('#card-say').blur();
      await until(() => page.evaluate(() => window.__partialAt !== undefined && window.__echoAt !== undefined), 90000, 50);
      const r = await page.evaluate(() => ({ echo: window.__echoAt - window.__t0, partial: window.__partialAt - window.__t0 }));
      await until(() => idle(page, 'CARD-1'), 60000, 1000);
      const lines = logText().slice(logBefore);
      const into = Number(/send CARD-1: \d+ chars into the app session(?: in|, resumed in) (\d+) ms/.exec(lines)?.[1] ?? NaN);
      const serverPartial = Number(/send CARD-1: first partial after (\d+) ms/.exec(lines)?.[1] ?? NaN);
      void word;
      return { ...r, into, serverPartial };
    };
    const s1 = await sendOnce('Reply with one short sentence that ends with the word PERFWORD.', 'PERFWORD');
    measure('Enter (send) → your message in the chat', r1(s1.echo), BUDGET.sendEcho);
    info('send → first streamed text on the page', `${Math.round(s1.partial)} ms`, `(server: into the CLI ${s1.into} ms, first partial ${s1.serverPartial} ms)`);
    // Ours: the page's time less the model's (the server's first partial less the time to the CLI's input).
    measure('send → first text: our overhead on top of the model', Math.round(s1.partial - (s1.serverPartial - s1.into)), BUDGET.sendOverhead, '(page total − (server first partial − into the CLI))');

    // Ctrl+K → the card's session → on screen (warm: the page has its transcript).
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.keyboard.press('Control+k');
    await sleep(300);
    await page.keyboard.type('Plan CARD-1');
    await sleep(300);
    const tPal = await timedKey(page, 'Enter', `() => { const box = document.querySelector('textarea[aria-label="Message to Claude"]'); return Boolean(box && document.body.textContent.includes('PERFWORD')); }`);
    measure('Ctrl+K → a session picked → on screen (warm)', tPal, BUDGET.palette);
    await page.screenshot({ path: path.join(OUT, '06-palette-pick.png') });
    await page.keyboard.press('Escape');
    await sleep(300);

    // Restart → the next message's first text. Its session is stopped first, so its CLI closes its own
    // MCP servers (a killed tree leaves them running in the worktree, and the folder can't be removed).
    await ask(page, { type: 'session.stop', id: sid }).catch(() => {});
    await sleep(2000);
    stopServer();
    await sleep(800);
    check('the server restarts', await startServer());
    await page.waitForFunction(() => document.body.textContent.includes('CARD-1'), null, { timeout: 15000 }).catch(() => {});
    await sleep(1500);
    // Back on the board: open CARD-1 (it is the newest; step until it is open).
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await sleep(150); }
    await openByKey(page, 'CARD-1');
    check('CARD-1 is open after the restart', /^CARD-1 /.test(await openLabel(page) ?? ''), await openLabel(page) ?? '');
    const s2 = await sendOnce('Reply with exactly the word: again', 'again');
    measure('server restart → the next message’s first text', Math.round(s2.partial), BUDGET.restartFirst, `(resume ${s2.into} ms, server first partial ${s2.serverPartial} ms)`);
    check('the session is the same after the restart', (await cardByKey(page, 'CARD-1'))?.sessionId === sid);

    // A real session from this machine's history, opened cold (the server reads its transcript file): the slowest open there is.
    const hist = await page.evaluate(() => new Promise((resolve) => {
      const ws = new window.__RawWS(`ws://${location.host}/ws`);
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'sessions') { ws.close(); resolve(m.sessions.filter((x) => !x.live).slice(0, 8).map((x) => x.id)); } };
      setTimeout(() => { ws.close(); resolve([]); }, 5000);
    }));
    const opens = [];
    for (const id of hist) {
      const r = await page.evaluate((id) => new Promise((resolve) => {
        const ws = new window.__RawWS(`ws://${location.host}/ws`);
        let t0 = 0;
        ws.onopen = () => { t0 = performance.now(); ws.send(JSON.stringify({ type: 'session.open', id })); };
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'session.transcript' && m.id === id) { ws.close(); resolve({ ms: performance.now() - t0, items: m.items.length, bytes: ev.data.length }); } };
        setTimeout(() => { ws.close(); resolve(null); }, 15000);
      }), id);
      if (r) opens.push(r);
    }
    const big = opens.sort((a, b) => b.items - a.items)[0];
    if (big) info('a history session opened cold (server reads its file), the largest of 8 recent', `${Math.round(big.ms)} ms`, `(${big.items} items, ${Math.round(big.bytes / 1024)}k; all: ${opens.map((o) => `${o.items}/${Math.round(o.ms)}ms`).join(', ')})`);

    const removed = await ask(page, { type: 'card.removeWorktrees', id: real.id, force: true, thenDelete: true }, 30000).then(() => true, (e) => { console.log(`cleanup: ${e.message}`); return false; });
    if (!removed) { await sleep(3000); await ask(page, { type: 'card.removeWorktrees', id: real.id, force: true, thenDelete: true }, 30000).catch(() => {}); }
    check('the real card’s worktree is removed', !fs.existsSync(`${HOME_REPO}-card-1`) || !fs.readdirSync(`${HOME_REPO}-card-1`).length);
  }

  check('no errors on the page', errors.length === 0, errors.slice(0, 3).join(' | '));
  fs.writeFileSync(path.join(OUT, 'numbers.json'), JSON.stringify(numbers, null, 2));
  await browser.close();
  stopServer();
  if (!SKIP_REAL) cleanCard();
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); stopServer(); process.exit(2); });
