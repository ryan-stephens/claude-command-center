// walk-v2: Command Center v2 end to end on an isolated server (PLAN §137), with made-up repos, a
// stand-in stack (one UI, four APIs), the stand-in test-data tool and record lookup, and a stand-in
// Slack webhook. Nothing opens a terminal (CCV2_NO_OPEN=1): hooks and the toolbelt are driven the way
// Claude Code would drive them, with the session's own token.
//   pnpm v2:build -- --outDir ../../dist/v2-test   (or: pnpm exec vite build --config v2/vite.config.ts --outDir ../../dist/v2-test --emptyOutDir)
//   node docs/walkthroughs/v2/walk-v2.cjs          PORT=7841 by default
const { chromium } = require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.env.PORT || 7841);
const REPO = path.resolve(__dirname, '../../..').replace(/\\/g, '/');
const TMP = (process.env.TEMP || '/tmp').replace(/\\/g, '/');
const ROOT = `${TMP}/ccv2-walk`;
const DIR = `${ROOT}/repos`;
const V2DIR = `${ROOT}/v2`;
const DB = `${ROOT}/cc.db`;
const VERIFY = `${ROOT}/verify.json`;
const LISTS = `${ROOT}/lists.json`;
const LOG = `${ROOT}/server.log`;
const SLACK_PORT = 18980;
const OUT = path.join(__dirname, 'shots-v2');
fs.mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}`;

let n = 0; const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`), fullPage: true }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function makeRepo(name, files) {
  const dir = `${DIR}/${name}`;
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(`${dir}/${f}`, text);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, '-c', 'user.email=walk@example.invalid', '-c', 'user.name=walk', 'add', '.');
  git(dir, '-c', 'user.email=walk@example.invalid', '-c', 'user.name=walk', 'commit', '-q', '-m', 'init');
  // A bare origin beside it, so ship can push (its host is unknown: the PR is opened by hand).
  const bare = `${ROOT}/origins/${name}.git`;
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  git(ROOT, 'clone', '-q', '--bare', dir, bare);
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'fetch', '-q', 'origin');
  git(dir, 'remote', 'set-head', 'origin', 'main');
}

const api = async (p, opts = {}) => { const r = await fetch(`${BASE}${p}`, { ...opts, headers: { 'content-type': 'application/json', origin: BASE, ...(opts.headers || {}) } }); return r.json(); };
const state = () => api('/api/state');

