// The hub, for real (PLAN §93): a card's session runs in the app. This walk starts its own isolated
// server (:7788, a fresh DB, Haiku), makes a card from the new-card screen (not seeded) in a Demo
// lane of docs-site, and then: the plan is approved with y; the reply streams in (a partial on the
// page before the message lands); a second message is answered; a tool prompt is answered with y;
// Claude's question form is answered with a digit and y; Esc stops a turn mid-way; the card is
// closed and opened again with its transcript; the server is restarted and the next message
// resumes the session. Screenshots in light and dark. No terminal tab opens at any point.
// Run: node docs/walkthroughs/simple-new-card/walk-hub.cjs (pnpm exec vite build --outDir ../dist/web-test first).
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PORT = process.env.PORT || '7788';
const OUT = path.join(__dirname, 'shots-hub');
fs.mkdirSync(OUT, { recursive: true });
const REPO = 'D:/repos/cc-control';
const TEMP = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/');
const DEMO = `${TEMP}/cc-demo`;
const HOME_REPO = `${DEMO}/docs-site`;
const DB = `${TEMP}/cc-hub-walk.db`;
const LOG = path.join(OUT, 'server.log');
const MODEL = 'claude-haiku-4-5-20251001';
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, every = 250) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(every); } return false; };
const git = (...args) => spawnSync('git', ['-C', HOME_REPO, ...args], { encoding: 'utf8' });

// ---- The isolated server, started (and restarted) by the walk ----
let server = null;
function startServer() {
  const env = { ...process.env, CC_CONTROL_PORT: PORT, CC_CONTROL_DB: DB, CC_CONTROL_MODEL: MODEL, CC_CONTROL_WEB_DIST: `${REPO}/dist/web-test` };
  for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_)/.test(k)) delete env[k];
  const out = fs.openSync(LOG, 'a');
  server = spawn(process.execPath, ['server/index.ts'], { cwd: REPO, env, stdio: ['ignore', out, out], windowsHide: true });
  return until(async () => { try { return (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { return false; } }, 30000, 300);
}
function stopServer() {
  // The whole tree: the server and the Claude Code processes its sessions run in.
  if (server) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
  server = null;
}
const logText = () => { try { return fs.readFileSync(LOG, 'utf8'); } catch { return ''; } };

async function ask(page, msg, timeout = 8000) {
  return page.evaluate(({ msg, timeout }) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    const reqId = `w-${Math.random().toString(36).slice(2)}`;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.reqId !== reqId) return; ws.close(); if (m.type === 'error') reject(new Error(m.message)); else resolve(m); };
    ws.onopen = () => ws.send(JSON.stringify({ ...msg, reqId }));
    setTimeout(() => { ws.close(); reject(new Error('no answer')); }, timeout);
  }), { msg, timeout });
}
const cardNow = (page) => page.evaluate(() => new Promise((resolve) => {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'cards') { ws.close(); resolve(m.cards[0] ?? null); } };
  setTimeout(() => { ws.close(); resolve(null); }, 3000);
}));
/** The session's transcript as the page's store has it (the open card reads the same). */
const items = (page, sid) => page.evaluate((sid) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'session.open', id: sid }));
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'session.transcript' && m.id === sid) { ws.close(); resolve(m.items); } };
  setTimeout(() => { ws.close(); resolve([]); }, 5000);
}), sid);
const lastAssistant = async (page, sid) => ((await items(page, sid)).filter((i) => i.kind === 'assistant').at(-1) ?? {}).text ?? '';

/** Type into the open card's message box and send it with Enter. */
/** A square PNG of one colour, made here (§116): what the walk sends Claude to look at. */
function solidPng(size, [r, g, b]) {
  const zlib = require('node:zlib');
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).map((_, i) => [r, g, b][i % 3])]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(size).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

async function say(page, text) {
  await page.locator('#card-say').focus();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.locator('#card-say').blur();
}
/** Watch for a streaming partial on the page from now on. */
const watchPartial = (page) => page.evaluate(() => { window.__sawPartial = false; clearInterval(window.__pw); window.__pw = setInterval(() => { if (document.querySelector('[data-partial]')) window.__sawPartial = true; }, 30); });
const sawPartial = (page) => page.evaluate(() => window.__sawPartial === true);
const idle = async (page) => { const c = await cardNow(page); return c?.live?.phase === 'waiting' || c?.live?.phase === 'needs'; };

