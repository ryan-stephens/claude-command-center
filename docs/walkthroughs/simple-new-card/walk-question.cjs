// Claude's question form answered from the card, for real (PLAN §91), on the isolated server at
// :7803: a real session is made with `claude -p` in this repo's folder, a card is seeded on it
// with no way in, and the open card's message box asks Claude to put up a two-question form
// (one single choice, one multi choice). The form appears on the card as the hooks report it;
// the page's keys answer it (a digit, two toggles, Tab, y); the launcher presses the form's keys
// in the tab; Claude's reply names the answers it received. A terminal tab opens on screen for
// about two minutes; the session is told /exit at the end.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const PORT = process.env.PORT || '7803';
const OUT = path.join(__dirname, 'shots-question');
fs.mkdirSync(OUT, { recursive: true });
const REPO = 'D:/repos/cc-control';
const CLAUDE = 'C:/Users/ryans/.local/bin/claude.exe';
const PROJECT_DIR = path.join(os.homedir(), '.claude', 'projects', 'D--repos-cc-control');
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(500); } return false; };
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
const transcript = (sid) => { try { return fs.readFileSync(path.join(PROJECT_DIR, `${sid}.jsonl`), 'utf8'); } catch { return ''; } };
const reply = (sid) => transcript(sid).split('\n').filter((l) => l.includes('"type":"assistant"') && l.includes('ANSWERS=')).map((l) => (/ANSWERS=([^"\\]*)/.exec(l) ?? [])[1] ?? '').join(' ');

(async () => {
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
  const key = `ASK-${Math.floor(Math.random() * 900) + 100}`;
  const seeded = await ask(page, { type: 'cards.seed', options: { repos: [REPO], key, state: 'done', title: 'A question, answered from the card', channel: false, token: 'walk-question-token-1', sessionId } });
  check('a card is seeded on the real session', Boolean(seeded.id));
  await page.reload();
  await sleep(900);
  await page.locator(`#card-${seeded.id}`).click();
  await sleep(700);
  const view = page.locator(`section[aria-label^="${key}"]`).first();

  // The message that makes Claude put up the form, sent from the box (Resume and send).
  await page.keyboard.press('Enter');
  await sleep(200);
  await page.keyboard.type('Call the AskUserQuestion tool now, once, with exactly two questions. Question 1: header "Color", question "Which color?", options Red, Green, Blue (single choice). Question 2: header "Toppings", question "Which toppings?", multiSelect true, options Cheese, Olives, Onion. After the tool returns, reply with one line: ANSWERS= followed by the answers you received, as plain words.');
  await page.keyboard.press('Enter');
  const form = view.getByRole('group', { name: 'Claude’s question' });
  const up = await until(() => form.isVisible().catch(() => false), 150_000);
  check('the form appears on the card when Claude asks (from the hooks)', up);
  await sleep(500);
  check('it shows the tabs Color, Toppings and Submit, with the first question and its options', (await form.getByRole('tab').count()) === 3 && await form.getByText('Which color?').isVisible() && (await form.getByRole('radio').count()) === 3);
  await shot(page, 'form');
  // Answer it with the keys: 2 (Green, moves on), 1 and 3 (Cheese, Onion), Tab (Submit), y.
  await page.keyboard.press('2');
  await sleep(250);
  await page.keyboard.press('1');
  await page.keyboard.press('3');
  await sleep(250);
  await page.keyboard.press('Tab');
  await sleep(250);
  check('the review lists Green and Cheese, Onion', (await form.getByRole('tab', { selected: true }).innerText()).includes('Submit') && (await form.getByText('Green', { exact: true }).count()) >= 1 && await form.getByText('Cheese, Onion').isVisible());
  await shot(page, 'review');
  await page.keyboard.press('y');
  // The button says Answers sent until the hooks clear the ask (the tool ran), which can be quick.
  const sent = await until(async () => (await form.getByRole('button', { name: /Answers sent/ }).isVisible().catch(() => false)) || !(await form.isVisible().catch(() => false)), 30_000);
  check('y sends the answers (the launcher takes them)', sent);
  const answered = await until(() => /Green/.test(reply(sessionId)) && /Cheese/.test(reply(sessionId)) && /Onion/.test(reply(sessionId)), 90_000);
  check('Claude received Green and Cheese, Onion (its reply names them)', answered, reply(sessionId).slice(0, 160));
  const gone = await until(async () => (await cardNow(page, seeded.id))?.live?.ask === undefined, 30_000);
  check('the form leaves the card once answered', gone);
  await shot(page, 'answered');
  check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));

  await ask(page, { type: 'card.send', id: seeded.id, text: '/exit' }, 30_000).catch((e) => console.log('exit:', e.message));
  await until(async () => (await cardNow(page, seeded.id))?.live?.phase === 'ended', 30_000);
  await page.evaluate((id) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify({ type: 'card.delete', id })); setTimeout(() => { ws.close(); resolve(); }, 300); }; }), seeded.id);
  await browser.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
