// pnpm run doctor: is this machine ready for cc-control? Checks what it needs (Node, Claude Code,
// git, the built page; Windows Terminal is optional, for g), reads the settings file, and tries each connection for
// real: Jira, and the pull-request host of every repo in your workspaces (gh for GitHub, the REST
// API for Azure DevOps / TFS), and each workspace stack's programs, repos and proxy file. Prints
// one line per check with what to do about it; exits 1 if anything needed is missing. Never prints a token.

import '../server/boot.ts';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARDS_IN_TERMINAL, CHANNEL_ON, findClaude } from '../server/cards.ts';
import { bundledClaude, sdkClaude } from '../server/claude-exe.ts';
import { config, CONFIG_FILE } from '../server/config.ts';
import { AzureDevOpsHost, GitHubHost, hostFor } from '../server/hosts.ts';
import { parsePortList, parseRange } from '../server/ports.ts';
import { recipeOf } from '../server/recipes.ts';
import { readLooseJson, stackOf } from '../server/stack.ts';
import { parseStep } from '../shared/recipes.ts';
import { needsUiPort, stackWarnings } from '../shared/stack.ts';
import { envNamesIn } from '../shared/stack-detect.ts';
import { DB_PATH, Store } from '../server/store.ts';
import { FIELD_LISTS_FILE, readFieldLists, readVerifyFile } from '../server/verify.ts';
import { VERIFY_ENVS, cleanUrl, isLoopback, setUrl, updatesOn } from '../shared/verify.ts';
import { findQaField, jiraConfig, jiraProblem } from '../server/tickets.ts';
import { repoName } from '../shared/workspaces.ts';

type Mark = 'ok' | 'warn' | 'bad' | 'info';
let failed = false;
const MARK: Record<Mark, string> = { ok: '✓', warn: '!', bad: '✗', info: '·' };
function line(mark: Mark, what: string, detail = '', fix = ''): void {
  if (mark === 'bad') failed = true;
  console.log(`  ${MARK[mark]} ${what}${detail ? `: ${detail}` : ''}`);
  if (fix) console.log(`      ${fix}`);
}
const section = (name: string) => console.log(`\n${name}`);

function version(cmd: string, args = ['--version']): string | undefined {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  return r.status === 0 ? (r.stdout || r.stderr).trim().split(/\r?\n/)[0] : undefined;
}

/** Where Windows finds a program. `where` also sees app aliases like wt.exe, which aren't files Node can stat. */
function onPath(exe: string): string | undefined {
  if (process.platform === 'win32') {
    const r = spawnSync('where.exe', [exe], { encoding: 'utf8', windowsHide: true });
    return r.status === 0 ? r.stdout.trim().split(/\r?\n/)[0] : undefined;
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const p = join(dir, exe);
    if (dir && existsSync(p)) return p;
  }
  return undefined;
}

console.log('cc-control doctor');

