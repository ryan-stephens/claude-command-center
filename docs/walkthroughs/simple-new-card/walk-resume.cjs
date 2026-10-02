// Resume and send, for real (PLAN §85, §87, §89), on the isolated server at :7803: a real Claude
// session is made with `claude -p` in this repo's folder (trusted, so no trust prompt), a card is
// seeded on it with a token and no way in, and the page's message box is used to send to it. The
// server opens a new Windows Terminal tab with `claude --resume`, the launcher in it polls and
// types the message once the prompt is up, and the session's transcript shows the message as a
// user turn. A terminal tab opens on screen for about a minute; the session is told /exit at the
// end. Needs a server started with CC_CONTROL_PORT=7803 and the test build; its stdout is read
// from the file named in SERVER_LOG (the send lines land there).
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const PORT = process.env.PORT || '7803';
const SERVER_LOG = process.env.SERVER_LOG || '';
const OUT = path.join(__dirname, 'shots-resume');
fs.mkdirSync(OUT, { recursive: true });
const REPO = 'D:/repos/cc-control';
const CLAUDE = 'C:/Users/ryans/.local/bin/claude.exe';
const PROJECT_DIR = path.join(os.homedir(), '.claude', 'projects', 'D--repos-cc-control');
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(500); } return false; };
const serverLog = () => { try { return SERVER_LOG ? fs.readFileSync(SERVER_LOG, 'utf8') : ''; } catch { return ''; } };

// A claude run from inside a Claude Code session would be its child and write no transcript: the markers go.
const cleanEnv = () => { const env = { ...process.env }; for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_)/.test(k)) delete env[k]; return env; };

async function ask(page, msg, timeout = 5000) {
  return page.evaluate(({ msg, timeout }) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    const reqId = `w-${Math.random().toString(36).slice(2)}`;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.reqId !== reqId) return; ws.close(); if (m.type === 'error') reject(new Error(m.message)); else resolve(m); };
    ws.onopen = () => ws.send(JSON.stringify({ ...msg, reqId }));
    setTimeout(() => { ws.close(); reject(new Error('no answer')); }, timeout);
  }), { msg, timeout });
}
const cardNow = (page, id) => page.evaluate((id) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'cards') { ws.close(); resolve(m.cards.find((c) => c.id === id) ?? null); } };
  setTimeout(() => { ws.close(); resolve(null); }, 2000);
}), id);
/** The session's transcript has a user turn with this text. */
function transcriptHas(sessionId, text) {
  try {
    const lines = fs.readFileSync(path.join(PROJECT_DIR, `${sessionId}.jsonl`), 'utf8').split('\n');
    return lines.some((l) => l.includes('"type":"user"') && l.includes(text));
  } catch { return false; }
}

(async () => {
  // 1. A real session, one turn, in this repo's folder.
  const made = spawnSync(CLAUDE, ['-p', 'Reply with the single word: ready', '--model', 'haiku', '--output-format', 'json'], { cwd: REPO, env: cleanEnv(), encoding: 'utf8', timeout: 90_000 });
  let sessionId = '';
  try { sessionId = JSON.parse(made.stdout).session_id; } catch { /* below */ }
  check('a real session exists to resume', /^[0-9a-f-]{36}$/.test(sessionId), sessionId || (made.stderr || made.stdout || '').slice(0, 200));
  if (!sessionId) process.exit(2);

  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate(() => { localStorage.setItem('cc-control.welcomed.v2', '1'); });

  // 2. A card on that session with no way in: its session ended (so nothing refuses the reopen), no channel, no launcher.
  const token = 'walk-resume-token-1234';
  const seeded = await ask(page, { type: 'cards.seed', options: { repos: [REPO], key: 'RSM-7', state: 'done', title: 'Resumed for real', channel: false, token, sessionId } });
  check('a card is seeded on the real session', Boolean(seeded.id));
  await page.reload();
  await sleep(900);
  const tile = page.locator(`#card-${seeded.id}`);
  const onBoard = await tile.isVisible().catch(() => false);
  let sentFromBox = false;
  const text = 'Reply with the single word: landed';
  if (onBoard) {
    await tile.click();
    await sleep(700);
    const view = page.locator('section[aria-label^="RSM-7"]').first();
    check('the open card offers Resume and send', await view.getByRole('button', { name: /Resume and send/ }).isVisible());
    await shot(page, 'before');
    await page.keyboard.press('Enter');
    await sleep(200);
    const focused = await page.evaluate(() => document.activeElement?.id ?? '');
    check('Enter puts the cursor in the message box', focused === 'card-say', focused);
    if (focused !== 'card-say') await view.locator('#card-say').click();
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    sentFromBox = true;
  } else {
    console.log('(the card is not on the board under the current filter: sending through the socket instead)');
    ask(page, { type: 'card.send', id: seeded.id, text }, 125_000).catch((e) => console.log('card.send:', e.message));
  }

  // 3. The tab opens, the launcher polls, the message is typed and sent: the transcript gets the user turn.
  const polled = await until(async () => (await cardNow(page, seeded.id))?.keys === true, 60_000);
  check('the new tab’s launcher polls (the card says it can be typed into)', polled);
  const landed = await until(() => transcriptHas(sessionId, text), 90_000);
  check('the message typed from the page is a user turn in the resumed session’s transcript', landed);
  if (sentFromBox) {
    await sleep(500);
    await shot(page, 'after-send');
    const empty = await page.evaluate(() => document.getElementById('card-say')?.value ?? 'gone');
    check('the box is empty after the send', empty === '', JSON.stringify(empty));
  }
  const card = await cardNow(page, seeded.id);
  console.log(`card after: channel ${card?.channel}, keys ${card?.keys}, phase ${card?.live?.phase}`);
  await until(() => /through the launcher/.test(serverLog()), 5000);
  const log = serverLog().split('\n').filter((l) => / send RSM-7: /.test(l));
  console.log(log.join('\n'));
  check('the server logged the send going through the launcher', log.some((l) => /through the launcher/.test(l)), SERVER_LOG ? '' : '(no SERVER_LOG given)');
  const replied = await until(() => transcriptHas(sessionId, 'landed') && fs.readFileSync(path.join(PROJECT_DIR, `${sessionId}.jsonl`), 'utf8').split('\n').filter((l) => l.includes('"type":"assistant"')).length >= 2, 60_000);
  check('the session answered it', replied);

  // 4. Done: /exit through the same way closes the session and its tab.
  await ask(page, { type: 'card.send', id: seeded.id, text: '/exit' }, 30_000).catch((e) => console.log('exit:', e.message));
  const gone = await until(async () => (await cardNow(page, seeded.id))?.live?.phase === 'ended', 30_000);
  check('/exit ends the session (the card says so)', gone);
  check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await page.evaluate((id) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify({ type: 'card.delete', id })); setTimeout(() => { ws.close(); resolve(); }, 300); }; }), seeded.id);
  await browser.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
