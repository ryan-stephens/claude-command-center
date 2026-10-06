// The Verify panel (PLAN §105, §107) on an isolated server (PORT, default 7805) against the stand-in
// tools (standins/verify-tools.cjs on 18900 to 18902, logging to STANDIN_LOG): the machine's Verify
// file written while the panel is open (it shows at once, the tools by name), ids checked in Dev and
// UAT side by side, Add on a field a set lacks, the set refreshed, a record looked up (found, missing
// field, no record, Advanced), the tools' pages, Prod behind a second press, paste into the boxes;
// and that the server sent the tools nothing but the two reads and the lookup form, and logged no value.
// Start the stand-ins first: node standins/verify-tools.cjs 18900 %TEMP%\verify-standin.log
// The server runs with CC_CONTROL_VERIFY_FILE=VERIFY_FILE (default %TEMP%/cc-verify-walk.json; the
// walk deletes and writes it). SERVER_LOG: the server's log, checked for values. DARK=1 for dark mode.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const PORT = process.env.PORT || '7805';
const dark = process.env.DARK === '1';
const TMP = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/');
const STANDIN_LOG = process.env.STANDIN_LOG || `${TMP}/verify-standin.log`;
const SERVER_LOG = process.env.SERVER_LOG || `${TMP}/cc-test-105.log`;
const VERIFY_FILE = process.env.VERIFY_FILE || `${TMP}/cc-verify-walk.json`;
const OUT = path.join(__dirname, dark ? 'shots-verify-dark' : 'shots-verify');
fs.mkdirSync(OUT, { recursive: true });
const DEMO = `${TMP}/cc-demo`;
const DEV = 'http://127.0.0.1:18900', UAT = 'http://127.0.0.1:18901', LOOKUP = 'http://127.0.0.1:18902/Lookup';
let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(200); } return false; };
const standin = () => (fs.existsSync(STANDIN_LOG) ? fs.readFileSync(STANDIN_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

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
  if (fs.existsSync(STANDIN_LOG)) fs.writeFileSync(STANDIN_LOG, '');
  fs.rmSync(VERIFY_FILE, { force: true });
  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: dark ? 'dark' : 'light' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${PORT}` });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate((dark) => { localStorage.setItem('cc-control.welcomed.v2', '1'); if (dark) localStorage.setItem('cc-control.theme', 'dark'); }, dark);
  // A clean slate: no tools set up yet.
  await page.evaluate(({ DEMO }) => new Promise((resolve) => { const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { ws.send(JSON.stringify({ type: 'workspace.save', workspace: { id: 'ws-demo-verify', name: 'Demo', color: 'teal', repos: [`${DEMO}/web-app`], notes: '' } })); setTimeout(() => { ws.close(); resolve(); }, 400); }; }), { DEMO });
  const card = await ask(page, { type: 'cards.seed', options: { repos: [`${DEMO}/web-app`], workspaceId: 'ws-demo-verify', key: 'LOAN-77', state: 'idle', title: 'Map CX.SAMPLE.ONE and field 1000 onto the summary' } });
  await page.reload();
  await sleep(900);
  await page.locator(`#card-${card.id}`).click();
  await sleep(600);
  const view = page.locator('section[aria-label^="LOAN-77"]').first();
  check('the card opens', await view.isVisible());

  // v: the panel; no Verify file on this machine yet, so it says where the file goes.
  await page.keyboard.press('v');
  await sleep(400);
  check('v opens Verify, which says where the machine’s file goes', await view.getByText(/from a file on this machine/).isVisible() && await view.getByText(VERIFY_FILE.split('/').pop(), { exact: false }).first().isVisible());
  check('no setup form', (await page.locator('#verify-setup').count()) === 0);
  check('the ids box starts with the ids the card names', (await page.locator('#verify-ids').inputValue()) === 'CX.SAMPLE.ONE\n1000', JSON.stringify(await page.locator('#verify-ids').inputValue()));
  await page.keyboard.press('Enter');
  check('Enter with no file says so', await until(async () => /has no address in this machine’s Verify file/.test(await view.innerText())));
  await shot(page, 'no-file');

  // The file, written while the panel is open: the tools show by name, no restart, no form.
  fs.writeFileSync(VERIFY_FILE, JSON.stringify({
    set: { name: 'Sample set', urls: { dev: DEV, uat: UAT }, addPage: 'Home/AddToSet' },
    lookup: { name: 'Sample lookup', url: LOOKUP, recordField: 'RecordId' },
  }, null, 2));
  check('the file shows within seconds: the tools by name', await until(async () => /Is it in Sample set\?/.test(await view.innerText()) && /Look up in Sample lookup/.test(await view.innerText()), 10000));
  check('the note about the file goes', !(await view.getByText(/from a file on this machine/).count()));

  // i, a made-up id typed in, Esc, Enter: Dev and UAT side by side.
  await page.keyboard.press('i');
  check('i puts the cursor in the ids box', await until(async () => (await page.evaluate(() => document.activeElement?.id)) === 'verify-ids'));
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nMADEUP');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  const table = view.getByRole('table', { name: 'In the set' });
  check('Enter checks: a row per id, Dev and UAT columns', await until(async () => (await table.locator('tbody tr').count()) === 3));
  const rowText = async (id) => (await table.locator('tbody tr', { hasText: id }).innerText()).replace(/\s+/g, ' ');
  const one = await rowText('CX.SAMPLE.ONE');
  check('a field in Dev’s set but not UAT’s is marked as differing', /in set/.test(one) && /not in set/.test(one) && /differs/.test(one), one);
  check('the same in both: no drift', !/differs/.test(await rowText('1000')), await rowText('1000'));
  const made = await rowText('MADEUP');
  check('an unknown id is unknown in both', (made.match(/unknown/g) ?? []).length === 2, made);
  check('each environment’s set version shows', await view.getByText(/Dev: set v42/).isVisible() && await view.getByText(/UAT: set v41/).isVisible());
  await shot(page, 'checked');

  // r: the set is read again (it was read once per environment by the check).
  const setReads = () => standin().filter((r) => r.path === '/Home/SetVersion').length;
  const before = setReads();
  await page.keyboard.press('r');
  check('r reads each environment’s set again', await until(async () => setReads() === before + 2), `${before} → ${setReads()}`);

  // l, a record, Enter: the values; a field the record lacks; then a record that isn't there.
  await page.keyboard.press('l');
  check('l puts the cursor in the record box', await until(async () => (await page.evaluate(() => document.activeElement?.id)) === 'verify-record'));
  await page.keyboard.type('5001');
  await page.keyboard.press('Enter');
  const values = view.getByRole('table', { name: 'Record values' });
  const looked = await until(async () => (await values.locator('tbody tr').count()) === 3);
  check('Enter in the record box looks it up', looked, looked ? '' : `${await page.locator('#verify-record').inputValue()} | ${(await view.innerText()).replace(/\s+/g, ' ').slice(-500)}`);
  if (!looked) { await shot(page, 'lookup-failed'); throw new Error('stop'); }
  check('found values show, entities decoded, read-only marked', /12\.50/.test(await values.innerText()) && /Yes & no/.test(await values.innerText()) && /read-only/.test(await values.innerText()));
  check('a field the record lacks says it does not exist', /does not exist/.test(await values.locator('tbody tr', { hasText: 'MADEUP' }).innerText()));
  const post = standin().filter((r) => r.tool === 'lookup').at(-1);
  check('the lookup posted Dev with Advanced off', post?.env === 'Dev' && post?.advanced === 'false', JSON.stringify(post));
  await shot(page, 'record');
  await page.keyboard.press('a');
  await page.keyboard.press('l');
  await until(async () => (await page.evaluate(() => document.activeElement?.id)) === 'verify-record');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('9999');
  await page.keyboard.press('Enter');
  check('a record that isn’t there: No record found', await until(async () => /No record found: 9999/.test(await view.innerText())));
  check('a turns Advanced on for the lookup', standin().filter((r) => r.tool === 'lookup').at(-1)?.advanced === 'true');

  // e: UAT, and the lookup follows; Shift+P twice: Prod.
  await page.keyboard.press('e');
  check('e switches to UAT', await until(async () => (await view.getByRole('radio', { name: 'UAT' }).getAttribute('aria-checked')) === 'true'));
  await page.keyboard.press('Shift+P');
  await sleep(150);
  check('one Shift+P only asks', (await view.getByRole('radio', { name: 'Prod' }).getAttribute('aria-checked')) === 'false');
  await page.keyboard.press('Shift+P');
  check('a second Shift+P chooses Prod', await until(async () => (await view.getByRole('radio', { name: 'Prod' }).getAttribute('aria-checked')) === 'true'));
  await page.keyboard.press('Enter');
  check('a lookup on Prod posts Prod', await until(async () => standin().filter((r) => r.tool === 'lookup').at(-1)?.env === 'Prod'));
  await shot(page, 'prod');
  await page.keyboard.press('Shift+P');
  await page.keyboard.press('e');
  check('Shift+P on Prod goes back to Dev, then e to UAT', await until(async () => (await view.getByRole('radio', { name: 'UAT' }).getAttribute('aria-checked')) === 'true'));

  // o, Shift+O, Shift+L: the tools' pages in the browser (UAT now).
  const opens = [];
  for (const k of ['o', 'Shift+O', 'Shift+L']) {
    const [tab] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }).catch(() => null), page.keyboard.press(k)]);
    opens.push(tab ? tab.url() : 'none');
    if (tab) await tab.close();
  }
  check('o opens the set tool for UAT, Shift+O its add-to-set page, Shift+L the lookup', opens[0] === `${UAT}/` && opens[1] === `${UAT}/Home/AddToSet` && opens[2] === LOOKUP, opens.join(' | '));
  check('Shift+O copied the ids UAT’s set lacks, to paste there', (await page.evaluate(() => navigator.clipboard.readText())) === 'CX.SAMPLE.ONE', await page.evaluate(() => navigator.clipboard.readText()));

  // Add on a field a set lacks: that environment's add-to-set page, the id copied.
  await page.evaluate(() => navigator.clipboard.writeText(''));
  const addLink = view.getByRole('button', { name: 'Add in UAT ↗' });
  check('a field not in UAT’s set offers Add in UAT (and only there)', (await addLink.count()) === 1 && !(await view.getByRole('button', { name: 'Add in Dev ↗' }).count()));
  const [addTab] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }).catch(() => null), addLink.click()]);
  check('Add opens UAT’s add-to-set page with the id copied', addTab?.url() === `${UAT}/Home/AddToSet` && (await page.evaluate(() => navigator.clipboard.readText())) === 'CX.SAMPLE.ONE', addTab?.url() ?? 'none');
  if (addTab) await addTab.close();

  // Paste into the ids box and into the message box (Ctrl+V reaches both).
  await page.evaluate(() => navigator.clipboard.writeText('PASTED.ID'));
  await page.locator('#verify-ids').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+v');
  check('Ctrl+V pastes into the ids box', (await page.locator('#verify-ids').inputValue()).endsWith('PASTED.ID'));
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await sleep(200);
  const say = page.locator('#card-say');
  if (await say.count()) {
    await say.focus();
    await page.keyboard.press('Control+v');
    check('Ctrl+V pastes into the message box', (await say.inputValue()).includes('PASTED.ID'), JSON.stringify(await say.inputValue()));
    await say.fill('');
    await page.keyboard.press('Escape');
  }

  // The ? overlay has the panel's rows.
  await page.keyboard.press('Shift+Slash');
  await sleep(400);
  check('the ? overlay has the Verify rows', (await page.getByText(/Verify panel: The field set tool’s page/).count()) > 0);
  await page.keyboard.press('Escape');

  // What the app's server sent the tools: only the reads and the lookup form, never a Save or update.
  const fromServer = standin().filter((r) => !/Chrome|Mozilla/.test(r.agent));
  const bad = fromServer.filter((r) => !((r.method === 'GET' && /^\/Home\/(SetVersion|ValidateField)$/.test(r.path)) || (r.method === 'POST' && r.path === '/Lookup')));
  check('the server sent only SetVersion, ValidateField and the lookup form', fromServer.length > 0 && bad.length === 0, `${fromServer.length} requests, ${bad.length} others ${JSON.stringify(bad.slice(0, 2))}`);
  check('every lookup POST carried only the four form fields', fromServer.filter((r) => r.tool === 'lookup').every((r) => r.fields.every((f) => ['Environment', 'RecordId', 'AdvancedFetch', 'FieldsToFetch'].includes(f))));
  check('nothing reached a Save or an update', !standin().some((r) => /save|update/i.test(r.path)));
  const serverLog = fs.existsSync(SERVER_LOG) ? fs.readFileSync(SERVER_LOG, 'utf8') : '';
  check('the server log has no looked-up value', serverLog.length >= 0 && !/12\.50|Yes & no/.test(serverLog));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
