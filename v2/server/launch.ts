// Spinning up new work the proper way: a worktree in every repo the session touches (node_modules
// as hard links of the main checkout's, never installed per session, never a junction), then the
// session's local files in its home worktree, kept out of git:
//   CLAUDE.local.md              the context pack Claude reads
//   .mcp.json                    the toolbelt (v2/mcp/toolbelt.ts), with this session's id and token
//   .claude/settings.local.json  the hooks that tell Command Center what Claude is doing
// Because those live in the folder, any Claude Code client opened there gets the same context, tools
// and hooks: a terminal tab (opened here), VS Code, or Claude Desktop pointed at the folder.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wtArg } from '../../shared/cards.ts';
import { SECRET } from '../../server/config.ts';
import { focusTab, makeWorktrees } from '../../server/cards.ts';
import { findClaude } from '../../server/claude-exe.ts';
import { depsState, linkInBackground } from '../../server/deps.ts';
import { trustFolders } from '../../server/trust.ts';
import { repoName, samePath } from '../../shared/workspaces.ts';
import type { Opener, Session, SessionRepo } from '../shared/types.ts';
import { V2_EVENTS } from './hook-state.ts';

export const HOOK_SCRIPT = fileURLToPath(new URL('../hooks/hook.mjs', import.meta.url));
export const TOOLBELT = fileURLToPath(new URL('../mcp/toolbelt.ts', import.meta.url));
export const MCP_NAME = 'command-center';
const fwd = (p: string) => p.replace(/\\/g, '/');

/** Worktrees for the session's repos on its branch; a repo that isn't a git repo is worked on in place. */
export async function makeSessionWorktrees(repos: string[], key: string, branch: string): Promise<SessionRepo[]> {
  const { folders } = await makeWorktrees(repos, repos[0], key, branch);
  return repos.map((repo) => ({ repo, name: repoName(repo), dir: folders.find((f) => samePath(f.repo, repo))?.dir ?? repo }));
}

/** Hard-link each worktree's packages from its main checkout, in the background (Try it waits for a link still going). */
export function linkDeps(repos: SessionRepo[], said: (line: string) => void = () => {}): void {
  for (const r of repos) {
    if (samePath(r.dir, r.repo) || depsState(r.dir).state !== 'clone') continue;
    linkInBackground(r.dir, (code, last) => said(`${r.name}: node_modules ${code === 0 ? 'linked' : `not linked (${last})`}`));
  }
}

/** Keep a generated file out of `git status` through the repo's .git/info/exclude (shared by its worktrees). */
export function excludeFromGit(dir: string, names: string[]): void {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  if (r.status !== 0) return;
  const common = r.stdout.trim();
  const file = join(isAbsolute(common) ? common : join(dir, common), 'info', 'exclude');
  try {
    mkdirSync(join(file, '..'), { recursive: true });
    const have = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const lines = have.split(/\r?\n/);
    const add = names.filter((n) => !lines.includes(n));
    if (add.length) appendFileSync(file, `${have && !have.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`);
  } catch { /* the files still work; they may show in git status */ }
}

export interface LocalFiles {
  dir: string;
  pack: string;
  sessionId: string;
  token: string;
  url: string;
}

/**
 * Write the session's local files into its home worktree. A .mcp.json the repo already has is left
 * alone (returned as `mcpConfig`: the terminal passes ours with --mcp-config instead). Settings the
 * folder already has are kept; only Command Center's hooks in it are replaced.
 */
export function writeLocalFiles(f: LocalFiles, outside: string): { mcpConfig?: string } {
  writeFileSync(join(f.dir, 'CLAUDE.local.md'), f.pack);
  const server = { command: 'node', args: [fwd(TOOLBELT)], env: { CCV2_URL: f.url, CCV2_SESSION: f.sessionId, CCV2_TOKEN: f.token } };
  const mcpFile = join(f.dir, '.mcp.json');
  let mcpConfig: string | undefined;
  const theirs = existsSync(mcpFile) && !readFileSync(mcpFile, 'utf8').includes(fwd(TOOLBELT));
  if (theirs) {
    mcpConfig = join(outside, `${f.sessionId}.mcp.json`);
    writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { [MCP_NAME]: server } }, null, 2));
  } else {
    writeFileSync(mcpFile, JSON.stringify({ mcpServers: { [MCP_NAME]: server } }, null, 2));
  }
  mkdirSync(join(f.dir, '.claude'), { recursive: true });
  const settingsFile = join(f.dir, '.claude', 'settings.local.json');
  let settings: Record<string, unknown> = {};
  try { if (existsSync(settingsFile)) settings = JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, unknown>; } catch { settings = {}; }
  writeFileSync(settingsFile, JSON.stringify(withHooks(settings, f), null, 2));
  excludeFromGit(f.dir, ['CLAUDE.local.md', '.mcp.json', '.claude/settings.local.json']);
  return mcpConfig ? { mcpConfig } : {};
}

