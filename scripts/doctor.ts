// pnpm run doctor: is this machine ready for cc-control? Checks what it needs (Node, Claude Code,
// Windows Terminal, git, the built page), reads the settings file, and tries each connection for
// real: Jira, and the pull-request host of every repo in your workspaces (gh for GitHub, the REST
// API for Azure DevOps / TFS), and each workspace stack's programs, repos and proxy file. Prints
// one line per check with what to do about it; exits 1 if anything needed is missing. Never prints a token.

import '../server/boot.ts';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findClaude } from '../server/cards.ts';
import { config, CONFIG_FILE } from '../server/config.ts';
import { AzureDevOpsHost, GitHubHost, hostFor } from '../server/hosts.ts';
import { recipeOf } from '../server/recipes.ts';
import { readLooseJson, stackOf } from '../server/stack.ts';
import { parseStep } from '../shared/recipes.ts';
import { DB_PATH, Store } from '../server/store.ts';
import { jiraConfig, jiraProblem } from '../server/tickets.ts';
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
const wt = process.platform === 'win32' ? onPath('wt.exe') : undefined;
line(wt ? 'ok' : process.platform === 'win32' ? 'bad' : 'warn', 'Windows Terminal', wt ?? 'wt.exe not on PATH', wt ? '' : 'Cards open their session in a Windows Terminal tab: install Windows Terminal from the Microsoft Store.');
const gv = version('git');
line(gv ? 'ok' : 'bad', 'git', gv ?? 'not found', gv ? '' : 'Install Git for Windows.');
const page = fileURLToPath(new URL('../dist/web/index.html', import.meta.url));
line(existsSync(page) ? 'ok' : 'warn', 'The page', existsSync(page) ? 'built' : 'not built yet', existsSync(page) ? '' : 'pnpm start builds it (or pnpm build).');

section('Settings');
if (config.file) line('ok', 'Settings file', `${config.file}${config.set.length ? ` (sets ${config.set.join(', ')})` : ''}${config.kept.length ? `; the environment already had ${config.kept.join(', ')}` : ''}`);
else line('info', 'Settings file', `none at ${CONFIG_FILE}`, `Optional, for Jira / Azure DevOps tokens: copy docs\\config.env.example to "${CONFIG_FILE}" and fill in the lines you need (one NAME=value per line, saved as UTF-8).`);
line(config.systemCerts ? 'ok' : 'info', 'Certificates', config.systemCerts ? `${config.systemCerts} from Windows${config.caFile ? ` and ${config.caFile}` : ''} trusted as well as Node's own` : 'only Node’s own', config.problem ?? '');
line('info', 'Database', DB_PATH);

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
    const r = spawnSync('okteto', ['context', 'show'], { encoding: 'utf8', windowsHide: true, timeout: 30_000, shell: process.platform === 'win32' });
    line(r.status === 0 ? 'ok' : 'warn', 'okteto context', r.status === 0 ? (r.stdout || r.stderr).trim().split(/\r?\n/).slice(0, 2).join(' ') : ((r.stderr || r.stdout || '').trim().split(/\r?\n/)[0] || 'couldn’t say'), r.status === 0 ? '' : 'Run okteto context use <your context> (and okteto login if it asks).');
  }
  const inWs = (name: string) => w.repos.find((r) => repoName(r).toLowerCase() === name.toLowerCase());
  for (const a of st.apis) {
    const at = inWs(a.repo);
    line(at ? 'ok' : 'info', `API ${a.repo}`, at ? `in the workspace${a.values.port ? `, port ${a.values.port}` : ''}` : 'not in the workspace', at ? '' : 'Fine if cards add it as context; otherwise add it to the workspace (+).');
  }
  const ports = st.apis.map((a) => a.values.port).filter(Boolean);
  const twice = [...new Set(ports.filter((p, i) => ports.indexOf(p) !== i))];
  if (twice.length) line('warn', 'Ports', `more than one API uses ${twice.join(', ')}`, 'Only one of them can run at a time: give each its own local port.');
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