section('This machine');
const major = Number(process.versions.node.split('.')[0]);
line(major >= 24 ? 'ok' : 'bad', 'Node', process.versions.node, major >= 24 ? '' : 'cc-control needs Node 24 or later (it uses node:sqlite and runs TypeScript directly).');
const claude = findClaude();
const cv = version(claude);
line(cv ? 'ok' : 'bad', 'Claude Code', cv ? `${cv} (${claude})` : `not found (${claude})`, cv ? '' : 'Install Claude Code and sign in (claude), or set CC_CONTROL_CLAUDE to claude.exe.');
const sdkExe = sdkClaude();
const bundled = bundledClaude();
line(sdkExe || bundled ? 'ok' : 'bad', 'Claude for the app’s sessions', process.env.CC_CONTROL_CLAUDE ? `${sdkExe} (CC_CONTROL_CLAUDE)` : bundled ? `the SDK’s own (${bundled})` : sdkExe ? `the SDK’s own is missing, so the one on PATH (${sdkExe})` : 'the SDK’s own is missing and none is on PATH', sdkExe || bundled ? '' : 'Run pnpm install again without --no-optional / omit=optional, or install Claude Code, or set CC_CONTROL_CLAUDE to claude.exe.');
// §93: a card's session runs in the app (through the SDK), so the chat needs no terminal, no channel and no proxy of its own.
line('ok', 'Card sessions', CARDS_IN_TERMINAL ? 'in a Windows Terminal tab (CC_CONTROL_CARDS_IN_TERMINAL=1, the old way, for one release)' : 'run in the app: the card’s chat is the session (no tab, channel or typed keys in between)', CARDS_IN_TERMINAL ? 'Remove CC_CONTROL_CARDS_IN_TERMINAL from config.env to run them in the app.' : '');
if (CARDS_IN_TERMINAL) line(CHANNEL_ON ? 'ok' : 'info', 'Channel into card terminals', CHANNEL_ON ? 'on: messages and y / n from a card go into its terminal (a Claude Code research-preview flag)' : 'off (CC_CONTROL_CHANNEL=0): answer and type in the tab', CHANNEL_ON ? 'If a card’s tab fails to start and mentions channels, set CC_CONTROL_CHANNEL=0 in config.env.' : '');
const wt = process.platform === 'win32' ? onPath('wt.exe') : undefined;
line(wt ? 'ok' : CARDS_IN_TERMINAL ? 'bad' : 'info', 'Windows Terminal', wt ?? 'wt.exe not on PATH', wt ? (CARDS_IN_TERMINAL ? '' : 'Optional: g opens a card’s session in a tab of it.') : CARDS_IN_TERMINAL ? 'Cards open their session in a Windows Terminal tab: install Windows Terminal from the Microsoft Store.' : 'Optional: only g (open a card’s session in a terminal) needs it.');
const gv = version('git');
line(gv ? 'ok' : 'bad', 'git', gv ?? 'not found', gv ? '' : 'Install Git for Windows.');
const page = fileURLToPath(new URL('../dist/web/index.html', import.meta.url));
line(existsSync(page) ? 'ok' : 'warn', 'The page', existsSync(page) ? 'built' : 'not built yet', existsSync(page) ? '' : 'pnpm start builds it (or pnpm build).');