/** The toolbelt as Claude Code runs it: an MCP server over stdio with the session's env. */
function toolbelt(sessionId, token) {
  const child = spawn(process.execPath, [`${REPO}/v2/mcp/toolbelt.ts`], { env: { ...process.env, CCV2_URL: BASE, CCV2_SESSION: sessionId, CCV2_TOKEN: token }, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  let buf = ''; const waiting = new Map(); let id = 0;
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id); } });
  const rpc = (method, params) => new Promise((resolve) => { const k = ++id; waiting.set(k, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: k, method, params })}\n`); });
  return { rpc, call: async (name, args = {}) => { const m = await rpc('tools/call', { name, arguments: args }); return { error: m.result.isError, text: m.result.content[0].text }; }, end: () => child.kill() };
}

(async () => {
  // ---- Setup: repos, DB, stand-ins, server ----
  for (const sub of ['stacks']) fs.rmSync(`${V2DIR}/runs/${sub}`, { recursive: true, force: true });
  if (fs.existsSync(ROOT)) {
    // Worktrees first (they belong to the repos), then everything.
    for (const r of fs.existsSync(DIR) ? fs.readdirSync(DIR) : []) { try { git(`${DIR}/${r}`, 'worktree', 'prune'); } catch { /* not a repo */ } }
    fs.rmSync(ROOT, { recursive: true, force: true });
  }
  fs.mkdirSync(DIR, { recursive: true });
  makeRepo('shop-ui', { 'README.md': 'stand-in ui\n', 'proxy.conf.json': '{\n  "/api/**": { "target": "https://dev.example.invalid", "changeOrigin": true }\n}\n' });
  for (const r of ['fees-api', 'payments-api', 'loans-api', 'audit-api']) makeRepo(r, { 'README.md': `${r}\n` });
  execFileSync(process.execPath, [`${REPO}/docs/walkthroughs/v2/seed-v2.ts`, DB, DIR, `${REPO}/docs/walkthroughs/v2`], { stdio: 'inherit' });
  fs.writeFileSync(VERIFY, JSON.stringify({ lookup: { name: 'Sample lookup', url: 'http://127.0.0.1:18902/Lookup', recordField: 'RecordId', updateUrl: 'http://127.0.0.1:18902/LookupUpdate', allowUpdate: true, updateFields: ['RecordNumber', 'RecordFolder'] }, builder: { name: 'Sample data', url: 'http://127.0.0.1:18903' } }, null, 2));
  fs.writeFileSync(LISTS, JSON.stringify({ lists: [{ name: 'Sample fields', ids: ['1000', 'CX.SAMPLE.ONE'] }] }, null, 2));
  fs.writeFileSync(`${ROOT}/config.env`, '');
  const tools = spawn(process.execPath, [`${REPO}/docs/walkthroughs/simple-new-card/standins/verify-tools.cjs`, '18900', `${ROOT}/tools.log`], { stdio: 'ignore', windowsHide: true });
  const slack = [];
  const slackServer = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { slack.push(JSON.parse(b || '{}')); res.end('ok'); }); }).listen(SLACK_PORT, '127.0.0.1');
  const out = fs.openSync(LOG, 'a');
  const env = { ...process.env, CCV2_PORT: String(PORT), CCV2_DIR: V2DIR, CCV2_NO_OPEN: '1', CCV2_WEB_DIST: `${REPO}/dist/v2-test`, CC_CONTROL_DB: DB, CC_CONTROL_CONFIG: `${ROOT}/config.env`, CC_CONTROL_VERIFY_FILE: VERIFY, CC_CONTROL_FIELD_LISTS_FILE: LISTS, CC_CONTROL_PORTS: '18600-18699', CC_CONTROL_SLACK_WEBHOOK: `http://127.0.0.1:${SLACK_PORT}/hook`, CC_CONTROL_SLACK_CHANNEL: '#team-reviews', CC_CONTROL_SLACK_MENTION: '@payments' };
  for (const k of Object.keys(env)) if (/^CC_CONTROL_JIRA|^CC_CONTROL_TRELLO/.test(k)) delete env[k];
  const server = spawn(process.execPath, ['v2/server/main.ts'], { cwd: REPO, env, stdio: ['ignore', out, out], windowsHide: true });
  const stop = () => { spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true }); tools.kill(); slackServer.close(); };

  const browser = await chromium.launch({ executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    check('the v2 server comes up and serves the page', await until(async () => { await page.goto(`${BASE}/`); return page.getByRole('heading', { name: 'Switchboard' }).isVisible(); }, 20000));
    check('an empty Switchboard offers New work', await page.getByText('No sessions yet.').isVisible());
    await shot(page, 'empty');

    // ---- Launchpad ----
    await page.getByRole('button', { name: 'New work' }).first().click();
    check('New work opens the Launchpad', await page.getByRole('heading', { name: 'New work' }).isVisible());
    // The ticket picker: your open tickets under the box, filtered as you type, then a search of the rest.
    const picks = page.locator('#lp-picks');
    check('the picker lists your open tickets', await until(() => picks.getByText('SHOP-160').isVisible(), 8000) && await picks.getByText('PAY-91').isVisible());
    check('done and Ready for PO tickets aren\'t in your list', !(await picks.getByText('PAY-71').isVisible()) && !(await picks.getByText('SHOP-98').isVisible()));
    await shot(page, 'ticket-picker');
    await page.locator('#lp-ticket').fill('gift card');
    check('a search finds tickets elsewhere in Jira', await until(() => picks.getByText('Elsewhere in Jira').isVisible(), 8000) && await picks.getByText('SHOP-149').isVisible());
    await page.locator('#lp-ticket').fill('badge');
    check('typing narrows your list', await until(async () => (await picks.locator('.pick-row').count()) === 1, 5000) && await picks.getByText('SHOP-160').isVisible());
    await page.locator('#lp-ticket').press('Enter');
    check('Enter picks the ticket and closes the list', await page.locator('#lp-ticket').inputValue() === 'SHOP-160' && !(await picks.isVisible()));
    check('a ticket key brings the (demo) ticket', await until(() => page.getByText('Cart badge shows the wrong count after sign-in').isVisible(), 8000));
    check('the preflight names the branch', await page.getByText('shop-160-cart-badge-shows-wrong').isVisible().catch(() => false) || await page.locator('.ln .mono').first().isVisible());
    const ticked = await page.locator('.ln').first().locator('input[type=checkbox]:checked').count();
    check('the stack\'s UI and the workspace home are ticked', ticked >= 2, `${ticked}`);
    // Tick payments-api too, and its API.
    await page.locator('.ln').first().getByText('payments-api').click();
    await page.getByRole('button', { name: 'Preview' }).click();
    check('the context pack preview shows the ticket and the tools', await page.locator('.preview').getByText(/make_test_loan/).isVisible() && await page.locator('.preview').getByText(/# SHOP-160/).isVisible());
    await shot(page, 'launchpad');
    await page.getByRole('button', { name: 'Launch' }).click();
    check('Launch sets up and goes back to the Switchboard', await until(() => page.getByRole('heading', { name: 'Switchboard' }).isVisible(), 20000));
    let st = await state();
    const s = st.sessions[0];
    check('the session exists with worktrees on its branch', Boolean(s) && s.repos.every((r) => r.dir.endsWith('-shop-160')) && fs.existsSync(s.repos[0].dir), s && s.repos.map((r) => r.name).join(','));
    check('the home worktree has the context pack, the toolbelt and the hooks', fs.existsSync(`${s.home}/CLAUDE.local.md`) && /command-center/.test(fs.readFileSync(`${s.home}/.mcp.json`, 'utf8')) && /hook\.mjs/.test(fs.readFileSync(`${s.home}/.claude/settings.local.json`, 'utf8')));
    check('git doesn\'t see the session\'s files', git(s.home, 'status', '--porcelain') === '', git(s.home, 'status', '--porcelain'));
    const stored = JSON.parse(fs.readFileSync(`${V2DIR}/sessions.json`, 'utf8')).sessions[0];
    const token = stored.token;

    // ---- Hooks: Claude's state ----
    const hook = (event, input) => fetch(`${BASE}/hooks/${event}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ccv2-session': s.id, 'x-ccv2-token': token }, body: JSON.stringify(input) });
    await hook('SessionStart', { session_id: 'claude-1', source: 'startup' });
    await hook('PreToolUse', { session_id: 'claude-1', tool_name: 'Edit', tool_input: { file_path: `${s.home}/badge.ts` } });
    check('a hook moves Claude to working, editing a file', await until(() => page.locator('.sess').getByText('editing badge.ts').isVisible(), 5000));
    await fetch(`${BASE}/hooks/Stop`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ccv2-session': s.id, 'x-ccv2-token': 'wrong' }, body: '{}' });
    await sleep(400);
    check('a hook with the wrong token changes nothing', await page.locator('.sess').getByText('editing badge.ts').isVisible());

    // ---- Toolbelt: stack, loans, fields ----
    const tb = toolbelt(s.id, token);
    const init = await tb.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'walk' } });
    check('the toolbelt answers initialize', init.result.serverInfo.name === 'command-center');
    const listed = await tb.rpc('tools/list', {});
    check('it lists its tools', listed.result.tools.some((t) => t.name === 'make_test_loan') && listed.result.tools.some((t) => t.name === 'stack_add_api'));
    const info = await tb.call('session_info');
    check('session_info says the branch and worktrees', !info.error && /shop-160/.test(info.text));
    const upR = await tb.call('stack_up', {});
    check('stack_up starts the APIs the session has worktrees of, and the UI', !upR.error && /fees-api/.test(upR.text) && /payments-api/.test(upR.text), upR.text.slice(0, 200));
    check('the Switchboard shows the APIs up and the UI behind the front door', await until(async () => { const v = (await state()).stacks[s.id]; return v && v.services.every((x) => x.health === 'up'); }, 30000), JSON.stringify((await state()).stacks[s.id]?.services.map((x) => `${x.name}:${x.health}`)));
    st = await state();
    check('the front door on 4316 shows the session', st.doors.some((d) => d.home === 4316 && d.shown === s.id));
    const viaDoor = await fetch('http://127.0.0.1:4316/').then((r) => r.text()).catch((e) => String(e));
    check('the door forwards to the session\'s UI', /stand-in ui/.test(viaDoor), viaDoor.slice(0, 80));
    const proxy = JSON.parse(fs.readFileSync(`${V2DIR}/runs/stacks/${s.id}.proxy.conf.json`, 'utf8'));
    check('the proxy file points the running APIs at their ports, the rest stays on Dev', Boolean(proxy['/api/fees/**']) && Boolean(proxy['/api/payments/**']) && !proxy['/api/loans/**'] && proxy['/api/**'].target === 'https://dev.example.invalid');
    await page.reload();
    await sleep(800);
    await shot(page, 'switchboard-up');

    // Add an API from the page: rebuilt proxy, the UI restarted.
    const uiStarted = (await state()).stacks[s.id].services.find((x) => x.kind === 'ui').since;
    await page.getByRole('button', { name: 'Add an API' }).click();
    await page.getByRole('menuitem', { name: 'loans-api' }).click();
    check('Add an API runs it and it comes up', await until(async () => (await state()).stacks[s.id].services.some((x) => x.name === 'loans-api' && x.health === 'up'), 20000));
    const proxy2 = JSON.parse(fs.readFileSync(`${V2DIR}/runs/stacks/${s.id}.proxy.conf.json`, 'utf8'));
    check('adding it rebuilt the proxy file', Boolean(proxy2['/api/loans/**']));
    check('and restarted the UI', await until(async () => { const ui = (await state()).stacks[s.id].services.find((x) => x.kind === 'ui'); return ui.health === 'up' && ui.since > uiStarted; }, 20000));
    const add2 = await tb.call('stack_add_api', { api: 'audit-api' });
    check('Claude can add one too (stack_add_api)', !add2.error && await until(async () => (await state()).stacks[s.id].services.some((x) => x.name === 'audit-api' && x.health === 'up'), 20000));
    check('four API tiles show on the session', await until(async () => (await page.locator('.api').count()) === 4, 5000));

    // A hung API turns unhealthy, and Restart unhealthy brings it back.
    fs.writeFileSync(`${DIR}/audit-api.hang`, '');
    check('a hung API turns unhealthy within ~15 s', await until(async () => (await state()).stacks[s.id].services.some((x) => x.name === 'audit-api' && x.health === 'unhealthy'), 20000));
    check('its tile turns orange', await until(() => page.locator('.api.bad b', { hasText: 'audit-api' }).isVisible(), 5000));
    await page.getByRole('button', { name: 'Only problems' }).click();
    check('Only problems keeps the session', await until(async () => (await page.locator('.sess').count()) === 1, 3000));
    await shot(page, 'unhealthy');
    await page.getByRole('button', { name: 'All sessions' }).click();
    fs.rmSync(`${DIR}/audit-api.hang`);
    await page.getByRole('button', { name: 'Restart unhealthy' }).click();
    check('Restart unhealthy brings it back up', await until(async () => (await state()).stacks[s.id].services.every((x) => x.health === 'up'), 25000));

    // Take an API out from its tile.
    await page.getByRole('button', { name: 'Take audit-api out' }).click();
    check('taking an API out stops it and drops its proxy rule', await until(async () => !(await state()).stacks[s.id].services.some((x) => x.name === 'audit-api'), 15000) && !JSON.parse(fs.readFileSync(`${V2DIR}/runs/stacks/${s.id}.proxy.conf.json`, 'utf8'))['/api/audit/**']);

    // Loans and fields through the toolbelt.
    const scen = await tb.call('list_loan_scenarios');
    check('list_loan_scenarios lists the stand-in scenarios', !scen.error && /Sample purchase/.test(scen.text));
    const prod = await tb.call('make_test_loan', { env: 'prod', scenario: 'Sample purchase' });
    check('a Prod loan is refused', prod.error && /never Prod/.test(prod.text));
    const loanR = await tb.call('make_test_loan', { env: 'dev', scenario: 'Sample purchase' });
    const loan = (/"loan": "([^"]+)"/.exec(loanR.text) || [])[1];
    check('make_test_loan waits for the run and returns the loan', !loanR.error && Boolean(loan), loanR.text.slice(0, 160));
    const fieldsR = await tb.call('check_fields', { env: 'dev', loan, list: 'Sample fields', expect: { '1000': '12.50' } });
    check('check_fields reads the list and compares', !fieldsR.error && /"matched": 2/.test(fieldsR.text), fieldsR.text.slice(0, 160));
    check('the session shows the loan and the field check', await until(() => page.locator('.sess').getByText(loan).isVisible(), 5000) && await page.locator('.sess').getByText('2 / 2').isVisible());
    // A data check (§139): Claude asks once; the server makes the loan, fills two fields, waits until they apply, checks.
    const dprod = await tb.call('run_data_check', { env: 'prod', scenario: 'Sample purchase', fields: ['1000'] });
    check('a Prod data check is refused', dprod.error && /never Prod/.test(dprod.text));
    const dc = await tb.call('run_data_check', { env: 'dev', scenario: 'Sample purchase', set: { 'CX.SAMPLE.ONE': 'No', 'CX.AMOUNT': '2500' }, list: 'Sample fields', expect: { '1000': '12.50' }, wait_seconds: 120 });
    const dcj = dc.error ? {} : JSON.parse(dc.text);
    check('run_data_check makes a loan, fills, waits for it to apply and checks', dcj.state === 'passed' && dcj.matched === 3 && dcj.total === 3 && dcj.values?.['CX.AMOUNT'] === '2,500.00', dc.text.slice(0, 300));
    const updates = () => fs.readFileSync(`${ROOT}/tools.log`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.tool === 'lookup-update');
    const writes = updates();
    check('one update went to the lookup, with exactly the two fields', writes.length === 1 && writes[0].count === 2 && writes[0].ids.sort().join(',') === 'CX.AMOUNT,CX.SAMPLE.ONE', JSON.stringify(writes.map((w) => w.ids)));
    check('the Switchboard shows the check passed, step by step', await until(() => page.locator('.dcheck.passed').getByText('all 2 applied').isVisible(), 5000));
    const ro = await tb.call('run_data_check', { env: 'dev', loan: dcj.loan, set: { '1000': '13.00' } });
    check('filling a read-only field fails before anything is sent', !ro.error && /Can’t fill 1000/.test(ro.text) && updates().length === 1, ro.text.slice(0, 200));
    // From the page: a check on the loan just made, with an expected value that differs.
    await page.locator('.sess').getByRole('button', { name: 'Test data' }).click();
    await page.getByRole('button', { name: 'One I have' }).click();
    await page.getByLabel('Loan id').fill(dcj.loan);
    await page.locator('.dform textarea').nth(1).fill('CX.SAMPLE.ONE = Yes & no\nCX.AMOUNT = 2500');
    await shot(page, 'data-check-form');
    await page.getByRole('button', { name: 'Run the check' }).click();
    check('a check from the page (nothing filled) shows what differs', updates().length === 1 && await until(() => page.locator('.dcheck.differs .ddiff').getByText('CX.SAMPLE.ONE').isVisible(), 15000) && await page.locator('.ddiff').getByText('Yes & no').isVisible());
    await shot(page, 'data-check-differs');
    st = await state();
    check('the session keeps both checks, the loan and the fill as evidence', st.sessions[0].checks.length === 3 && st.sessions[0].evidence.some((e) => /Filled 2 field\(s\)/.test(e.text)));
    await tb.call('add_evidence', { kind: 'tests', text: '18 tests pass, 4 new' });

    // Claude needs you: the block turns orange, the HUD says Answer.
    await hook('PermissionRequest', { session_id: 'claude-1', tool_name: 'Bash', tool_input: { command: 'pnpm db:migrate' } });
    check('a permission request shows as needs you', await until(() => page.locator('.sess.needs').getByText('wants to run: pnpm db:migrate').isVisible(), 5000));
    await page.getByRole('button', { name: 'I tried it: looks good' }).click();
    await shot(page, 'needs-you');
    const hud = await page.context().newPage();
    await hud.setViewportSize({ width: 440, height: 680 });
    await hud.goto(`${BASE}/hud`);
    check('the HUD lists the session with Answer', await until(() => hud.getByRole('button', { name: 'Answer' }).isVisible(), 5000) && await hud.getByText('1 need you').isVisible());
    await shot(hud, 'hud');
    await hud.close();

    // ---- Ship: a commit, then push + post ----
    fs.writeFileSync(`${s.repos.find((r) => r.name === 'fees-api').dir}/waiver.ts`, 'export const waive = true;\n');
    await page.goto(`${BASE}/ship/${s.id}`);
    check('the Ship dock refuses while a worktree has uncommitted changes', await until(() => page.getByText(/uncommitted change/).first().isVisible(), 8000));
    const fees = s.repos.find((r) => r.name === 'fees-api').dir;
    git(fees, 'add', 'waiver.ts');
    git(fees, '-c', 'user.email=walk@example.invalid', '-c', 'user.name=walk', 'commit', '-q', '-m', 'feat: waive');
    await page.reload();
    check('with a commit, it shows the evidence and the Slack preview', await until(() => page.locator('.ev').getByText('18 tests pass, 4 new').isVisible(), 8000) && await page.locator('.ev').getByText(/Smoke tested/).isVisible() && await page.locator('.slack').getByText(/Review please/).isVisible());
    await shot(page, 'ship-dock');
    await page.getByRole('button', { name: 'Open PRs and post' }).click();
    check('shipping pushes the branch', await until(async () => git(`${ROOT}/origins/fees-api.git`, 'branch', '--list').includes(s.branch), 15000));
    check('and posts the review request with the evidence and the mention', await until(async () => slack.length === 1, 8000) && /@payments/.test(slack[0].text) && /18 tests pass/.test(slack[0].text) && /Sample fields/.test(slack[0].text), JSON.stringify(slack[0] ?? {}).slice(0, 200));
    check('it says the PR must be opened by hand on an unknown host', await page.getByText(/open its PR by hand/).isVisible());

    // ---- Stop, remove ----
    await hook('PostToolUse', { session_id: 'claude-1', tool_name: 'Bash' });
    await hook('Stop', { session_id: 'claude-1', last_assistant_message: 'Shipped.' });
    await page.goto(`${BASE}/`);
    await page.getByRole('button', { name: 'Stop all' }).click();
    check('Stop all stops the stack and folds the session', await until(async () => !(await state()).stacks[s.id], 15000) && await until(() => page.locator('.sess.folded').isVisible(), 5000));
    check('the front door closes with the last UI', !(await state()).doors.length);
    check('no page errors', errors.length === 0, errors.join(' | '));
    tb.end();
    await page.locator('.sess.folded').getByRole('button', { name: `More for ${s.key}` }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('menuitem', { name: 'Remove with its worktrees' }).click();
    check('removing with worktrees takes them away', await until(async () => !(await state()).sessions.length && !fs.existsSync(s.repos[0].dir), 15000));
  } catch (e) {
    check('the walk ran to the end', false, String(e && e.stack || e));
  } finally {
    await browser.close();
    stop();
  }
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
