// Try it as services (PLAN §82) on the isolated server at :7802: a Demo lane with a stand-in stack
// (node scripts in standins/ play the API and the UI), a seeded card, then the Try it panel: tick
// the API, t starts everything, q stops the API alone while the UI stays up, r starts it again,
// t stops all; the output under the service and its pop-out (§84). Needs a wide window (the panel
// sits beside the chat). DARK=1 for dark mode.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const PORT = process.env.PORT || '7802';
const dark = process.env.DARK === '1';
const OUT = path.join(__dirname, dark ? 'shots-stack-dark' : 'shots-stack');
fs.mkdirSync(OUT, { recursive: true });
const DEMO = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/') + '/cc-demo';
const STANDINS = path.join(__dirname, 'standins').replace(/\\/g, '/');
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; };

async function ask(page, msg) {
  return page.evaluate((msg) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    const reqId = `w-${Math.random().toString(36).slice(2)}`;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.reqId !== reqId) return; ws.close(); if (m.type === 'error') reject(new Error(m.message)); else resolve(m); };
    ws.onopen = () => ws.send(JSON.stringify({ ...msg, reqId }));
    setTimeout(() => { ws.close(); reject(new Error('no answer')); }, 5000);
  }), msg);
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, colorScheme: dark ? 'dark' : 'light' });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate((dark) => { localStorage.setItem('cc-control.welcomed.v2', '1'); localStorage.removeItem('cc-control.stackPick'); if (dark) localStorage.setItem('cc-control.theme', 'dark'); }, dark);
  await page.evaluate(({ DEMO }) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'workspace.save', workspace: { id: 'ws-demo-stack', name: 'Stack', color: 'blue', repos: [`${DEMO}/web-app`, `${DEMO}/payments-api`], notes: '' } }));
      setTimeout(() => { ws.close(); resolve(); }, 600);
    };
  }), { DEMO });
  // The lane's stack: how an API starts (a stand-in that listens on the port picked), and the UI (a stand-in that prints its address).
  await ask(page, { type: 'stack.save', workspaceId: 'ws-demo-stack', stack: {
    choose: { env: ['dev', 'uat'] },
    api: { steps: [`wait:port:{{port}} node ${STANDINS}/api.cjs {{port}} {{name}}-{{env}}`, `stop: node ${STANDINS}/down.cjs {{deployment}}`] },
    apis: [{ repo: 'payments-api', values: { name: 'payments-api', appPort: '8080', route: 'payments' } }],
    ui: { repo: 'web-app', steps: [`node ${STANDINS}/ui.cjs {{uiPort}}`], url: 'http://localhost:{{uiPort}}' },
  } });
  const old = await page.evaluate(() => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'cards') { ws.close(); resolve(m.cards.filter((c) => c.workspaceId === 'ws-demo-stack').map((c) => c.id)); } };
    setTimeout(() => { ws.close(); resolve([]); }, 2000);
  }));
  for (const id of old) await page.evaluate((id) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify({ type: 'card.delete', id })); setTimeout(() => { ws.close(); resolve(); }, 150); }; }), id);
  const seeded = await ask(page, { type: 'cards.seed', options: { repos: [`${DEMO}/web-app`, `${DEMO}/payments-api`], workspaceId: 'ws-demo-stack', key: 'SHOP-160', state: 'idle', title: 'Order history paging' } });
  await page.reload();
  await sleep(900);
  await page.locator(`#card-${seeded.id}`).click();
  await sleep(700);
  const view = page.locator('section[aria-label^="SHOP-160"]').first();
  check('the card opens', await view.isVisible());

  // Shift+T: the Try it panel lists the environment and the services.
  await page.keyboard.press('T');
  await sleep(1200);
  const panel = view.getByRole('region', { name: 'Try it' });
  check('the Try it panel shows the services', await panel.getByRole('option', { name: /payments-api/ }).isVisible() && await panel.getByRole('option', { name: /web-app/ }).isVisible());
  check('the environment row offers dev and uat', await panel.getByRole('radio', { name: 'dev' }).isVisible() && await panel.getByRole('radio', { name: 'uat' }).isVisible());
  const box = panel.getByRole('checkbox', { name: 'Run payments-api' });
  check('the API starts unticked (unchanged, not named)', (await box.getAttribute('aria-checked')) === 'false');
  await shot(page, 'panel');
  // j to the API's row, Space ticks it; the Start button counts it.
  await page.keyboard.press('j');
  await page.keyboard.press(' ');
  await sleep(200);
  check('Space ticks the API', (await box.getAttribute('aria-checked')) === 'true');
  check('the button says what t starts', await panel.getByRole('button', { name: /Start 1 API and the UI/ }).isVisible());
  // t: both services start, each its own run.
  await page.keyboard.press('t');
  await sleep(4000);
  await shot(page, 'after-t');
  const bothUp = await until(async () => (await panel.getByText('up', { exact: true }).count()) === 2, 25000);
  check('t starts the API and the UI, both up', bothUp);
  check('the dock’s Try it says on', /on/.test(await view.locator('button[title^="Its app"]').innerText()));
  check('Open shows on the UI row', await panel.getByRole('button', { name: /Open/ }).isVisible());
  await shot(page, 'both-up');
  // The output (§84): the highlighted API's log sits under its steps and follows what it prints.
  const log = panel.getByRole('log', { name: 'Output' });
  check('the API’s output shows under its steps, with the step marked', /\$ wait:port|\$ node/.test(await log.innerText()) && /listening on \d+/.test(await log.innerText()), (await log.innerText()).slice(0, 120));
  const label0 = await panel.locator('h4').first().innerText();
  const apiPort = Number((label0.match(/payments-api :(\d+)/) || [])[1]);
  check('the session label names the API’s port', apiPort > 0, label0);
  await new Promise((resolve) => http.get(`http://127.0.0.1:${apiPort}/orders/1`, (res) => { res.resume(); res.on('end', resolve); }).on('error', resolve));
  const lineLanded = await until(async () => /GET \/orders\/1/.test(await log.innerText()), 5000);
  check('a request to the API lands in the output while it runs', lineLanded);
  check('Pop out sits under the output', await panel.getByRole('button', { name: /Pop out/ }).isVisible());
  await shot(page, 'output-panel');
  // f: the same output full width, on the API's tab; j moves to the UI's; / filters; Esc closes only the sheet.
  await page.keyboard.press('f');
  await sleep(500);
  const out = page.getByRole('dialog', { name: 'Output' });
  check('f opens the Output sheet', await out.isVisible());
  check('the sheet opens on the API’s tab', (await out.getByRole('tab', { name: /payments-api/ }).getAttribute('aria-selected')) === 'true');
  check('the sheet shows the request line', /GET \/orders\/1/.test(await out.getByRole('log').innerText()));
  await new Promise((resolve) => http.get(`http://127.0.0.1:${apiPort}/orders/2`, (res) => { res.resume(); res.on('end', resolve); }).on('error', resolve));
  check('a new request lands in the sheet live', await until(async () => /GET \/orders\/2/.test(await out.getByRole('log').innerText()), 5000));
  await shot(page, 'output-sheet');
  await page.keyboard.press('j');
  await sleep(300);
  check('j moves to the UI’s tab, with its own output', (await out.getByRole('tab', { name: /web-app/ }).getAttribute('aria-selected')) === 'true' && /Local: http:\/\/localhost/.test(await out.getByRole('log').innerText()));
  await page.keyboard.press('k');
  await page.keyboard.press('/');
  await page.keyboard.type('orders/2');
  await sleep(300);
  const filtered = await out.getByRole('log').innerText();
  check('/ filters the lines', /orders\/2/.test(filtered) && !/orders\/1/.test(filtered));
  await page.keyboard.press('Escape');
  await sleep(200);
  check('Esc leaves the filter box, the sheet stays', await out.isVisible());
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Esc closes the sheet, the card stays open', !(await out.isVisible().catch(() => false)) && await view.isVisible());
  // q on the API's row: it stops, the UI stays up.
  await page.keyboard.press('q');
  const apiDown = await until(async () => /stopped/.test(await panel.getByRole('option', { name: /payments-api/ }).innerText()), 15000);
  check('q stops the API alone', apiDown);
  check('the UI is still up', /\bup\b/.test(await panel.getByRole('option', { name: /web-app/ }).innerText()));
  check('the output marks the stop, then the stop: step and what it printed', await until(async () => /\(stopped\)[\s\S]*\$ node .*down\.cjs[\s\S]*down payments-api/.test(await log.innerText()), 5000), (await log.innerText()).slice(-160));
  await shot(page, 'api-stopped');
  // r: the API starts again on the same port (the session kept it); its output starts afresh.
  await page.keyboard.press('r');
  const apiUp = await until(async () => /\bup\b/.test(await panel.getByRole('option', { name: /payments-api/ }).innerText()), 20000);
  check('r starts the API again', apiUp);
  check('the output starts afresh for the new run', await until(async () => { const t = await log.innerText(); return /listening on/.test(t) && !/orders\/1/.test(t); }, 5000));
  const label = await panel.locator('h4').first().innerText();
  check('the session label names the ports', /payments-api :\d+/.test(label), label);
  await shot(page, 'api-again');
  // t: everything stops, the ports go back.
  await page.keyboard.press('t');
  const allDown = await until(async () => (await panel.getByText('stopped', { exact: true }).count()) === 2, 20000);
  check('t stops them all', allDown);
  check('the Start button is back', await panel.getByRole('button', { name: /Start 1 API and the UI/ }).isVisible());
  await shot(page, 'all-stopped');
  // e: the lane's stack as a form (§83), filled from the saved stack: the UI, the API ticked, the lines kept as written (custom).
  await page.keyboard.press('e');
  await sleep(1500);
  const sheet = page.getByRole('dialog', { name: 'Set up the stack' });
  check('e opens the setup sheet', await sheet.isVisible());
  check('the UI repo is picked', (await sheet.locator('select').inputValue()) === 'web-app');
  check('the API is ticked with its values', (await sheet.getByRole('checkbox', { name: 'payments-api is part of the stack' }).isChecked()) && (await sheet.getByLabel('payments-api: route').inputValue()) === 'payments');
  check('the hand-written lines are kept and shown', /edited by hand/.test(await sheet.innerText()) && /api\.cjs/.test(await sheet.getByLabel('The step lines').inputValue()));
  await shot(page, 'setup');
  // Changing an answer writes the lines afresh.
  await sheet.getByPlaceholder('New-DevDeployment -Name {{name}} -Environment {{env}}').fill('Make-It {{name}} {{env}}');
  await sleep(200);
  const lines = await sheet.getByLabel('The step lines').inputValue();
  check('an answer writes the step lines', /^ps: KUBECONFIG=%KUBECONFIG_\{\{ENV\}\}% Make-It \{\{name\}\} \{\{env\}\}/m.test(lines) && /okteto up/.test(lines), lines.split(/\r?\n/)[0]);
  await shot(page, 'setup-written');
  await page.keyboard.press('Escape'); // leaves the field
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Esc closes it without saving', !(await sheet.isVisible().catch(() => false)));
  check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  // Leave the server as it was found: the card and the lane go (the other walkthroughs press 1 for the Demo lane).
  await page.evaluate((id) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify({ type: 'card.delete', id })); ws.send(JSON.stringify({ type: 'workspace.delete', id: 'ws-demo-stack' })); setTimeout(() => { ws.close(); resolve(); }, 400); }; }), seeded.id);
  await browser.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
