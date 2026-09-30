// pnpm run doctor: is this machine ready for cc-control? Checks what it needs (Node, Claude Code,
// Windows Terminal, git, the built page), reads the settings file, and tries each connection for
// real: Jira, and the pull-request host of every repo in your workspaces (gh for GitHub, the REST
// API for Azure DevOps / TFS). Prints one line per check with what to do about it; exits 1 if
// anything needed is missing. Never prints a token.

import '../server/boot.ts';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findClaude } from '../server/cards.ts';
import { config, CONFIG_FILE } from '../server/config.ts';
import { AzureDevOpsHost, GitHubHost, hostFor } from '../server/hosts.ts';
import { recipeOf } from '../server/recipes.ts';
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
else line('info', 'Settings file', `none at ${CONFIG_FILE}`, 'Optional: put CC_CONTROL_* settings and tokens there, one NAME=value per line (see the README).');
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
    const remote = spawnSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
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
store?.close();

console.log(failed ? '\nSomething needed is missing (✗ above).' : '\nReady.');
process.exitCode = failed ? 1 : 0;