/** The folder's settings with Command Center's hooks (any older ones of ours replaced) and its MCP server allowed. */
export function withHooks(settings: Record<string, unknown>, f: Pick<LocalFiles, 'sessionId' | 'token' | 'url'>): Record<string, unknown> {
  const hooks = { ...((settings.hooks as Record<string, unknown[]>) ?? {}) };
  const ours = (entry: unknown) => JSON.stringify(entry).includes('v2/hooks/hook.mjs');
  for (const event of V2_EVENTS) {
    const kept = (Array.isArray(hooks[event]) ? hooks[event] : []).filter((e) => !ours(e));
    // A bare `node`: it runs in Git Bash and in the PowerShell Claude Code falls back to.
    const command = `node "${fwd(HOOK_SCRIPT)}" ${event} ${f.sessionId} ${f.token} ${f.url}`;
    hooks[event] = [...kept, { hooks: [{ type: 'command', command, timeout: 10, async: true }] }];
  }
  const allowed = Array.isArray(settings.enabledMcpjsonServers) ? (settings.enabledMcpjsonServers as string[]) : [];
  return { ...settings, hooks, enabledMcpjsonServers: [...new Set([...allowed, MCP_NAME])] };
}

/** Mark the session's folders trusted, so Claude Code doesn't stop at the trust prompt in a new worktree. */
export function trust(dirs: string[]): void {
  try { trustFolders(dirs); } catch (e) { console.error(`v2: couldn't mark the worktrees trusted: ${(e as Error).message}`); }
}

/** Markers of a Claude Code session this server may run under: a tab that inherits them runs as its child. */
const SESSION_MARKERS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(CHILD_SESSION|SESSION_ID|SESSION_ATTENDED|ENTRYPOINT|EXECPATH|SSE_PORT|MESSAGING_\w+|BRIDGE_\w+))$/;

export function cleanEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) if (!SESSION_MARKERS.test(k) && !SECRET.test(k) && !/^CC_CONTROL_SLACK_/.test(k)) env[k] = v;
  return env;
}

/** The claude arguments for a session's tab: its other worktrees, our MCP config when the repo has its own, then a resume or the first message. */
export function claudeArgs(s: Pick<Session, 'key' | 'title' | 'repos' | 'home' | 'firstMessage' | 'claude'>, mcpConfig?: string, fresh = false): { args: string[]; message: string } {
  const args = ['-n', `${s.key} ${s.title}`.slice(0, 80)];
  for (const r of s.repos) if (!samePath(r.dir, s.home)) args.push('--add-dir', r.dir);
  if (mcpConfig) args.push('--mcp-config', mcpConfig);
  if (!fresh && s.claude.claudeId) return { args: [...args, '--resume', s.claude.claudeId], message: '' };
  return { args, message: s.firstMessage };
}

/** Open the session in a Windows Terminal tab titled with its key (the HUD finds it by that title). */
export function openTerminal(s: Pick<Session, 'key' | 'title' | 'repos' | 'home' | 'firstMessage' | 'claude'>, mcpConfig?: string): Promise<void> {
  const { args, message } = claudeArgs(s, mcpConfig);
  // --add-dir takes every argument after it: `--` before the message.
  const cmd = ['-w', '0', 'nt', '--title', s.key, '--suppressApplicationTitle', '-d', s.home, findClaude(), ...args, ...(message ? ['--', wtArg(message)] : [])];
  return new Promise((resolve, reject) => {
    const child = spawn('wt.exe', cmd, { env: cleanEnv(process.env), stdio: 'ignore', windowsHide: true, detached: true });
    child.on('error', (e) => reject(new Error(`Couldn't open Windows Terminal (wt.exe): ${e.message}`)));
    child.on('spawn', () => { child.unref(); resolve(); });
  });
}

/** Open the home worktree in VS Code (its Claude Code extension reads the same local files). */
export function openVsCode(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('code', [dir], { env: cleanEnv(process.env), stdio: 'ignore', windowsHide: true, detached: true, shell: true });
    child.on('error', (e) => reject(new Error(`Couldn't run VS Code's code command: ${e.message}`)));
    child.on('exit', (code) => (code ? reject(new Error('VS Code’s code command isn’t on PATH: in VS Code, run "Shell Command: Install \'code\' command in PATH".')) : resolve()));
  });
}

/** Bring the session's terminal tab forward; when it isn't open, open one that resumes it. */
export async function focusOrOpen(s: Session, opener: Opener, mcpConfig?: string): Promise<'focused' | 'opened' | 'vscode' | 'desktop'> {
  if (opener === 'vscode') { await openVsCode(s.home); return 'vscode'; }
  if (opener === 'desktop') return 'desktop';
  try { await focusTab(s.key); return 'focused'; } catch { /* no tab: open one */ }
  await openTerminal(s, mcpConfig);
  return 'opened';
}