(async () => {
  // A clean start: no DB, no leftover worktree from an earlier run, no tab titles to find.
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, LOG]) fs.rmSync(f, { force: true });
  git('worktree', 'remove', '--force', `${HOME_REPO}-card-1`);
  // A folder an earlier run couldn't remove (a process still worked in it) is this walk's own.
  fs.rmSync(`${HOME_REPO}-card-1`, { recursive: true, force: true });
  git('worktree', 'prune');
  git('branch', '-D', 'card-1-hub-walk-contributing-note');
  check('the isolated server starts', await startServer());

  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, colorScheme: 'light' });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate(() => { localStorage.setItem('cc-control.welcomed.v2', '1'); localStorage.removeItem('cc-control.seen'); });
  await page.evaluate(({ HOME_REPO }) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'workspace.save', workspace: { id: 'ws-demo-hub', name: 'Demo', color: 'teal', repos: [HOME_REPO] } }));
      ws.send(JSON.stringify({ type: 'settings.set', settings: { newCardLook: 'full' } }));
      setTimeout(() => { ws.close(); resolve(); }, 800);
    };
  }), { HOME_REPO });
  await page.reload();
  await sleep(1000);
  await page.keyboard.press('1');
  await sleep(200);

  // ---- A card from the new-card screen ----
  await page.keyboard.press('c');
  await sleep(500);
  await page.locator('#cp-title').fill('Hub walk: contributing note');
  await page.locator('#cp-note').fill('This is a quick test. Plan: create CONTRIBUTING.md containing the one line "Be kind." Present that plan with ExitPlanMode straight away, without reading anything first. Once approved, only write the file: run no commands, and don’t commit.');
  await page.locator('#cp-msg').fill('Plan CARD-1.');
  const what = await page.getByText('What happens').locator('..').innerText();
  check('the new-card screen says Claude starts in the app, not a tab', /claude in the app/.test(what) && !/wt -w 0/.test(what), what.replace(/\n/g, ' | ').slice(0, 160));
  await shot(page, 'new-card');
  await page.locator('#cp-title').focus();
  const t0 = Date.now();
  await page.keyboard.press('Control+Enter');
  const started = await until(async () => Boolean((await cardNow(page))?.sessionId), 30000);
  const card0 = await cardNow(page);
  check('Ctrl+Enter starts the card with its session linked at once', started && card0?.runner === 'app', `${Date.now() - t0} ms, ${card0?.sessionId}`);
  const sid = card0.sessionId;
  check('no terminal tab and no channel: the boot lines say the app', card0.boot.some((b) => /Started Claude in the app/.test(b.text)) && !card0.boot.some((b) => /Windows Terminal/.test(b.text)), card0.boot.map((b) => b.text).join(' | '));
  const view = page.locator(`section[aria-label^="CARD-1"]`).first();
  check('the card opens on its chat', await view.isVisible());
  await watchPartial(page);

  // ---- The plan ----
  const planUp = await until(async () => (await cardNow(page))?.live?.ask?.kind === 'plan', 180000, 500);
  const planCard = await cardNow(page);
  check('Claude presents its plan; the card asks with a request id', planUp && Boolean(planCard?.live?.ask?.requestId), planCard?.live?.text);
  check('the plan streamed in first (a partial was on the page)', await sawPartial(page));
  check('the card is in Plan, amber Needs you on the page', planCard?.stage === 'plan' && await view.getByText('Approve the plan?').isVisible());
  await sleep(500);
  await shot(page, 'plan');
  await page.emulateMedia({ colorScheme: 'dark' });
  await sleep(300);
  await shot(page, 'plan-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  const ty = Date.now();
  await page.keyboard.press('y');
  const built = await until(async () => { const c = await cardNow(page); return (c?.files ?? []).some((f) => /CONTRIBUTING\.md$/i.test(f)); }, 120000, 500);
  check('y approves it: Claude writes CONTRIBUTING.md in the card’s worktree', built, `${Date.now() - ty} ms`);
  await until(() => idle(page), 90000, 500);
  // Haiku sometimes asks to commit anyway: n keeps the walk on its script (and shows n works).
  for (let i = 0; i < 3 && (await cardNow(page))?.live?.ask?.kind === 'tool'; i++) {
    console.log(`(stray ask: ${(await cardNow(page)).live.text}; n)`);
    await page.keyboard.press('n');
    await sleep(1500);
    await until(() => idle(page), 60000, 500);
  }
  const afterPlan = await cardNow(page);
  check('the turn ends and the card moves to Try it', afterPlan?.stage === 'try', `${afterPlan?.stage}: ${afterPlan?.live?.text}`);
  await shot(page, 'built');

  // ---- A second message, streamed ----
  await watchPartial(page);
  await say(page, 'Write three short sentences about why kindness matters, then end with the word pong.');
  const ponged = await until(async () => /pong/i.test(await lastAssistant(page, sid)), 60000, 300);
  check('Enter sends at once and the reply arrives', ponged, await lastAssistant(page, sid));
  check('the reply streamed in (a partial was on the page)', await sawPartial(page));
  await until(() => idle(page), 30000);
  // §115: the chat's header meters the session: its branch, the context window used, and the cost so far.
  const meter = view.locator('[data-meter]').first();
  const metered = await until(async () => (await meter.locator('[data-meter-ctx]').count()) > 0 && (await meter.locator('[data-meter-cost]').count()) > 0, 15000, 300);
  const meterText = metered ? (await meter.innerText()).replace(/\s+/g, ' ') : '';
  check('the chat header shows the branch, context used (tokens / window · %) and cost', metered && /card-1/.test(meterText) && /\d+(\.\d)?k \/ \d+(\.\d)?[kM] · \d+%/.test(meterText) && /\$\d+\.\d\d|<\$0\.01/.test(meterText), meterText);

  // ---- §129: the mode on the open card: a chip in the header, Shift+Tab switches it, Auto is skipped on Haiku ----
  const chip = view.locator('[data-mode]').first();
  const modeNow = () => chip.getAttribute('data-mode');
  const m0 = await modeNow();
  check('the chat header shows the session’s mode (Asks first after an approved plan)', m0 === 'default' && /Asks first/.test(await chip.innerText()), String(m0));
  await page.evaluate(() => document.activeElement?.blur());
  await chip.screenshot({ path: path.join(OUT, 'mode-chip.png') }).catch(() => {});
  await page.emulateMedia({ colorScheme: 'dark' });
  await view.locator('[data-meter]').first().locator('xpath=..').screenshot({ path: path.join(OUT, 'mode-header-dark.png') }).catch(() => {});
  await page.emulateMedia({ colorScheme: 'light' });
  await view.locator('[data-meter]').first().locator('xpath=..').screenshot({ path: path.join(OUT, 'mode-header.png') }).catch(() => {});
  await page.keyboard.press('Shift+Tab');
  check('Shift+Tab on the open card: Accepts edits, as the session reports it', await until(async () => (await modeNow()) === 'acceptEdits', 5000, 100), String(await modeNow()));
  await page.locator('#card-say').focus();
  await page.keyboard.press('Shift+Tab');
  const inBox = await page.evaluate(() => document.activeElement?.id === 'card-say');
  check('Shift+Tab in the message box too: Plan first, and the box keeps the focus', await until(async () => (await modeNow()) === 'plan', 5000, 100) && inBox, String(await modeNow()));
  await page.keyboard.press('Shift+Tab');
  const skipped = await until(async () => /Auto isn’t offered on Haiku/.test(await page.locator('body').innerText()), 3000, 100);
  check('on Haiku the cycle goes past Auto, back to Asks first, and says so', await until(async () => (await modeNow()) === 'default', 5000, 100) && skipped, String(await modeNow()));
  await page.locator('#card-say').blur();

  // ---- §116: a picture in the card chat ----
  const red = path.join(OUT, 'red.png');
  fs.writeFileSync(red, solidPng(48, [220, 20, 20]));
  // Ctrl+V of a screenshot into the box: a thumbnail over it; Backspace in the empty box takes it out.
  await page.locator('#card-say').focus();
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
    document.getElementById('card-say').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, fs.readFileSync(red).toString('base64'));
  const thumbs = view.getByLabel('Images to send').locator('img');
  check('Ctrl+V of an image in the message box puts a thumbnail over it', await until(async () => (await thumbs.count()) === 1, 3000, 100));
  await page.keyboard.press('Backspace');
  check('Backspace in the empty box takes it back out', await until(async () => (await thumbs.count()) === 0, 3000, 100));
  await page.locator('#card-say').blur();
  // Shift+I opens the picker; the image goes with the next message, and Claude sees it.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.keyboard.press('Shift+I')]);
  await chooser.setFiles(red);
  check('Shift+I picks an image: its thumbnail shows', await until(async () => (await thumbs.count()) === 1, 3000, 100));
  await shot(page, 'image-attached');
  await say(page, 'What single colour fills the attached image? Reply with just that colour word.');
  check('the box empties, the image with it', await until(async () => (await thumbs.count()) === 0, 3000, 100));
  const sawRed = await until(async () => /\bred\b/i.test(await lastAssistant(page, sid)), 60000, 300);
  check('Claude sees the image: it answers red', sawRed, await lastAssistant(page, sid));
  await until(() => idle(page), 30000);

  // ---- §117: Try it's output is the card's Claude's to read ----
  const mark = `LOGMARK-${Math.floor(1000 + Math.random() * 9000)}`;
  const app = path.join(OUT, 'logmark-app.cjs');
  fs.writeFileSync(app, `require('http').createServer((q,r)=>r.end('ok')).listen(18997,()=>{console.log('Local: http://localhost:18997/');console.log('${mark} the app is up');});`);
  await ask(page, { type: 'recipe.save', repo: HOME_REPO, steps: [`node "${app.replace(/\\/g, '/')}"`], url: 'http://localhost:18997' });
  await page.locator('#card-say').blur().catch(() => {});
  await page.keyboard.press('t');
  const logFile = path.join(DB, '..', 'runs', 'logs', 'CARD-1', 'app.log');
  const logged = await until(async () => fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf8').includes(mark), 30000, 300);
  check('Try it writes the app’s output to the card’s logs folder', logged, logFile);
  await say(page, 'Look in this card’s Try it logs: what LOGMARK value does the app’s log show? Reply with just that value.');
  let askedLogs = false;
  const readIt = await until(async () => {
    const c = await cardNow(page);
    if (c?.live?.ask && !askedLogs) { askedLogs = true; await page.keyboard.press('y'); }
    return (await lastAssistant(page, sid)).includes(mark);
  }, 90000, 400);
  check('Claude reads the log without being given it, and without asking first', readIt && !askedLogs, `${await lastAssistant(page, sid)}${askedLogs ? ' (it asked to read)' : ''}`);
  await until(() => idle(page), 30000);
  await page.keyboard.press('t');
  await until(() => new Promise((r) => { require('node:http').get('http://127.0.0.1:18997/', () => r(false)).on('error', () => r(true)); }), 15000, 300);

  // ---- A tool prompt, y ----
  await say(page, 'Run this exact shell command with the Bash tool: mkdir hub-walk-dir');
  const toolUp = await until(async () => { const c = await cardNow(page); return c?.live?.ask?.kind === 'tool' && Boolean(c.live.ask.requestId); }, 90000, 300);
  const toolCard = await cardNow(page);
  check('the tool prompt is on the card with its request id', toolUp, toolCard?.live?.text);
  await sleep(400);
  await shot(page, 'tool');
  const ty2 = Date.now();
  await page.keyboard.press('y');
  const ran = await until(() => fs.existsSync(`${HOME_REPO}-card-1/hub-walk-dir`), 30000, 100);
  check('y allows it: the folder is made', ran, `${Date.now() - ty2} ms`);
  await until(() => idle(page), 60000);

  // ---- Claude's question form ----
  await say(page, 'Call the AskUserQuestion tool now, once, with exactly one question: header "Color", question "Which color?", options Red, Green, Blue (single choice). After it returns, reply with one line: ANSWER= followed by the answer you received.');
  const form = view.getByRole('group', { name: 'Claude’s question' });
  const formUp = await until(() => form.isVisible().catch(() => false), 90000, 300);
  check('the question form is on the card', formUp);
  await sleep(400);
  await shot(page, 'question');
  await page.keyboard.press('2');
  await sleep(250);
  await shot(page, 'question-review');
  await page.keyboard.press('y');
  const answered = await until(async () => /ANSWER=\s*Green/i.test(await lastAssistant(page, sid)), 60000, 300);
  check('2 then y: Claude received Green', answered, await lastAssistant(page, sid));
  await until(() => idle(page), 30000);

  // ---- Esc mid-turn ----
  await say(page, 'Write the numbers from 1 to 300 as English words, one per line, with no other text.');
  const going = await until(async () => (await page.locator('[data-partial]').count()) > 0, 30000, 100);
  check('a long reply starts streaming', going);
  await page.keyboard.press('Escape');
  const te = Date.now();
  const stopped = await until(async () => (await cardNow(page))?.live?.phase !== 'working', 15000, 200);
  check('Esc stops the turn (and the card stays open)', stopped && await view.isVisible(), `${Date.now() - te} ms, ${(await cardNow(page))?.live?.text}`);
  const lastWords = await lastAssistant(page, sid);
  check('the reply was cut short', !/three hundred/i.test(lastWords), lastWords.split('\n').length + ' lines');
  await shot(page, 'stopped');

  // ---- Close and open again ----
  await page.keyboard.press('Escape');
  await sleep(400);
  check('Esc again goes back to the board', !(await view.isVisible()));
  const before = (await items(page, sid)).length;
  await page.keyboard.press('Enter');
  await sleep(1200);
  const chatText = await view.innerText();
  check('opened again, the chat shows the transcript', /pong/i.test(chatText) && /ANSWER=/.test(chatText), `${before} items`);
  await shot(page, 'reopened');
  await page.emulateMedia({ colorScheme: 'dark' });
  await sleep(300);
  await shot(page, 'reopened-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // ---- Restart the server; the next message resumes ----
  stopServer();
  await sleep(1000);
  check('the server restarts', await startServer());
  await sleep(2500);
  const afterRestart = await cardNow(page);
  check('after the restart the card waits (nothing runs)', afterRestart?.live?.phase === 'waiting', afterRestart?.live?.text);
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('Enter');
  await sleep(800);
  const tr = Date.now();
  await say(page, 'Reply with exactly the word: again');
  const resumed = await until(async () => /again/i.test(await lastAssistant(page, sid)), 90000, 300);
  check('the next message resumes the session in the app and is answered', resumed, `${Date.now() - tr} ms`);
  const card1 = await cardNow(page);
  check('the same session, still the card’s', card1?.sessionId === sid);
  const all = await items(page, sid);
  check('Claude still has the earlier conversation', all.some((i) => i.kind === 'assistant' && /pong/i.test(i.text)), `${all.length} items`);
  await shot(page, 'resumed');

  // ---- The server log's timing lines (Phase C makes them a budget) ----
  const timing = logText().split('\n').filter((l) => / send CARD-1: /.test(l));
  check('the log has send → first partial, first reply and y → ran lines', timing.some((l) => /first partial after/.test(l)) && timing.some((l) => /first reply after/.test(l)) && timing.some((l) => /y → .* ran after/.test(l)));
  fs.writeFileSync(path.join(OUT, 'timing.txt'), timing.join('\n'));
  console.log(timing.join('\n'));

  check('no errors on the page', errors.length === 0, errors.slice(0, 3).join(' | '));
  // Clean up: the card's worktree and branch go with it.
  const removed = await ask(page, { type: 'card.removeWorktrees', id: card1.id, force: true, thenDelete: true }, 30000).then(() => true, (e) => { console.log(`cleanup: ${e.message}`); return false; });
  check('Shift+X’s removal works on a card whose session the app runs (it stops the session first)', removed && !fs.existsSync(`${HOME_REPO}-card-1`));
  if (!removed) console.log(spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'claude|powershell|bash|git|node' } | Select-Object ProcessId,ParentProcessId,Name,CreationDate | Format-Table -AutoSize | Out-String -Width 200`], { encoding: 'utf8' }).stdout, 'server pid', server?.pid);
  await browser.close();
  stopServer();
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); stopServer(); process.exit(2); });