section('Settings');
if (config.file) line('ok', 'Settings file', `${config.file}${config.set.length ? ` (sets ${config.set.join(', ')})` : ''}${config.kept.length ? `; the environment already had ${config.kept.join(', ')}` : ''}`);
else line('info', 'Settings file', `none at ${CONFIG_FILE}`, `Optional, for Jira / Azure DevOps tokens: copy docs\\config.env.example to "${CONFIG_FILE}" and fill in the lines you need (one NAME=value per line, saved as UTF-8).`);
line(config.systemCerts ? 'ok' : 'info', 'Certificates', config.systemCerts ? `${config.systemCerts} from Windows${config.caFile ? ` and ${config.caFile}` : ''} trusted as well as Node's own` : 'only Node’s own', config.problem ?? '');
line('info', 'Database', DB_PATH);
// Verify (§107): where the team's tools are, and their names; a file on this machine, never the repo.
const vf = readVerifyFile();
const vc = vf.config;
if (vf.problem) line('bad', 'Verify file', vf.problem, 'Fix it, or delete it; the Verify panel shows the change at once.');
else if (!vc.set && !vc.lookup && !vc.builder && !rawBuilderUrl()) line('info', 'Verify file', `none at ${vf.file}`, 'Optional, for the Verify panel: README’s Verify row shows what goes in it.');
else {
  const envs = VERIFY_ENVS.filter((e) => setUrl(vc, e));
  line('ok', 'Verify file', `${vf.file}: ${[vc.set ? `${vc.set.name ?? 'the set tool'} (${envs.join(', ') || 'no addresses'})` : '', vc.lookup ? `${vc.lookup.name ?? 'the record lookup'}` : '', vc.builder ? `${vc.builder.name ?? 'the test-data tool'}` : ''].filter(Boolean).join(', ')}`);
  if (vc.lookup && !vc.lookup.recordField) line('warn', `${vc.lookup.name ?? 'Record lookup'}`, 'no "recordField"', 'Add the form’s name for the record id box (its <input name="…">) to the Verify file.');
  // §132: the lookup's own page, where o and Shift+L open.
  if (vc.lookup?.url) line(vc.lookup.page ? 'ok' : 'info', `${vc.lookup.name ?? 'Record lookup'}: its page`, vc.lookup.page ? 'set' : 'none: o opens the form’s post address', vc.lookup.page ? '' : 'Add "page" to the lookup in the Verify file: the address you open in the browser.');
  // §134: updates through the lookup: off unless the file says so, Dev and UAT only.
  if (vc.lookup?.url) {
    const ln = vc.lookup.name ?? 'Record lookup';
    if (vc.lookup.allowUpdate && !vc.lookup.updateUrl) line('warn', `${ln}: updates`, '"allowUpdate" is true but there is no "updateUrl" on the lookup’s own host, so updates stay off', 'Add the update form’s address (its action) as "updateUrl"; it must be on the same host as "url".');
    else if (updatesOn(vc)) {
      line('ok', `${ln}: updates`, 'on, for Dev and UAT only (never Prod), each sent after a second Shift+U');
      if (!vc.lookup.updateFields?.length) line('warn', `${ln}: updates`, 'no "updateFields"', 'The update form also carries the record’s own hidden fields (its number and folder): name them in "updateFields" (their <input name="…">), or an update says which field it doesn’t send and sends nothing.');
    } else line('info', `${ln}: updates`, 'off (read only)', vc.lookup.updateUrl ? 'Set "allowUpdate": true to change fields in Dev and UAT.' : '');
  }
  // §133: the scenario runner, on this machine only.
  const raw = rawBuilderUrl();
  if (vc.builder?.url) line('ok', `${vc.builder.name ?? 'Test data'}`, `${vc.builder.url}${vc.builder.ui ? `, its page ${vc.builder.ui}` : ''}`, vc.builder.ui ? '' : 'Add "ui" (its web page) to the builder in the Verify file for o.');
  else if (raw && !isLoopback(raw)) line('warn', 'Test data', `"builder.url" isn’t on this machine (${raw})`, 'The scenario runner is only ever reached on localhost, 127.0.0.1 or [::1]; Verify ignores any other host.');
  else if (vc.builder) line('warn', `${vc.builder.name ?? 'Test data'}`, 'no "url"', 'Add the API’s address on this machine (http://localhost:…) to the builder in the Verify file.');
}
{
  const fl = readFieldLists();
  if (fl.problem) line('bad', 'Field lists', fl.problem, 'Fix it, or delete it; the lookup’s Save as list writes it again.');
  else if (fl.lists.length) line('ok', 'Field lists', `${FIELD_LISTS_FILE}: ${fl.lists.length} list${fl.lists.length === 1 ? '' : 's'}`);
}

/** builder.url as the file has it, before cleaning drops one that isn't on this machine. */
function rawBuilderUrl(): string | undefined {
  try { return cleanUrl((JSON.parse(readFileSync(vf.file, 'utf8').replace(/^﻿/, '')) as { builder?: { url?: string } })?.builder?.url); } catch { return undefined; }
}

