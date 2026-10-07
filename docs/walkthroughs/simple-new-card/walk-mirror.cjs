// A session open in a terminal, watched in the app (PLAN §119): does the page stay quick while the
// terminal writes? This walk starts its own isolated server (PORT, default 7810, a fresh DB). It
// copies a large transcript (TRANSCRIPT=<path to a .jsonl>, default the largest in ~/.claude/projects)
// to a throwaway session beside it (the same project folder, which is where its cwd says to look; a
// new id), opens it full screen, and measures:
// - typing in its message box (keydown → painted) with nothing writing, then while a stand-in
//   "terminal" appends an assistant message to its transcript every 150 ms;
// - what the server sends the page meanwhile (messages and bytes by type);
// - that each appended message shows up on the page.
// The copy is deleted at the end. Numbers only, no screenshots (the transcript is a real one).
// Run: pnpm exec vite build --outDir ../dist/web-test first. --report: print, never fail. --cpu=4: a slower laptop.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const PORT = process.env.PORT || '7810';
const REPORT = process.argv.includes('--report');
// --cpu=4: the page's CPU four times slower, as a slower laptop's (Chromium's throttling).
const CPU = Number((process.argv.find((a) => a.startsWith('--cpu=')) ?? '').slice(6)) || 1;
const REPO = path.resolve(__dirname, '..', '..', '..').replace(/\\/g, '/');
const TMP = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/');
const DB = `${TMP}/cc-test-mirror.db`;
const LOG = `${TMP}/cc-test-mirror.log`;
const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const BUDGET = { keyPaint: 16, transcriptBytesPerSec: 50_000 };
const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(200); } return false; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : -1; };
const r1 = (n) => Math.round(n * 10) / 10;

function largest() {
  let best = null;
  for (const d of fs.readdirSync(PROJECTS)) {
    const dir = path.join(PROJECTS, d);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => /^[0-9a-f-]{36}\.jsonl$/.test(f)); } catch { continue; }
    for (const f of files) { const p = path.join(dir, f); const size = fs.statSync(p).size; if (!best || size > best.size) best = { p, size }; }
  }
  return best.p;
}

let server;
function startServer() {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
  const out = fs.openSync(LOG, 'w');
  server = spawn(process.execPath, ['server/index.ts'], { cwd: REPO, env: { ...process.env, CC_CONTROL_PORT: PORT, CC_CONTROL_DB: DB, CC_CONTROL_WEB_DIST: `${REPO}/dist/web-test` }, stdio: ['ignore', out, out], windowsHide: true });
}
const stopServer = () => { if (server) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true }); };

