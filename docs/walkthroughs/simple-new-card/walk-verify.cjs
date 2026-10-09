// The Verify panel (PLAN §105, §107, §132) on an isolated server (PORT, default 7805) against the
// stand-in tools (standins/verify-tools.cjs on 18900 to 18902, logging to STANDIN_LOG): the machine's
// Verify file written while the panel is open (tabs appear, the tools by name), Alt+← → between the
// sections; ids checked in Dev and UAT side by side, Add on a field a set lacks, the set refreshed;
// a record looked up (found, an id with a space, missing field, no record, Advanced), a saved list,
// the filter, only empty, copy, recent chips; the tools' pages, Prod behind a second press, paste
// into the boxes; and that the server sent the tools nothing but the reads and the lookup form, and
// logged no value.
// Start the stand-ins first: node standins/verify-tools.cjs 18900 %TEMP%\verify-standin.log
// The server runs with CC_CONTROL_VERIFY_FILE=VERIFY_FILE (default %TEMP%/cc-verify-walk.json) and
// CC_CONTROL_FIELD_LISTS_FILE=LISTS_FILE (default %TEMP%/cc-lists-walk.json); the walk deletes and
// writes both. SERVER_LOG: the server's log, checked for values. DARK=1 for dark mode.
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const PORT = process.env.PORT || '7805';
const dark = process.env.DARK === '1';
const TMP = (process.env.TEMP || process.env.TMP).replace(/\\/g, '/');
const STANDIN_LOG = process.env.STANDIN_LOG || `${TMP}/verify-standin.log`;
const SERVER_LOG = process.env.SERVER_LOG || `${TMP}/cc-test-105.log`;
const VERIFY_FILE = process.env.VERIFY_FILE || `${TMP}/cc-verify-walk.json`;
const LISTS_FILE = process.env.LISTS_FILE || `${TMP}/cc-lists-walk.json`;
const OUT = path.join(__dirname, dark ? 'shots-verify-dark' : 'shots-verify');
fs.mkdirSync(OUT, { recursive: true });
const DEMO = `${TMP}/cc-demo`;
const DEV = 'http://127.0.0.1:18900', UAT = 'http://127.0.0.1:18901', LOOKUP = 'http://127.0.0.1:18902/Lookup', LOOKUP_PAGE = 'http://127.0.0.1:18902/LookupPage';
const BUILDER = 'http://127.0.0.1:18903', BUILDER_UI = 'http://127.0.0.1:18903/ui';
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
  fs.rmSync(LISTS_FILE, { force: true });
  await fetch('http://127.0.0.1:18902/__reset', { method: 'POST' }).catch(() => {});
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
  const focused = () => page.evaluate(() => document.activeElement?.id);
  check('the card opens', await view.isVisible());

  // v: the panel; no Verify file on this machine yet, so it says where the file goes, and there are no tabs.
  await page.keyboard.press('v');
  await sleep(400);
  check('v opens Verify, which says where the machine’s file goes', await view.getByText(/from a file on this machine/).isVisible() && await view.getByText(VERIFY_FILE.split('/').pop(), { exact: false }).first().isVisible());
  check('no setup form, and no tabs until something is set up', (await page.locator('#verify-setup').count()) === 0 && (await view.getByRole('tablist', { name: 'Verify tools' }).count()) === 0);
  await shot(page, 'no-file');

  // The file, written while the panel is open: the tabs show by name, the lookup first (the test-data tool isn't set up).
  fs.writeFileSync(VERIFY_FILE, JSON.stringify({
    set: { name: 'Sample set', urls: { dev: DEV, uat: UAT }, addPage: 'Home/AddToSet' },
    lookup: { name: 'Sample lookup', url: LOOKUP, page: LOOKUP_PAGE, recordField: 'RecordId' },
  }, null, 2));
  const tabs = view.getByRole('tablist', { name: 'Verify tools' });
  check('the file shows within seconds: a tab per tool, by name', await until(async () => (await tabs.getByRole('tab').allInnerTexts()).join('|') === 'Test data|Sample lookup|Sample set', 10000), (await tabs.getByRole('tab').allInnerTexts().catch(() => [])).join('|'));
  const selected = async () => (await tabs.getByRole('tab', { selected: true }).innerText()).trim();
  check('it opens on the first tool set up (the lookup)', await selected() === 'Sample lookup' && /Look up in Sample lookup/.test(await view.innerText()));
  check('the note about the file goes', !(await view.getByText(/from a file on this machine/).count()));

  // Alt+→: the field set. i, a made-up id, Esc, Enter: Dev and UAT side by side.
  await page.keyboard.press('Alt+ArrowRight');
  check('Alt+→ goes to the next section', await until(async () => await selected() === 'Sample set'));
  await page.keyboard.press('Alt+ArrowRight');
  check('…round to the first', await until(async () => await selected() === 'Test data') && /isn’t set up on this machine/.test(await view.innerText()));
  await shot(page, 'builder-not-set-up');
  await page.keyboard.press('Alt+ArrowLeft');
  check('Alt+← goes back', await until(async () => await selected() === 'Sample set'));
  check('the ids box starts with the ids the card names', (await page.locator('#verify-ids').inputValue()) === 'CX.SAMPLE.ONE\n1000', JSON.stringify(await page.locator('#verify-ids').inputValue()));
  await page.keyboard.press('i');
  check('i puts the cursor in the ids box', await until(async () => (await focused()) === 'verify-ids'));
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

  // Alt+←: the lookup. l, a record, Enter: the Fields box is empty, so the ids box's ids are read.
  await page.keyboard.press('Alt+ArrowLeft');
  await until(async () => await selected() === 'Sample lookup');
  await page.keyboard.press('l');
  check('l puts the cursor in the record box', await until(async () => (await focused()) === 'verify-record'));
  await page.keyboard.type('5001');
  await page.keyboard.press('Enter');
  const values = view.getByRole('table', { name: 'Record values' });
  const looked = await until(async () => (await values.locator('tbody tr').count()) === 3);
  check('Enter in the record box looks it up (the ids box’s ids, the Fields box being empty)', looked, looked ? '' : `${await page.locator('#verify-record').inputValue()} | ${(await view.innerText()).replace(/\s+/g, ' ').slice(-500)}`);
  if (!looked) { await shot(page, 'lookup-failed'); throw new Error('stop'); }
  check('found values show, entities decoded, read-only marked', /12\.50/.test(await values.innerText()) && /Yes & no/.test(await values.innerText()) && /read-only/.test(await values.innerText()));
  check('a field the record lacks says it does not exist', /does not exist/.test(await values.locator('tbody tr', { hasText: 'MADEUP' }).innerText()));
  const post = standin().filter((r) => r.tool === 'lookup' && r.method === 'POST').at(-1);
  check('the lookup posted Dev with Advanced off', post?.env === 'Dev' && post?.advanced === 'false', JSON.stringify(post));
  check('a chip for the record fetched, with its environment', /5001\s*Dev/.test(await view.getByLabel('Recent records').innerText()));

  // i: the Fields box, ids one per line, one with a space; Shift+S saves them as a list.
  await page.keyboard.press('i');
  check('i in the lookup puts the cursor in the Fields box', await until(async () => (await focused()) === 'verify-fields'));
  await page.keyboard.type('1000\nGroup.Name.Role Name\nCX.EMPTY\nCX.GONE');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+S');
  check('Shift+S asks for the list’s name', await until(async () => (await focused()) === 'verify-listname'));
  await page.keyboard.type('Sample basics');
  await page.keyboard.press('Enter');
  const savedList = await until(async () => fs.existsSync(LISTS_FILE) && JSON.parse(fs.readFileSync(LISTS_FILE, 'utf8')).lists?.[0]?.name === 'Sample basics');
  check('Enter saves it to the machine’s lists file, the id with a space whole', savedList && JSON.stringify(JSON.parse(fs.readFileSync(LISTS_FILE, 'utf8')).lists[0].ids) === JSON.stringify(['1000', 'Group.Name.Role Name', 'CX.EMPTY', 'CX.GONE']), savedList ? fs.readFileSync(LISTS_FILE, 'utf8').replace(/\s+/g, ' ') : 'none');
  check('the picker offers it', await until(async () => (await page.locator('#verify-list option').allInnerTexts()).includes('Sample basics (4)')));
  // A list written into the file by hand shows too (the file is watched).
  fs.writeFileSync(LISTS_FILE, JSON.stringify({ lists: [...JSON.parse(fs.readFileSync(LISTS_FILE, 'utf8')).lists, { name: 'By hand', ids: ['1000'] }] }));
  check('a list added to the file by hand shows within seconds', await until(async () => (await page.locator('#verify-list option').allInnerTexts()).includes('By hand (1)'), 10000));

  // The Fields box emptied, then f and the arrows choose the list again; Enter looks it up.
  await page.locator('#verify-fields').fill('');
  await page.keyboard.press('Escape');
  await page.locator('#verify-list').selectOption('');
  await page.keyboard.press('f');
  check('f puts the cursor on the list picker', await until(async () => (await focused()) === 'verify-list'));
  await page.locator('#verify-list').selectOption('Sample basics');
  check('choosing a list fills the Fields box', await until(async () => (await page.locator('#verify-fields').inputValue()) === '1000\nGroup.Name.Role Name\nCX.EMPTY\nCX.GONE'));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  check('Enter looks the list up: an id with a space is read as one', await until(async () => (await values.locator('tbody tr').count()) === 4 && /Sample role/.test(await values.innerText())), (await values.innerText().catch(() => '')).replace(/\s+/g, ' '));
  const listPost = standin().filter((r) => r.tool === 'lookup' && r.method === 'POST').at(-1);
  check('the form carried the ids one per line, the space kept', listPost?.ids?.join('|') === '1000|Group.Name.Role Name|CX.EMPTY|CX.GONE', JSON.stringify(listPost?.ids));
  await shot(page, 'record-list');

  // / filters; Shift+M only the empty or missing; Shift+Y copies the rows shown.
  await page.keyboard.press('/');
  check('/ puts the cursor in the filter', await until(async () => (await focused()) === 'verify-filter'));
  await page.keyboard.type('role');
  check('the filter leaves the matching row', await until(async () => (await values.locator('tbody tr').count()) === 1));
  await page.keyboard.press('Enter');
  await page.locator('#verify-filter').fill('');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+M');
  check('Shift+M leaves only the empty and missing fields', await until(async () => (await values.locator('tbody tr').count()) === 2 && /CX\.EMPTY/.test(await values.innerText()) && /CX\.GONE/.test(await values.innerText())));
  await page.keyboard.press('Shift+Y');
  // Windows' clipboard hands lines back with CRLF.
  check('Shift+Y copies the rows shown as field=value lines', await until(async () => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n') === 'CX.EMPTY=\nCX.GONE='),JSON.stringify(await page.evaluate(() => navigator.clipboard.readText())));
  await shot(page, 'only-empty');
  await page.keyboard.press('Shift+M');

  // a: Advanced; a record that isn't there.
  await page.keyboard.press('a');
  await page.keyboard.press('l');
  await until(async () => (await focused()) === 'verify-record');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('9999');
  await page.keyboard.press('Enter');
  check('a record that isn’t there: No record found', await until(async () => /No record found: 9999/.test(await view.innerText())));
  check('a turns Advanced on for the lookup', standin().filter((r) => r.tool === 'lookup' && r.method === 'POST').at(-1)?.advanced === 'true');
  check('no chip for a record not found', !/9999/.test(await view.getByLabel('Recent records').innerText()));

  // e: UAT, and the lookup follows; Shift+P twice: Prod.
  await page.keyboard.press('e');
  check('e switches to UAT', await until(async () => (await view.getByRole('radio', { name: 'UAT' }).getAttribute('aria-checked')) === 'true'));
  // The record box: ↑ brings back the record fetched lately, with its environment.
  await page.keyboard.press('l');
  await until(async () => (await focused()) === 'verify-record');
  await page.keyboard.press('ArrowUp');
  check('↑ in the record box: the recent record and its environment', await until(async () => (await page.locator('#verify-record').inputValue()) === '5001' && (await view.getByRole('radio', { name: 'Dev' }).getAttribute('aria-checked')) === 'true'));
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  await view.getByLabel('Recent records').getByRole('button', { name: /5001/ }).click();
  check('a chip fills the box and sets its environment', await until(async () => (await view.getByRole('radio', { name: 'Dev' }).getAttribute('aria-checked')) === 'true'));
  await page.keyboard.press('Shift+P');
  await sleep(150);
  check('one Shift+P only asks', (await view.getByRole('radio', { name: 'Prod' }).getAttribute('aria-checked')) === 'false');
  await page.keyboard.press('Shift+P');
  check('a second Shift+P chooses Prod', await until(async () => (await view.getByRole('radio', { name: 'Prod' }).getAttribute('aria-checked')) === 'true'));
  await page.keyboard.press('Enter');
  check('a lookup on Prod posts Prod', await until(async () => standin().filter((r) => r.tool === 'lookup' && r.method === 'POST').at(-1)?.env === 'Prod'));
  check('…and adds no chip (Prod stays two presses away)', !/Prod/.test(await view.getByLabel('Recent records').innerText()));
  await shot(page, 'prod');
  await page.keyboard.press('Shift+P');
  await page.keyboard.press('e');
  check('Shift+P on Prod goes back to Dev, then e to UAT', await until(async () => (await view.getByRole('radio', { name: 'UAT' }).getAttribute('aria-checked')) === 'true'));

  // o in the lookup, Shift+L anywhere: the lookup's own page; o and Shift+O in the field set: its pages (UAT now).
  const opened = async (k) => { const [tab] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }).catch(() => null), page.keyboard.press(k)]); const u = tab ? tab.url() : 'none'; if (tab) await tab.close(); return u; };
  const lookupO = await opened('o');
  await page.keyboard.press('Alt+ArrowRight');
  await until(async () => await selected() === 'Sample set');
  const setO = await opened('o');
  const addO = await opened('Shift+O');
  const lookupL = await opened('Shift+L');
  check('o opens the lookup’s own page (not where it posts); in the set, o and Shift+O open UAT’s pages; Shift+L the lookup’s page', lookupO === LOOKUP_PAGE && setO === `${UAT}/` && addO === `${UAT}/Home/AddToSet` && lookupL === LOOKUP_PAGE, [lookupO, setO, addO, lookupL].join(' | '));
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

  // Shift+F twice deletes the chosen list.
  await page.keyboard.press('Alt+ArrowLeft');
  await until(async () => await selected() === 'Sample lookup');
  await page.keyboard.press('Shift+F');
  const asked = await until(async () => (await page.getByText(/Shift\+F again to delete the list “Sample basics”/).count()) > 0, 3000);
  check('one Shift+F only asks', asked && JSON.parse(fs.readFileSync(LISTS_FILE, 'utf8')).lists.length === 2, `${asked} ${await focused()} ${await page.locator('#verify-list').inputValue().catch(() => '?')}`);
  await page.keyboard.press('Shift+F');
  check('a second Shift+F deletes the chosen list from the file', await until(async () => JSON.stringify(JSON.parse(fs.readFileSync(LISTS_FILE, 'utf8')).lists.map((l) => l.name)) === '["By hand"]'), fs.readFileSync(LISTS_FILE, 'utf8').replace(/\s+/g, ' ').slice(0, 200));
  await shot(page, 'lookup-tab');

  // For the test-data part's f below: a list chosen (the one left), and Advanced on (f turns it off).
  await page.locator('#verify-list').selectOption('By hand');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('a');

  // ---- Test data (§133): the scenario runner on this machine (stand-in on 18903) ----
  // First set up at a port where nothing listens: the section says the tool isn't running, with the start hint.
  const cfg = JSON.parse(fs.readFileSync(VERIFY_FILE, 'utf8'));
  fs.writeFileSync(VERIFY_FILE, JSON.stringify({ ...cfg, builder: { name: 'Sample data', url: 'http://127.0.0.1:18909', ui: BUILDER_UI, start: 'run the sample tool' } }, null, 2));
  await until(async () => (await tabs.getByRole('tab').allInnerTexts()).includes('Sample data'), 10000);
  // Prod chosen in the lookup gives way to Dev on entering the test-data section.
  await page.keyboard.press('Shift+P');
  await page.keyboard.press('Shift+P');
  await until(async () => (await view.getByRole('radio', { name: 'Prod' }).getAttribute('aria-checked')) === 'true');
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Alt+ArrowRight');
  check('the test-data tab, by its name', await until(async () => await selected() === 'Sample data'));
  check('entering it on Prod switches to Dev, and there is no Prod pill', await until(async () => (await view.getByRole('radio', { name: 'Dev' }).getAttribute('aria-checked')) === 'true' && !(await view.getByRole('radio', { name: 'Prod' }).count())));
  check('a tool that isn’t running says so, with the start hint', await until(async () => /Sample data isn’t running here\. To start it: run the sample tool/.test(await view.innerText())));
  check('…and its tab’s dot says it isn’t running', (await tabs.getByRole('tab', { name: 'Sample data' }).getAttribute('title')) === 'Not running here');
  await shot(page, 'builder-not-running');
  fs.writeFileSync(VERIFY_FILE, JSON.stringify({ ...cfg, builder: { name: 'Sample data', url: BUILDER, ui: BUILDER_UI, start: 'run the sample tool' } }, null, 2));
  await sleep(3500);
  await page.keyboard.press('r');
  const scen = view.getByRole('listbox', { name: 'Scenarios' });
  check('r reads the scenarios: name, tags, a lock, the version', await until(async () => (await scen.getByRole('option').count()) === 3) && /Sample failing[\s\S]*locked[\s\S]*v2/.test(await scen.innerText()), (await scen.innerText().catch(() => '')).replace(/\s+/g, ' '));
  await page.keyboard.press('Shift+P');
  await sleep(150);
  check('Shift+P here does nothing (no Prod for test data)', (await view.getByRole('radio', { name: 'Dev' }).getAttribute('aria-checked')) === 'true' && (await page.getByText(/no Prod here/).count()) > 0);
  await page.keyboard.press('/');
  check('/ puts the cursor in the scenario filter', await until(async () => (await focused()) === 'verify-bfilter'));
  await page.keyboard.type('refi');
  check('the filter leaves the matching scenario', await until(async () => (await scen.getByRole('option').count()) === 1 && /Sample refinance/.test(await scen.innerText())));
  await page.locator('#verify-bfilter').fill('');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  check('↓ chooses the next scenario', await until(async () => /Sample failing/.test(await scen.getByRole('option', { selected: true }).innerText())));
  const builderPosts = () => standin().filter((r) => r.tool === 'builder' && r.method === 'POST').length;
  await page.keyboard.press('Enter');
  check('the first Enter only arms, naming the environment and the scenario', await until(async () => /Enter again to create a loan in Dev with Sample failing/.test(await view.innerText())) && builderPosts() === 0);
  await shot(page, 'builder-armed');
  await page.keyboard.press('Enter');
  check('the second Enter starts the run in Dev', await until(async () => builderPosts() === 1 && standin().filter((r) => r.tool === 'builder' && r.method === 'POST').at(-1).env === 'dev'));
  const runBox = view.getByLabel('Run');
  check('a failing run: the chip says Failed, the step its message (no stack trace)', await until(async () => /Failed/.test(await runBox.getByRole('status').innerText()) && /Sample step failed: the made-up service said no/.test(await runBox.innerText()), 20000) && !/Secret/.test(await runBox.innerText()));
  await shot(page, 'builder-failed');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  check('Sample purchase runs: Running, then Succeeded after three polls', await until(async () => /Running/.test(await runBox.getByRole('status').innerText())) && await until(async () => /Succeeded/.test(await runBox.getByRole('status').innerText()), 20000));
  const loan = standin().filter((r) => r.tool === 'builder' && r.method === 'GET' && r.path.startsWith('/api/runs/')).length >= 3;
  check('the page polled the run (every 2 s) until it ended', loan);
  const guidText = (await runBox.innerText()).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  check('the loan it made shows', Boolean(guidText), (await runBox.innerText()).replace(/\s+/g, ' '));
  await shot(page, 'builder-succeeded');
  await page.keyboard.press('Shift+Y');
  check('Shift+Y copies the loan id', await until(async () => (await page.evaluate(() => navigator.clipboard.readText())).trim() === guidText));
  const [uiTab] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }).catch(() => null), page.keyboard.press('o')]);
  check('o opens the tool’s own page', uiTab?.url() === BUILDER_UI, uiTab?.url() ?? 'none');
  if (uiTab) await uiTab.close();
  // f: the loan, fetched in the lookup: its environment, the chosen list (By hand, chosen above), Advanced off.
  await page.keyboard.press('Alt+ArrowLeft');
  await until(async () => await selected() === 'Sample set');
  await page.keyboard.press('Alt+ArrowRight');
  check('the run is still there after moving between sections', await until(async () => await selected() === 'Sample data') && /Succeeded/.test(await runBox.getByRole('status').innerText()));
  await page.keyboard.press('f');
  check('f: the lookup, with the loan in the record box, in Dev', await until(async () => await selected() === 'Sample lookup' && (await page.locator('#verify-record').inputValue()) === guidText && (await view.getByRole('radio', { name: 'Dev' }).getAttribute('aria-checked')) === 'true'));
  const fetched = await until(async () => standin().filter((r) => r.tool === 'lookup' && r.method === 'POST').some((r) => r.ids.join('|') === '1000' && r.advanced === 'false'));
  check('…and it fetched with the chosen list, Advanced off', fetched, JSON.stringify(standin().filter((r) => r.tool === 'lookup' && r.method === 'POST').at(-1)));
  check('…and a chip names the scenario', await until(async () => /Sample purchase/.test(await view.getByLabel('Recent records').innerText())));
  await shot(page, 'builder-fetched');
  const bfrom = standin().filter((r) => r.tool === 'builder' && !/Chrome|Mozilla/.test(r.agent));
  const bbad = bfrom.filter((r) => r.flagged || r.query || !((r.method === 'GET' && (r.path === '/api/scenarios' || /^\/api\/runs\/[\w-]+$/.test(r.path))) || (r.method === 'POST' && /^\/api\/scenarios\/[\w-]+\/versions\/\d+\/runs$/.test(r.path) && JSON.stringify(r.body) === '["environment"]')));
  check('the server sent the test-data tool only the list, a run’s start ({ environment }) and its status', bfrom.length > 0 && bbad.length === 0, `${bfrom.length} requests, ${bbad.length} others ${JSON.stringify(bbad.slice(0, 2))}`);

  // ---- Updates through the lookup (§134) ----
  const flashed = async (re) => until(async () => (await page.getByText(re).count()) > 0, 3000);
  const fieldsBox = '1000\nCX.SAMPLE.ONE\nGroup.Name.Role Name\nCX.EMPTY\nCX.AMOUNT\nCX.GONE';
  const lookUp = async (record) => {
    await page.locator('#verify-fields').fill(fieldsBox);
    await page.locator('#verify-record').fill(record);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Enter');
    await until(async () => (await values.locator('tbody tr').count()) === 6);
  };
  const advancedOn = async () => { if (!(await view.getByLabel(/Advanced/).isChecked())) await page.keyboard.press('a'); };
  // With allowUpdate off: no edit UI; u says why.
  await advancedOn();
  await lookUp('5001');
  await page.keyboard.press('u');
  check('updates off: no edit UI, and u says they are off', (await page.locator('#verify-edit').count()) === 0 && await flashed(/Updates through Sample lookup are off on this machine/) && !(await view.getByLabel('Staged changes').count()));
  // Switched on in the file (no restart): the update form's address, allowUpdate, the record's own fields.
  fs.writeFileSync(VERIFY_FILE, JSON.stringify({ ...JSON.parse(fs.readFileSync(VERIFY_FILE, 'utf8')), lookup: { ...cfg.lookup, updateUrl: 'http://127.0.0.1:18902/LookupUpdate', allowUpdate: true, updateFields: ['RecordNumber', 'RecordFolder'] } }, null, 2));
  await sleep(3500);
  await lookUp('5001');
  check('updates on: the lookup says how to change a row', await until(async () => /a row, .*edit it/.test((await view.innerText()).replace(/\s+/g, ' '))));
  const row = (id) => values.locator('tbody tr', { hasText: id });
  const select = async (id) => { for (let i = 0; i < 8 && (await row(id).getAttribute('aria-selected')) !== 'true'; i++) await page.keyboard.press('ArrowDown'); };
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  check('↑ ↓ choose a row', (await row('1000').getAttribute('aria-selected')) === 'true');
  await page.keyboard.press('u');
  check('a read-only row can’t be edited, and says so', (await page.locator('#verify-edit').count()) === 0 && await flashed(/1000 is read-only/));
  await select('CX.SAMPLE.ONE');
  await page.keyboard.press('u');
  check('u on a field with options: a select of them', await until(async () => (await page.locator('select#verify-edit').count()) === 1) && JSON.stringify(await page.locator('select#verify-edit option').allInnerTexts()) === JSON.stringify(['Yes & no', 'No']));
  await page.locator('select#verify-edit').selectOption('No');
  await page.keyboard.press('Enter');
  check('Enter stages it: old → new', await until(async () => /Yes & no → No/.test(await row('CX.SAMPLE.ONE').innerText())));
  await select('Group.Name.Role Name');
  await page.keyboard.press('Backspace');
  check('Backspace stages a clear: old → (empty)', await until(async () => /Sample role → \(empty\)/.test(await row('Group.Name.Role Name').innerText())));
  await page.keyboard.press('z');
  check('z takes it back', await until(async () => !/→/.test(await row('Group.Name.Role Name').innerText())));
  await page.keyboard.press('u');
  await until(async () => (await focused()) === 'verify-edit');
  await page.keyboard.press('End');
  await page.keyboard.type(' two');
  await page.keyboard.press('Enter');
  check('u on a text field: a box; Enter stages', await until(async () => /Sample role → Sample role two/.test(await row('Group.Name.Role Name').innerText())));
  await select('CX.EMPTY');
  await page.keyboard.press('u');
  await until(async () => (await focused()) === 'verify-edit');
  await page.keyboard.press('Enter');
  check('an empty edit is no change', await flashed(/An empty edit is no change/) && !/→/.test(await row('CX.EMPTY').innerText()));
  await select('CX.AMOUNT');
  await page.keyboard.press('u');
  await until(async () => (await focused()) === 'verify-edit');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('2500');
  await page.keyboard.press('Enter');
  await select('CX.GONE');
  await page.keyboard.press('u');
  check('a missing field can’t be edited, and says so', await flashed(/CX\.GONE does not exist/));
  const strip = view.getByLabel('Staged changes');
  check('the review strip: 3 staged in Dev for the record, each old → new', await until(async () => /3 staged in Dev for 5001/.test(await strip.innerText())) && /CX\.AMOUNT: 1,250\.00 → 2500/.test((await strip.innerText()).replace(/\s+/g, ' ')));
  await shot(page, 'update-staged');
  const updates = () => standin().filter((r) => r.tool === 'lookup-update');
  await page.keyboard.press('Shift+U');
  check('the first Shift+U only arms, naming the count and Dev', await until(async () => /Shift\+U again to send 3 field\(s\) to Dev/.test(await strip.innerText())) && updates().length === 0);
  await page.keyboard.press('Shift+U');
  check('the second sends: one request to the update form, the three fields ticked', await until(async () => updates().length === 1) && JSON.stringify(updates()[0].ids) === JSON.stringify(['CX.SAMPLE.ONE', 'Group.Name.Role Name', 'CX.AMOUNT']) && updates()[0].env === 'Dev', JSON.stringify(updates()[0]));
  const allowedNames = new Set(['Environment', 'RecordId', 'RecordNumber', 'RecordFolder', 'FieldsToFetch', 'AssignedRoles[].Id', 'AssignedRoles[].Name', 'Fields[].Value', 'Fields[].Exists', 'Fields[].ReadOnly', 'Fields[]', 'FieldsToUpdate[].Value', 'FieldsToUpdate[].ShouldUpdate']);
  check('…carrying only the update form’s names', updates()[0]?.names.every((k) => allowedNames.has(k)), JSON.stringify(updates()[0]?.names));
  const sentBox = view.getByLabel('Update sent');
  check('Sent 3 field(s): the tool applies them in a couple of minutes', await until(async () => /Sent 3 field\(s\) to Dev\. The tool applies these in a couple of minutes/.test(await sentBox.innerText())));
  check('the rows go pending first', await until(async () => (await values.locator('[data-after="pending"]').count()) === 3, 15000));
  await shot(page, 'update-pending');
  check('…then applied (the amount’s commas aside), and it says Applied', await until(async () => (await values.locator('[data-after="applied"]').count()) === 3 && /Applied\./.test(await sentBox.innerText()), 40000), (await values.innerText()).replace(/\s+/g, ' '));
  check('…each row showing the value now there', /^CX\.SAMPLE\.ONE\s+No/.test((await row('CX.SAMPLE.ONE').innerText()).trim()) && /Sample role two/.test(await row('Group.Name.Role Name').innerText()) && /2,500\.00/.test(await row('CX.AMOUNT').innerText()), (await values.innerText()).replace(/\s+/g, ' '));
  await shot(page, 'update-applied');
  const checks = standin().filter((r) => r.tool === 'lookup' && r.method === 'POST' && r.ids.join('|') === 'CX.SAMPLE.ONE|Group.Name.Role Name|CX.AMOUNT');
  check('the checks fetched only the changed rows, without Advanced', checks.length >= 2 && checks.every((r) => r.advanced === 'false'), `${checks.length}`);
  const [watch] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }).catch(() => null), page.keyboard.press('w')]);
  check('w opens the tool’s progress page for the record', watch?.url() === 'http://127.0.0.1:18902/Watch/5001', watch?.url() ?? 'none');
  if (watch) await watch.close();
  check('Changed this session lists the three, old → new', /Changed this session \(3\)/.test(await view.innerText()) && /CX\.SAMPLE\.ONE: Yes & no → No/.test(await view.innerText()));
  await page.keyboard.press('u');
  check('to change more, fetch again', await flashed(/To change more, fetch the record again/));
  // Prod: nothing to edit, and Shift+U says no.
  await page.keyboard.press('Shift+P'); await page.keyboard.press('Shift+P');
  await until(async () => (await view.getByRole('radio', { name: 'Prod' }).getAttribute('aria-checked')) === 'true');
  await lookUp('5001');
  await page.keyboard.press('u');
  check('Prod: no edit, u says no', (await page.locator('#verify-edit').count()) === 0 && await flashed(/No updates in Prod/));
  await page.keyboard.press('Shift+U');
  check('Prod: Shift+U says no, and no strip', await flashed(/No updates in Prod/) && !(await strip.count()) && updates().length === 1);
  await shot(page, 'update-prod');
  await page.keyboard.press('Shift+P');
  // allowUpdate removed (no restart): the edit UI goes.
  fs.writeFileSync(VERIFY_FILE, JSON.stringify({ ...JSON.parse(fs.readFileSync(VERIFY_FILE, 'utf8')), lookup: { ...cfg.lookup, updateUrl: 'http://127.0.0.1:18902/LookupUpdate', updateFields: ['RecordNumber', 'RecordFolder'] } }, null, 2));
  await sleep(3500);
  await lookUp('5001');
  await page.keyboard.press('u');
  check('allowUpdate removed: the edit UI is gone', (await page.locator('#verify-edit').count()) === 0 && await flashed(/are off on this machine/) && !/a row, .*edit it/.test((await view.innerText()).replace(/\s+/g, ' ')));
  check('the role and move forms were never reached', !standin().some((r) => r.tool === 'lookup-other'));

  await page.keyboard.press('v');
  await sleep(200);
  const say = page.locator('#card-say');
  if (await say.count()) {
    await page.evaluate(() => navigator.clipboard.writeText('PASTED.ID'));
    await say.focus();
    await page.keyboard.press('Control+v');
    check('Ctrl+V pastes into the message box', (await say.inputValue()).includes('PASTED.ID'), JSON.stringify(await say.inputValue()));
    await say.fill('');
    await page.keyboard.press('Escape');
  }

  // The ? overlay has the panel's rows.
  await page.keyboard.press('Shift+Slash');
  await sleep(400);
  check('the ? overlay has the Verify rows, a set per section', (await page.getByText(/Verify: record lookup/).count()) > 0 && (await page.getByText(/Verify: field set/).count()) > 0 && (await page.getByText(/Verify panel: The previous \/ next section/).count()) > 0);
  await page.keyboard.press('Escape');

  // What the app's server sent the tools: only the reads and the lookup form, never a Save or update.
  const fromServer = standin().filter((r) => r.tool !== 'builder' && r.tool !== 'lookup-update' && !/Chrome|Mozilla/.test(r.agent));
  const bad = fromServer.filter((r) => !((r.method === 'GET' && /^\/Home\/(SetVersion|ValidateField)$/.test(r.path)) || (r.method === 'POST' && r.path === '/Lookup')));
  check('the server sent only SetVersion, ValidateField and the lookup form', fromServer.length > 0 && bad.length === 0, `${fromServer.length} requests, ${bad.length} others ${JSON.stringify(bad.slice(0, 2))}`);
  check('every lookup POST carried only the four form fields', fromServer.filter((r) => r.tool === 'lookup').every((r) => r.fields.every((f) => ['Environment', 'RecordId', 'AdvancedFetch', 'FieldsToFetch'].includes(f))));
  check('nothing reached a Save; the one update is the one sent with updates on', !standin().some((r) => /save/i.test(r.path)) && standin().filter((r) => /update/i.test(r.path)).length === 1);
  check('the server log has no update’s field, value or record', !/Sample role two|CX\.AMOUNT|2500|LookupUpdate/.test(fs.existsSync(SERVER_LOG) ? fs.readFileSync(SERVER_LOG, 'utf8') : ''));
  const serverLog = fs.existsSync(SERVER_LOG) ? fs.readFileSync(SERVER_LOG, 'utf8') : '';
  check('the server log has no looked-up value, record id or field id', !/12\.50|Yes & no|Sample role|5001|Group\.Name/.test(serverLog));
  check('…nor a loan id or a step message', !/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}|Sample step failed|Sample run failed/.test(serverLog));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