section('Tickets');
const jira = jiraConfig(process.env);
if (!jira) {
  line('info', 'Jira', process.env.CC_CONTROL_JIRA_SITE ? 'site set, but not the token (and, for Jira Cloud, the email)' : 'not set up', 'Set CC_CONTROL_JIRA_SITE and CC_CONTROL_JIRA_TOKEN (Data Center: a personal access token; Cloud: an API token and CC_CONTROL_JIRA_EMAIL).');
} else {
  const auth = jira.kind === 'server' && !jira.email ? `Bearer ${jira.token}` : `Basic ${Buffer.from(`${jira.email}:${jira.token}`).toString('base64')}`;
  try {
    const res = await fetch(`${jira.site}/rest/api/${jira.kind === 'cloud' ? 3 : 2}/myself`, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const me = await res.json() as { displayName?: string; name?: string };
      line('ok', `Jira ${jira.kind === 'cloud' ? 'Cloud' : 'Data Center'}`, `${jira.site}, signed in as ${me.displayName ?? me.name ?? 'you'}`);
      // The QA reviewer shown on Ready for QA tickets: the field named in the settings, or found by its name.
      if (jira.qaField?.toLowerCase() === 'off') line('info', '  QA reviewer', 'off (CC_CONTROL_JIRA_QA_FIELD=off)');
      else if (jira.qaField) line('info', '  QA reviewer', `from ${jira.qaField} (CC_CONTROL_JIRA_QA_FIELD)`);
      else {
        const found = await findQaField(jira).catch(() => undefined);
        line(found ? 'ok' : 'info', '  QA reviewer', found ? `found the field ${found}` : 'no field named like “QA Reviewer”, “QA Assignee” or “Tester”',
          found ? '' : 'If your QA reviewer field has another name, set CC_CONTROL_JIRA_QA_FIELD to its id (customfield_…).');
      }
    } else line('bad', `Jira ${jira.kind === 'cloud' ? 'Cloud' : 'Data Center'}`, `${jira.site} said ${res.status}`, jiraProblem(res.status, jira));
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message;
    line('bad', 'Jira', `couldn't reach ${jira.site} (${code})`, /CERT|ISSUER|SELF_SIGNED/.test(code) ? 'Its certificate isn’t trusted: export the company root CA as PEM and set CC_CONTROL_CA_FILE.' : 'Check the address, and that this machine is on the network (VPN?).');
  }
}

section('Workspaces: pull requests and run recipes');
let store: Store | undefined;
try { store = new Store(); } catch (e) { line('warn', 'Workspaces', `couldn't open ${DB_PATH}: ${(e as Error).message}`); }
const workspaces = store?.loadWorkspaces() ?? [];
if (!workspaces.length) line('info', 'Workspaces', 'none yet', 'Make one on the Ticket Line (W), then run pnpm run doctor again to check its repos.');
let ghChecked = false;
for (const w of workspaces) {
  console.log(`  ${w.name}`);
  for (const repo of w.repos) {
    const name = repoName(repo);
    if (!existsSync(repo)) { line('warn', `  ${name}`, `${repo} isn't there`); continue; }
    const remote = (spawnSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true }).stdout ?? '').trim();
    if (!remote) line('warn', `  ${name}`, 'no origin remote: Ship can’t push');
    else {
      const host = hostFor(remote);
      if (typeof host === 'string') line('warn', `  ${name}`, host);
      else if (host instanceof AzureDevOpsHost) {
        const blockers = await host.check();
        if (blockers.length) line('bad', `  ${name}`, 'Azure DevOps', blockers[0]);
        else {
          try { line('ok', `  ${name}`, `Azure DevOps, ${await host.ping()}`); } catch (e) { line('bad', `  ${name}`, 'Azure DevOps', (e as Error).message); }
        }
      } else if (host instanceof GitHubHost) {
        const blockers = await host.check(repo);
        if (blockers.length) line('bad', `  ${name}`, 'GitHub', blockers[0]);
        else {
          const auth = ghChecked ? 0 : spawnSync('gh', ['auth', 'status'], { windowsHide: true }).status;
          ghChecked = true;
          line(auth === 0 ? 'ok' : 'bad', `  ${name}`, 'GitHub (gh)', auth === 0 ? '' : 'Run gh auth login.');
        }
      }
    }
    const recipe = store && recipeOf(store, repo);
    line('info', `    run recipe`, recipe ? `${recipe.steps.join(' → ')} (${recipe.source})` : 'none detected: e on a card writes one');
  }
}