(async () => {
  const src = process.env.TRANSCRIPT || largest();
  const oldId = path.basename(src, '.jsonl');
  const id = crypto.randomUUID();
  const MARK = `MIRRORPROBE${Math.floor(Math.random() * 1e6)}`;
  const file = path.join(path.dirname(src), `${id}.jsonl`);
  // The copy under a new id, with a first line whose text the palette can find.
  const text = fs.readFileSync(src, 'utf8').split(oldId).join(id);
  fs.writeFileSync(file, text);
  const lines = text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const lastChained = [...lines].reverse().find((l) => l.uuid && (l.type === 'assistant' || l.type === 'user'));
  const tmpl = [...lines].reverse().find((l) => l.type === 'assistant' && Array.isArray(l.message?.content));
  let parent = lastChained.uuid;
  let n = 0;
  const appendOne = () => {
    n += 1;
    const uuid = crypto.randomUUID();
    const line = { ...tmpl, parentUuid: parent, uuid, timestamp: new Date().toISOString(), message: { ...tmpl.message, id: `msg_probe_${n}`, content: [{ type: 'text', text: `${MARK} line ${n}: the terminal is still writing.` }] } };
    fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
    parent = uuid;
  };
  console.log(`     transcript: ${(fs.statSync(file).size / 1e6).toFixed(1)} MB, ${lines.length} lines (a copy, deleted at the end)`);
  startServer();
  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  let timer = null;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    if (CPU > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: CPU });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    check('the isolated server comes up', await until(async () => { await page.goto(`http://127.0.0.1:${PORT}/`); return true; }, 20000));
    await page.evaluate(() => localStorage.setItem('cc-control.welcomed.v2', '1'));
    // Count what arrives on the page's socket, by type.
    await page.addInitScript(() => {
      window.__ws = { msgs: 0, bytes: 0, byType: {} };
      const Orig = window.WebSocket;
      window.WebSocket = class extends Orig {
        constructor(...a) {
          super(...a);
          this.addEventListener('message', (e) => {
            const P = window.__ws; const b = e.data.length; P.msgs += 1; P.bytes += b;
            const type = /"type":"([^"]+)"/.exec(e.data.slice(0, 60))?.[1] ?? '?';
            const t = P.byType[type] ??= { n: 0, bytes: 0 }; t.n += 1; t.bytes += b;
          });
        }
      };
      window.__typing = [];
      const afterPaint = (fn) => requestAnimationFrame(() => { const c = new MessageChannel(); c.port1.onmessage = () => fn(performance.now()); c.port2.postMessage(0); });
      window.addEventListener('keydown', (e) => { if (!(e.target instanceof HTMLTextAreaElement) || e.key.length !== 1) return; const t0 = e.timeStamp; afterPaint((t) => window.__typing.push(t - t0)); }, true);
    });
    await page.reload();
    await sleep(1500);
    // Open it full screen through the palette, by its id's start (the palette searches ids too, else its title).
    const title = await page.evaluate((id) => new Promise((resolve) => {
      const ws = new WebSocket(`ws://${location.host}/ws`);
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'sessions') { const s = m.sessions.find((x) => x.id === id); if (s) { ws.close(); resolve(s.title); } } };
      setTimeout(() => { ws.close(); resolve(null); }, 8000);
    }), id);
    check('the copied session is in the list', Boolean(title), String(title).slice(0, 60));
    await page.keyboard.press('Control+k');
    await sleep(300);
    await page.keyboard.type(String(title).slice(0, 40));
    await sleep(400);
    await page.keyboard.press('Enter');
    const box = page.locator('textarea[aria-label="Message to Claude"]');
    check('it opens full screen', await until(async () => (await box.count()) === 1, 10000));
    await sleep(2500);
    const type = async () => {
      await page.evaluate(() => { window.__typing = []; });
      await box.focus();
      await page.keyboard.type('the quick brown fox jumps over the lazy dog again', { delay: 45 });
      await sleep(250);
      const t = await page.evaluate(() => window.__typing);
      await box.fill('');
      await box.blur();
      return t;
    };
    const quiet = await type();
    console.log(`     typing, nothing writing: p95 ${r1(pct(quiet, 0.95))} ms (median ${r1(pct(quiet, 0.5))}, max ${r1(Math.max(...quiet))}, ${quiet.length} keys)`);
    // The terminal writes: a message every 150 ms.
    await page.evaluate(() => { window.__ws = { msgs: 0, bytes: 0, byType: {} }; });
    const t0 = Date.now();
    timer = setInterval(appendOne, 150);
    await sleep(2000);
    const busy = await type();
    await sleep(3000);
    clearInterval(timer); timer = null;
    const secs = (Date.now() - t0) / 1000;
    const ws = await page.evaluate(() => window.__ws);
    const shown = await until(async () => (await page.getByText(`${MARK} line ${n}:`).count()) > 0, 10000);
    console.log(`     typing, the terminal writing: p95 ${r1(pct(busy, 0.95))} ms (median ${r1(pct(busy, 0.5))}, max ${r1(Math.max(...busy))}, ${busy.length} keys)`);
    console.log(`     the page received ${ws.msgs} messages, ${(ws.bytes / 1e6).toFixed(2)} MB in ${secs.toFixed(1)} s: ${Object.entries(ws.byType).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 5).map(([k, v]) => `${k} ${v.n}×/${Math.round(v.bytes / 1000)}k`).join(', ')}`);
    const tBytes = (ws.byType['session.transcript']?.bytes ?? 0) / secs;
    check(`a key → painted while the terminal writes, p95 within ${BUDGET.keyPaint} ms`, pct(busy, 0.95) <= BUDGET.keyPaint || REPORT, `${r1(pct(busy, 0.95))} ms`);
    check(`what the page is sent for the transcript stays small (≤ ${BUDGET.transcriptBytesPerSec / 1000}k/s)`, tBytes <= BUDGET.transcriptBytesPerSec || REPORT, `${Math.round(tBytes / 1000)}k/s`);
    check('the session list isn’t re-sent while only its transcript grows', (ws.byType.sessions?.n ?? 0) <= 1 || REPORT, `${ws.byType.sessions?.n ?? 0} sessions messages`);
    check('every message the terminal wrote shows on the page', shown, `${n} written`);
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    if (timer) clearInterval(timer);
    await browser.close();
    stopServer();
    await sleep(500);
    fs.rmSync(file, { force: true });
    for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
  }
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); stopServer(); process.exit(1); });