// A stack's steps run programs this machine needs: check each one, without running any step.
for (const w of workspaces) {
  const st = store && stackOf(store, w.id);
  if (!st) continue;
  section(`Stack: ${w.name}`);
  const lines = [...st.api.steps, ...(st.ui?.steps ?? [])].map((l) => parseStep(l.replace(/\{\{[^}]*\}\}/g, 'x'))).filter((x) => x && !x.note);
  const programs = new Set<string>();
  const commands = new Set<string>();
  let ps = false;
  for (const spec of lines) {
    if (spec!.ps) {
      ps = true;
      // PowerShell commands (Verb-Noun) come from modules or your profile, not PATH.
      for (const m of spec!.cmd.matchAll(/(?<![\\/.\w-])([A-Z][a-z]+-[A-Z][A-Za-z]+)\b(?!\.)/g)) if (!/^(Get|Set|Write|Out|Test|Select|Where|ForEach|New-Item|Remove-Item)-/.test(m[1])) commands.add(m[1]);
      for (const m of spec!.cmd.matchAll(/(?:^|[;{(|]\s*)([a-z][\w.-]*)(?=\s)/g)) if (!['if', 'else', 'foreach', 'try', 'catch'].includes(m[1])) programs.add(m[1]);
    } else {
      const first = /^[\w.\\/-]+/.exec(spec!.cmd)?.[0];
      if (first && !first.includes('\\') && !first.includes('/')) programs.add(first);
    }
  }
  if (ps) programs.add(process.platform === 'win32' ? 'powershell.exe' : 'pwsh');
  for (const prog of programs) {
    const where = onPath(prog) ?? onPath(`${prog}.exe`) ?? onPath(`${prog}.cmd`);
    line(where ? 'ok' : 'bad', prog, where ?? 'not found on PATH', where ? '' : `A stack step runs ${prog}: install it, or put it on PATH.`);
  }
  for (const c of commands) {
    // With the profile, as Try it runs them; Get-Command only looks, it runs nothing.
    const r = spawnSync('powershell.exe', ['-NoLogo', '-Command', `if (Get-Command ${c} -ErrorAction SilentlyContinue) { 'yes' }`], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    const ok = (r.stdout ?? '').includes('yes');
    line(ok ? 'ok' : 'bad', c, ok ? 'PowerShell has it' : 'PowerShell doesn’t know it', ok ? '' : 'It comes from a module or your PowerShell profile: open PowerShell and check it runs there.');
  }
  if (programs.has('okteto')) {
    // One command line, not args: Node 24 warns (DEP0190) when args go to a shell unescaped.
    const r = process.platform === 'win32'
      ? spawnSync('okteto context show', { encoding: 'utf8', windowsHide: true, timeout: 30_000, shell: true })
      : spawnSync('okteto', ['context', 'show'], { encoding: 'utf8', timeout: 30_000 });
    line(r.status === 0 ? 'ok' : 'warn', 'okteto context', r.status === 0 ? (r.stdout || r.stderr).trim().split(/\r?\n/).slice(0, 2).join(' ') : ((r.stderr || r.stdout || '').trim().split(/\r?\n/)[0] || 'couldn’t say'), r.status === 0 ? '' : 'Run okteto context use <your context> (and okteto login if it asks).');
  }
  const inWs = (name: string) => w.repos.find((r) => repoName(r).toLowerCase() === name.toLowerCase());
  for (const a of st.apis) {
    const at = inWs(a.repo);
    const appPort = a.values.appPort ?? a.values.port;
    line(at ? 'ok' : 'info', `API ${a.repo}`, at ? `in the workspace${appPort ? `, listens on ${appPort} in its container` : ''}` : 'not in the workspace', at ? '' : 'Fine if cards add it as context; otherwise add it to the workspace (+).');
  }
  // Local ports are picked per run from a range, one per API and UI: say which, and whether it has room right now.
  const [lo, hi] = parseRange(process.env.CC_CONTROL_PORTS);
  const need = st.apis.length + (needsUiPort(st) ? 1 : 0);
  line(hi - lo + 1 >= need * 2 ? 'ok' : 'warn', 'Local ports', `${lo}-${hi} (CC_CONTROL_PORTS); a run of everything takes ${need}`, hi - lo + 1 >= need * 2 ? '' : 'Widen the range so two cards can run at once.');
  // §122: the UI keeps its own port when it's free; a second card's takes one registered for sign-in, when listed.
  const signIn = parsePortList(process.env.CC_CONTROL_UI_PORTS);
  // §123: by default every card's UI runs behind a front door on its own port instead.
  if (needsUiPort(st) && process.env.CC_CONTROL_FRONT_DOOR !== '0') line('ok', 'UI sign-in', 'front door: each card’s UI runs on a port from the range above, behind cc-control on the UI’s own port; o on a card shows its UI there (CC_CONTROL_FRONT_DOOR=0 turns it off)');
  else if (needsUiPort(st)) line(signIn.length ? 'ok' : 'info', 'UI sign-in ports', signIn.length ? `its own port, then ${signIn.join(', ')} (CC_CONTROL_UI_PORTS)` : 'its own port for the first card; a second card’s UI runs on one from the range above', signIn.length ? '' : 'If the app signs in, a port from the range can’t: list ports registered for its sign-in in CC_CONTROL_UI_PORTS.');
  for (const w of stackWarnings(st)) line('warn', 'Two at once', w);
  // Personal values the steps read from config.env (%KUBECONFIG_DEV%): each must be set on this machine.
  for (const name of envNamesIn(st)) {
    // %KUBECONFIG_{{ENV}}% is one variable per value of env: KUBECONFIG_DEV, KUBECONFIG_UAT.
    const m = /\{\{\s*(\w+)\s*\}\}/.exec(name);
    const key = m ? Object.keys(st.choose).find((k) => k.toLowerCase() === m[1].toLowerCase()) : undefined;
    const names = m && key ? st.choose[key].map((v) => name.replace(m[0], m[1] === m[1].toUpperCase() ? v.toUpperCase() : v)) : [name];
    for (const v of names) {
      const set = Boolean(process.env[Object.keys(process.env).find((k) => k.toLowerCase() === v.toLowerCase()) ?? v]);
      line(set ? 'ok' : 'warn', `%${v}%`, set ? 'set' : 'not set on this machine', set ? '' : `A stack step reads it: add ${v}=… to ${CONFIG_FILE} (it is yours, not the workspace’s).`);
    }
  }
  if (st.ui) {
    const at = inWs(st.ui.repo);
    line(at ? 'ok' : 'info', `UI ${st.ui.repo}`, at ? 'in the workspace' : 'not in the workspace', at ? '' : 'Fine if cards add it as context.');
    if (at && st.ui.proxyFile) {
      const f = join(at, st.ui.proxyFile);
      let problem = existsSync(f) ? '' : 'isn’t there';
      if (!problem) { try { readLooseJson(readFileSync(f, 'utf8')); } catch (e) { problem = `isn’t JSON (${(e as Error).message})`; } }
      line(problem ? 'bad' : 'ok', `  ${st.ui.proxyFile}`, problem || `read; ${st.ui.proxyMode === 'edit' ? 'changed in place while it runs' : 'a copy is used, the file stays as it is'}`);
    }
  }
}
store?.close();

console.log(failed ? '\nSomething needed is missing (✗ above).' : '\nReady.');
process.exitCode = failed ? 1 : 0;
