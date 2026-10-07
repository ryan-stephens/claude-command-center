// The Ticket Line's server half: a card saves its context, makes its branch and starts its Claude
// session. From §93 the app runs it (through the SDK, in SessionManager): the packet goes in its
// system prompt and in-process hooks keep the card current, the same events applyEvent has always
// read. With CC_CONTROL_CARDS_IN_TERMINAL=1 (legacy, one release) it starts `claude` in a Windows
// Terminal tab instead, whose SessionStart hook (hooks/cc-control-hook.mjs, loaded with `claude
// --settings`, so nothing is added to the user's own settings) calls back here with the card id
// and token, gets the packet as additionalContext, and reports the session id.

import type { HookCallbackMatcher, HookEvent } from '@anthropic-ai/claude-agent-sdk';
import { execFile, spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRANCH_NAME, branchFor, CARD_KINDS, CARD_MODELS, cardRepos, defaultMessage, folderFor, PACKET_KINDS, homeOf, includedRepos, isClean, LAUNCH_MODES, laterText, modelFor, ownFolders, packetText, tokens, fmtK, waiting, worktreeFor, wtArg,
  type BranchChoice, type BootStep, type Card, type CardDraft, type CardFolder, type CardKind, type CardWorktree, type LaterItem, type LaunchMode, type Packet, type PacketItem, type PrTarget,
} from '../shared/cards.ts';
import { MODES, type PermissionMode, type Workspace } from '../shared/protocol.ts';
import { SOURCE_NAME, type Ticket } from '../shared/tickets.ts';
import { repoName, samePath } from '../shared/workspaces.ts';
import { applyEvent, TRACKED_EVENTS, type HookInput } from './card-events.ts';
import { SECRET } from './config.ts';
import { normalizeFolder } from './fs-browse.ts';
import { DB_PATH, type Store } from './store.ts';
import { trustFolders } from './trust.ts';
import { depsState, linkInBackground, unlinkDeps } from './deps.ts';
import { findClaude } from './claude-exe.ts';

export { findClaude };

const HOOK_SCRIPT = fileURLToPath(new URL('../hooks/cc-control-hook.mjs', import.meta.url));
/** How long a new tab has to report in before the card says something may be wrong. */
const HOOK_WAIT_MS = 45_000;
/** A session whose hooks spoke this recently is taken to be alive in its tab (§85): its session isn't resumed in a second one. */
const ALIVE_MS = 2 * 60_000;
const CHANNEL_SCRIPT = fileURLToPath(new URL('../hooks/cc-control-channel.mjs', import.meta.url));
const LAUNCH_SCRIPT = fileURLToPath(new URL('../hooks/cc-control-launch.ps1', import.meta.url));
const FOCUS_SCRIPT = fileURLToPath(new URL('../hooks/cc-control-focus-tab.ps1', import.meta.url));

/**
 * Bring a card's terminal tab to the front: the Windows Terminal tab titled with its key (the
 * focus script walks the terminal's windows with UI Automation). Rejects when no such tab is open.
 */
export function focusTab(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', FOCUS_SCRIPT, '-Title', key], { timeout: 15_000, windowsHide: true }, (err, stdout) => {
      if (err) return reject(new Error(`Couldn't look for the tab: ${err.message}`));
      if (stdout.trim() === 'ok') return resolve();
      reject(new Error(`No terminal tab titled ${key} is open: it closed, or the card started before tabs kept their titles.`));
    });
  });
}

/** Is a terminal tab titled with the card's key open? Only looks (§87); false when the look itself fails. */
export function tabExists(key: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', FOCUS_SCRIPT, '-Title', key, '-Find'], { timeout: 15_000, windowsHide: true }, (err, stdout) => {
      resolve(!err && stdout.trim() === 'ok');
    });
  });
}

/** Legacy (§93): cards start in a Windows Terminal tab, as before, instead of in the app. For one release, so a machine can fall back. */
export const CARDS_IN_TERMINAL = process.env.CC_CONTROL_CARDS_IN_TERMINAL === '1';

/**
 * The hook events the app's own card sessions report in-process (§93). PermissionRequest comes from
 * the permission broker instead, which has the request id y / n answer; SessionEnd isn't one: the
 * server decides when the session's CLI stops, and a stopped one still resumes on the next message.
 */
export const APP_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop'] as const satisfies readonly HookEvent[];

/** The in-process hooks of a card's session: each event goes to `on` with its input, and `on`'s output (context added since, on UserPromptSubmit) goes back to Claude. */
export function appHooks(on: (event: string, input: HookInput) => object | null): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
  for (const event of APP_EVENTS) {
    hooks[event] = [{ hooks: [async (input) => {
      try { return on(event, input as HookInput) ?? {}; } catch (e) {
        // A card gone (deleted while its session ran) must never stop Claude.
        console.error(`cc-control: ${event} for a card failed: ${(e as Error).message}`);
        return {};
      }
    }] }];
  }
  return hooks;
}

/** Cards start with a channel into their terminal (a research-preview flag); CC_CONTROL_CHANNEL=0 turns it off. */
export const CHANNEL_ON = process.env.CC_CONTROL_CHANNEL !== '0';

/**
 * The arguments that give a card's `claude` its channel: an MCP server (the channel script) with
 * the channel capabilities. The config is a file next to the hook settings: inline JSON doesn't
 * survive Windows Terminal's re-quoting of the command line.
 */
export function channelArgs(on = CHANNEL_ON): string[] {
  if (!on) return [];
  const file = join(dirname(DB_PATH), 'claude-channel.json');
  writeFileSync(file, JSON.stringify({ mcpServers: { 'cc-control': { command: 'node', args: [CHANNEL_SCRIPT.replace(/\\/g, '/')] } } }, null, 2));
  // --channels server:… loads the channel but drops what it sends in (only approved channels get
  // through); the development flag delivers, and its confirmation prompt is pressed by the launcher.
  return ['--mcp-config', file, '--dangerously-load-development-channels', 'server:cc-control'];
}

/**
 * What Windows Terminal runs in the tab. With a channel, the launcher (hooks/cc-control-launch.ps1)
 * starts claude and presses Enter at the development-channels prompt; it gets the whole command as
 * one base64 argument, so nothing is re-quoted on the way. Without one, claude itself, the message
 * quoted for wt's second round of parsing.
 */
export function tabCommand(claude: string, args: string[], message: string, channel = CHANNEL_ON): string[] {
  // No message (a session resumed, §85): nothing after the arguments.
  if (!channel) return [claude, ...args, ...(message ? ['--', wtArg(message)] : [])];
  const payload = Buffer.from(JSON.stringify([claude, ...args, ...(message ? ['--', message] : [])]), 'utf8').toString('base64');
  return ['powershell.exe', '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', LAUNCH_SCRIPT, payload];
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** A packet from the page: known kinds, real folders for repos, bounded text. */
function cleanItems(raw: unknown): PacketItem[] {
  const out: PacketItem[] = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, 60) : []) {
    const i = (r ?? {}) as Partial<PacketItem>;
    if (i.kind === 'repo') {
      const path = normalizeFolder(i.id);
      if (!path || !isDir(path)) throw new Error(`Not a folder: ${str(i.id, 200)}`);
      out.push({ kind: 'repo', id: path, label: repoName(path), on: i.on !== false });
    } else if (i.kind && PACKET_KINDS.includes(i.kind)) {
      const label = str(i.label, 500).trim();
      const text = str(i.text, 20_000);
      if (label) out.push({ kind: i.kind, id: str(i.id, 200) || label, label, ...(text ? { text } : {}), on: i.on !== false });
    }
  }
  return out;
}

/** The PR a QA or review card looks at, from the page: a real number, git-safe branch names, a web address, one of the card's repos. */
function cleanPr(raw: unknown, packet: Packet): PrTarget | undefined {
  const p = (raw ?? {}) as Partial<PrTarget>;
  if (!raw || typeof raw !== 'object') return undefined;
  const repo = includedRepos(packet).find((r) => samePath(r, str(p.repo, 400)));
  if (!Number.isInteger(p.number) || p.number! <= 0 || !repo) return undefined;
  if (!BRANCH_NAME.test(str(p.source, 200)) || !BRANCH_NAME.test(str(p.target, 200))) throw new Error('The pull request’s branch names don’t look like git branches.');
  if (!/^https?:\/\/\S+$/.test(str(p.url, 1000))) throw new Error('The pull request has no web address.');
  return { number: p.number!, title: str(p.title, 300), url: str(p.url, 1000), host: p.host === 'azure' ? 'azure' : 'github', source: p.source!, target: p.target!, repo };
}

export function cleanDraft(raw: unknown, workspaces: Workspace[]): CardDraft {
  const d = (raw ?? {}) as Partial<CardDraft>;
  const title = str(d.title, 160).trim();
  if (!title) throw new Error('Give the card a title.');
  const workspaceId = typeof d.workspaceId === 'string' && workspaces.some((w) => w.id === d.workspaceId) ? d.workspaceId : null;
  const p = (d.packet ?? {}) as Partial<Packet>;
  const packet: Packet = { workspace: cleanItems(p.workspace), ticket: cleanItems(p.ticket), card: cleanItems(p.card), note: str(p.note, 8000) };
  const l = (d.launch ?? {}) as Partial<CardDraft['launch']>;
  const home = homeOf(packet, { home: normalizeFolder(l.home) ?? '' });
  if (!home) throw new Error('A card needs at least one repo.');
  const mode: LaunchMode = LAUNCH_MODES.some((m) => m.id === l.mode) ? l.mode! : 'plan';
  const kind: CardKind = CARD_KINDS.find((k) => k.id === d.kind)?.id ?? 'build';
  const pr = kind === 'build' ? undefined : cleanPr(d.pr, packet);
  // Anything that isn't a choice the page offers gets the kind's default: a worktree for development, the current branch for QA and review.
  const branch: BranchChoice = l.branch === 'current' || l.branch === 'worktree' || l.branch === 'new' ? l.branch : l.branch === 'pr' && pr ? 'pr' : kind === 'build' ? 'worktree' : 'current';
  const model = CARD_MODELS.find((m) => m.id === l.model)?.id;
  const ticketKey = str(d.ticketKey, 60).trim();
  return {
    title, workspaceId, packet, ...(ticketKey ? { ticketKey } : {}), ...(kind !== 'build' ? { kind } : {}), ...(pr ? { pr } : {}),
    // The message keeps its lines (§69): the launcher hands it to claude as one base64-carried argument. (Without a channel, wtArg flattens it for wt's re-quoting.)
    launch: { home, mode, branch, ...(model ? { model } : {}), message: str(l.message, 6000).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() },
  };
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 20_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n')[0]));
      else resolve(stdout.trim());
    });
  });
}

/**
 * A worktree card's folders: a worktree of every repo, each on `branch`, next to the repo. The
 * branch is new (made with the first worktree of each repo) unless `onExisting`: a repo added to a
 * running card joins the card's branch, which that repo may already have (a branch of that name
 * made by hand) or not. A folder that isn't the top of a git repo (any folder can be context) is
 * left as it is and named in `skipped`, except the home repo, which must be one. A worktree already
 * there on `branch` (the "What happens" lines run by hand make exactly that) is used as it is, and a
 * branch already there is checked out rather than made. If any worktree can't be made, the ones
 * made here are removed with the branches made here, so nothing is left half done.
 */
export async function makeWorktrees(repos: string[], home: string, key: string, branch: string, onExisting = false): Promise<{ folders: CardFolder[]; skipped: string[] }> {
  // Every repo at once (§98): they are separate git repos, so nothing is shared but the wait.
  const one = async (repo: string): Promise<{ repo: string; dir?: string; made?: boolean; adopted?: boolean }> => {
    const top = await git(repo, ['rev-parse', '--show-toplevel']).catch(() => '');
    if (!top || !samePath(top, repo)) {
      if (samePath(repo, home)) throw new Error(`${repoName(repo)} isn’t a git repo, so it can’t have a worktree.`);
      return { repo };
    }
    const dir = worktreeFor(repo, key);
    if (existsSync(dir)) {
      const there = await worktreeAt(repo, dir);
      if (there?.branch === branch) return { repo, dir, adopted: true };
      throw new Error(there
        ? `${dir} is already a worktree of ${repoName(repo)}, on ${there.branch ?? 'no branch'} rather than ${branch}. Remove it (first rmdir "${join(dir, 'node_modules')}" if it is a link, or git empties the main checkout's node_modules; then git -C ${repo} worktree remove ${dir}) or switch it to ${branch}, then start again.`
        : `${dir} already exists and isn’t a worktree of ${repoName(repo)}, so the worktree can’t go there. Move or delete it, then start again.`);
    }
    // onExisting: a repo added later joins the card's branch. Otherwise a branch of this name is the card's own, made by hand.
    const has = Boolean(await git(repo, ['branch', '--list', branch]).catch(() => ''));
    if (has && !onExisting) {
      const busy = await git(repo, ['worktree', 'list', '--porcelain']).catch(() => '');
      if (busy.split(/\r?\n/).includes(`branch refs/heads/${branch}`)) throw new Error(`${branch} is already checked out in another folder of ${repoName(repo)}, so its worktree can’t have it too.`);
    }
    await git(repo, ['worktree', 'add', dir, ...(has ? [branch] : ['-b', branch])]).catch((e: Error) => { throw new Error(`Couldn't make a worktree for ${repoName(repo)}: ${e.message}`); });
    return { repo, dir, made: !has };
  };
  const results = await Promise.allSettled(repos.map(one));
  const done = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) {
    // One failed: undo the others, and say the first failure in the repos' order.
    for (const f of done) {
      if (!f.dir || f.adopted) continue;
      unlinkDeps(f.dir);
      await git(f.repo, ['worktree', 'remove', '--force', f.dir]).catch(() => {});
      if (f.made) await git(f.repo, ['branch', '-D', branch]).catch(() => {});
    }
    throw failed.reason;
  }
  return { folders: done.flatMap((f) => (f.dir ? [{ repo: f.repo, dir: f.dir }] : [])), skipped: done.filter((f) => !f.dir).map((f) => f.repo) };
}

/** The worktree of `repo` at `dir`, with its branch (none when detached); undefined when `dir` isn't one of them. */
export async function worktreeAt(repo: string, dir: string): Promise<{ branch?: string; head?: string } | undefined> {
  const list = await git(repo, ['worktree', 'list', '--porcelain']).catch(() => '');
  for (const block of list.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const path = lines.find((l) => l.startsWith('worktree '))?.slice(9);
    if (!path || !samePath(path, dir)) continue;
    const ref = lines.find((l) => l.startsWith('branch '))?.slice(7);
    const head = lines.find((l) => l.startsWith('HEAD '))?.slice(5);
    return { ...(ref ? { branch: ref.replace(/^refs\/heads\//, '') } : {}), ...(head ? { head } : {}) };
  }
  return undefined;
}

/** Delete a folder, trying again for a few seconds while Windows still has it open. */
async function removeFolder(dir: string, tries = 12): Promise<void> {
  for (let i = 1; ; i++) {
    try { rmSync(dir, { recursive: true, force: true }); return; } catch (e) {
      if (i >= tries) throw new Error(`couldn’t delete ${dir}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** A card's worktrees as they are now: what would be lost by removing each. */
export async function worktreeStates(card: Pick<Card, 'folders'>): Promise<CardWorktree[]> {
  return Promise.all(ownFolders(card).map(async (f) => {
    if (!isDir(f.dir)) return { ...f, changed: false, unpushed: 0, missing: true };
    const branch = await git(f.dir, ['branch', '--show-current']).catch(() => '');
    const status = await git(f.dir, ['status', '--porcelain']).catch(() => '');
    // Commits only this branch has (no remote branch, no other local branch): what deleting it loses.
    const n = await git(f.dir, ['rev-list', '--count', 'HEAD', '--not', '--remotes', ...(branch ? [`--exclude=${branch}`] : []), '--branches']).catch(() => '0');
    return { ...f, ...(branch ? { branch } : {}), changed: status.length > 0, unpushed: Number(n) || 0, missing: false };
  }));
}

/**
 * Remove a card's worktrees and, for a worktree card, their branch. Only the clean ones go unless
 * `force`; the rest are returned as `kept`, with their state, for a second look. A folder already
 * gone is pruned from its repo. The branch goes only once its worktree is gone.
 */
export async function removeWorktrees(card: Pick<Card, 'folders' | 'branchName' | 'launch'>, force: boolean): Promise<{ removed: CardWorktree[]; kept: CardWorktree[]; problems: string[] }> {
  const removed: CardWorktree[] = [];
  const kept: CardWorktree[] = [];
  const problems: string[] = [];
  for (const w of await worktreeStates(card)) {
    if (!force && !isClean(w)) { kept.push(w); continue; }
    try {
      if (w.missing) await git(w.repo, ['worktree', 'prune']);
      else {
        // §110: git would follow a node_modules junction and empty the main checkout's packages.
        unlinkDeps(w.dir);
        await git(w.repo, ['worktree', 'remove', '--force', w.dir]).catch(async (e: Error) => {
          // Windows: a process that just stopped (the card's session, its shell) can hold the folder a
          // moment longer. git has unregistered it by then and left the folder; it goes here.
          if (!/failed to delete|Permission denied/i.test(e.message)) throw e;
          await removeFolder(w.dir);
          await git(w.repo, ['worktree', 'prune']);
        });
      }
      // A review's copy is detached: no branch of the card's to delete. A worktree card's branch is its own.
      if (card.launch.branch === 'worktree' && card.branchName) await git(w.repo, ['branch', '-D', card.branchName]).catch(() => {});
      removed.push(w);
    } catch (e) {
      problems.push(`${repoName(w.dir)}: ${(e as Error).message}`);
      kept.push(w);
    }
  }
  return { removed, kept, problems };
}

/**
 * The hook, as a settings file for `claude --settings`. Only card sessions load it. Written when a
 * card starts and when the server starts, so a card resumed by hand gets the current hooks.
 */
export function writeHookSettings(): string {
  const file = join(dirname(DB_PATH), 'claude-hooks.json');
  // A bare `node`, not a quoted path to node.exe: that runs in Git Bash and in the PowerShell
  // Claude Code falls back to without it (where a quoted path first is a parse error).
  const hook = (event: string, async = false) => [{
    hooks: [{ type: 'command', command: `node "${HOOK_SCRIPT.replace(/\\/g, '/')}" ${event}`, timeout: 15, ...(async ? { async: true } : {}) }],
  }];
  // SessionStart answers with the packet and UserPromptSubmit with anything added since, so Claude
  // waits for those two. The rest only report, so they run async and never slow Claude down.
  const hooks: Record<string, unknown> = { SessionStart: hook('SessionStart') };
  for (const e of TRACKED_EVENTS) hooks[e] = hook(e, e !== 'UserPromptSubmit');
  writeFileSync(file, JSON.stringify({ hooks }, null, 2));
  return file;
}

/**
 * Variables a running Claude Code session sets for what it starts. A server started from inside a
 * session (a restart run by Claude, say) inherits them, and a tab that inherits them in turn runs
 * as that session's child and never writes its own transcript. Settings people choose themselves
 * (CLAUDE_CODE_USE_BEDROCK and the like) are left alone.
 */
const SESSION_MARKERS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(CHILD_SESSION|SESSION_ID|SESSION_ATTENDED|ENTRYPOINT|EXECPATH|SSE_PORT|MESSAGING_\w+|BRIDGE_\w+))$/;

/**
 * The environment of the new tab: the card and how to reach this server, minus the markers of any
 * session this server runs under, and minus the settings file's tokens (Claude's shell would see them).
 */
export function tabEnv(base: NodeJS.ProcessEnv, cardId: string, token: string, port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) if (!SESSION_MARKERS.test(k) && !SECRET.test(k)) env[k] = v;
  return { ...env, CC_CONTROL_CARD: cardId, CC_CONTROL_TOKEN: token, CC_CONTROL_URL: `http://127.0.0.1:${port}` };
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

interface CardOpts {
  port: number;
  /** CC_CONTROL_MODEL: every card without its own choice starts with this. */
  model?: string;
  /** The model in the user's Claude Code settings, read when a card starts. */
  userModel?: () => string | undefined;
  /** The setting: mark a card's new worktrees trusted in ~/.claude.json before its tab opens. */
  trustWorktrees?: () => boolean;
  /** The card's repos its workspace's stack can start (Try it), for the hook's text about a repo added later. */
  runnable?: (card: Card) => string[];
  /**
   * Start the card's session in the app (§93): SessionManager with the card's fixed session id, its
   * other folders and its first message. The card is saved first, so its hooks find it.
   */
  startSession?: (card: Card, dirs: string[]) => Promise<void>;
  /** Start cards in a terminal tab (legacy, CC_CONTROL_CARDS_IN_TERMINAL=1). */
  inTerminal?: boolean;
  /** Each hook event a card's app session reports, after it is applied (the server's timing lines). */
  onEvent?: (card: Card, event: string) => void;
  /** A card changed (it, when one did: the page gets just that card), or several, or one was deleted (all of them). */
  changed: (card?: Card) => void;
}

/**
 * The live line of a session the app runs (§93): applyEvent's words were written for a tab ("Plan
 * ready: approve it in the tab"); the card is where it is answered now.
 */
function inApp(card: Card): Card {
  if (!card.live || !/ in the tab$/.test(card.live.text)) return card;
  return { ...card, live: { ...card.live, text: card.live.text.replace(/:? (approve it )?in the tab$/, (_m, a: string | undefined) => (a ? ': approve it with y' : '')) } };
}

/** Plan and the like, as the card's session last reported it, else what it started with. */
function modeOf(card: Card): PermissionMode {
  const m = card.live?.mode;
  return MODES.includes(m as PermissionMode) ? m as PermissionMode : card.launch.mode;
}

/** The "model" in ~/.claude/settings.json: what a plain `claude` would start with. */
export function userModel(file = join(homedir(), '.claude', 'settings.json')): string | undefined {
  try {
    const m = (JSON.parse(readFileSync(file, 'utf8')) as { model?: unknown }).model;
    return typeof m === 'string' && m.trim() ? m.trim() : undefined;
  } catch {
    return undefined;
  }
}

export class CardService {
  private waits = new Map<string, NodeJS.Timeout>();
  private store: Store;
  private opts: CardOpts;

  constructor(store: Store, opts: CardOpts) {
    this.store = store;
    this.opts = opts;
  }

  list(): Card[] {
    return this.store.loadCards();
  }

  /** The key the next card will get, for the new-card screen's preview. */
  peekKey(): string {
    return `CARD-${this.store.getMeta('cards.next') ?? '1'}`;
  }

  get(id: string): Card | undefined {
    return this.store.loadCard(id);
  }

  /** Change a card and tell the page (Ship's steps and PR). Returns the card as saved. */
  update(id: string, change: (c: Card) => Card): Card | undefined {
    const card = this.get(id);
    if (!card) return undefined;
    const next = change(card);
    this.save(next);
    return next;
  }

  /** A card made outside start (a seeded one, §80): saved as it is and announced. */
  put(card: Card): void {
    this.save(card);
  }

  private save(card: Card): void {
    this.store.saveCard(card);
    this.opts.changed(card);
  }

  private step(card: Card, text: string, state: BootStep['state'] = 'ok'): void {
    card.boot.push({ at: Date.now(), text, state });
  }

  /** A line on a saved card's boot list (a background job finishing after the card started). */
  private bootLine(id: string, text: string, state: BootStep['state']): void {
    const card = this.get(id);
    if (card) this.save({ ...card, boot: [...card.boot, { at: Date.now(), text, state }] });
  }

  /**
   * §110, §111: a new worktree has no node_modules. Each one with a package.json naming packages
   * gets the main checkout's, as a folder of hard links, in the background (nothing downloaded: a
   * big repo can't take an install per card), so Claude's tests and Try it find them; Try it waits
   * for a clone still going. Removing the worktree in any way leaves the main checkout's install
   * whole. Says so on the card, then how it ended (a lockfile that differs, or no packages to take).
   */
  private linkPackages(card: Card, dirs: string[]): void {
    for (const dir of dirs) {
      const s = depsState(dir);
      if (s.state === 'none' || s.state === 'busy') continue;
      if (s.state === 'missing') { this.step(card, `${repoName(dir)}: no node_modules in the main checkout${s.main ? ` (${s.main})` : ''} to take: install the packages there once, then Try it`, 'bad'); continue; }
      this.step(card, `${repoName(dir)}: putting the main checkout’s packages in, in the background (hard links, nothing downloaded); Try it waits for it`, 'go');
      linkInBackground(dir, (code, last) => this.bootLine(card.id, `${repoName(dir)}: ${last || (code === 0 ? 'the packages are in' : 'couldn’t put the packages in')}`, code !== 0 || /differs/.test(last) ? 'bad' : 'ok'));
    }
  }

  /** Branch, then the session (in the app, or a terminal tab). Fails before saving anything if either can't be done, so the new-card screen can be fixed and retried. */
  async start(draft: CardDraft, ticket?: Ticket): Promise<Card> {
    const home = homeOf(draft.packet, draft.launch)!;
    if (ticket && this.list().some((c) => c.key === ticket.key)) throw new Error(`${ticket.key} already has a card on the line.`);
    // A ticket's card is called after the ticket; the rest are numbered.
    const key = ticket?.key ?? this.store.nextCardKey();
    const card: Card = {
      ...draft, ...(ticket ? { title: ticket.title, ticket } : {}),
      id: crypto.randomUUID(), key, stage: draft.launch.mode === 'plan' ? 'plan' : 'build', createdAt: Date.now(), boot: [],
    };
    if (!card.launch.message) card.launch.message = defaultMessage(key, card.launch.mode, card.kind);
    // The PR's branch is in the PR's repo, so the card starts there.
    const start = card.launch.branch === 'pr' && card.pr ? card.pr.repo : home;
    const size = tokens(packetText(card, key, branchFor(key, card.title)));
    this.step(card, `Saved the context packet (${fmtK(size)})`);

    const branch = branchFor(key, card.title);
    card.cwd = start;
    if (card.launch.branch === 'pr' && card.pr) {
      const { source, target, number } = card.pr;
      const dir = worktreeFor(start, key);
      const there = existsSync(dir) ? await worktreeAt(start, dir) : undefined;
      if (existsSync(dir) && !there) throw new Error(`${dir} already exists and isn’t a worktree of ${repoName(start)}, so the copy on PR #${number}'s branch can't go there. Move or delete it, then start again.`);
      await git(start, ['fetch', 'origin', source, target]).catch((e: Error) => { throw new Error(`Couldn't fetch ${source} from origin in ${repoName(start)}: ${e.message}`); });
      // A copy already there (the "What happens" lines run by hand) is used as it is.
      if (!there) await git(start, ['worktree', 'add', '--detach', dir, `origin/${source}`]).catch((e: Error) => { throw new Error(`Couldn't make a copy of ${repoName(start)} on ${source}: ${e.message}`); });
      card.cwd = dir;
      card.branchName = source;
      this.step(card, there ? `Fetched PR #${number}’s branch; used the copy ${repoName(dir)} already there` : `Fetched PR #${number}’s branch and made a copy ${repoName(dir)} on ${source}`);
    } else if (card.launch.branch === 'current') {
      card.branchName = await git(home, ['branch', '--show-current']).catch(() => undefined) || undefined;
      this.step(card, card.branchName ? `Stayed on ${card.branchName} in ${repoName(home)}` : `Stayed where ${repoName(home)} is`);
    } else if (card.launch.branch === 'new') {
      await git(home, ['switch', '-c', branch]).catch((e: Error) => { throw new Error(`Couldn't make branch ${branch} in ${repoName(home)}: ${e.message}`); });
      card.branchName = branch;
      this.step(card, `Made branch ${branch} in ${repoName(home)}`);
    } else {
      // Every repo gets its own worktree on the card's branch, so the card's code is what Try it runs, whatever the repos' usual folders are on.
      const repos = includedRepos(card.packet);
      const { folders, skipped } = await makeWorktrees([home, ...repos.filter((r) => !samePath(r, home))], home, key, branch);
      card.folders = folders;
      card.cwd = folderFor(card, home);
      card.branchName = branch;
      this.step(card, folders.length === 1 ? `Made a worktree ${repoName(card.cwd)} on ${branch}` : `Made worktrees on ${branch}: ${folders.map((f) => repoName(f.dir)).join(', ')}`);
      if (skipped.length) this.step(card, `Left ${skipped.map(repoName).join(', ')} as ${skipped.length === 1 ? 'it is' : 'they are'}: not a git repo`);
      this.linkPackages(card, folders.map((f) => f.dir));
    }
    if (card.launch.branch === 'pr' && card.pr) card.folders = [{ repo: start, dir: card.cwd }];
    this.trust(card, ownFolders(card).map((f) => f.dir));

    card.model = modelFor(card.launch, this.opts.model, this.opts.userModel?.());
    // A token even for a card the app runs: g can still hand its session to a terminal tab, whose hooks prove themselves with it.
    const token = crypto.randomUUID();
    const others = this.otherFolders(card, start);
    if (!this.opts.inTerminal && this.opts.startSession) {
      const now = Date.now();
      card.sessionId = crypto.randomUUID();
      card.runner = 'app';
      card.live = { phase: 'working', text: 'Starting Claude', at: now, mode: card.launch.mode, turnSince: now };
      this.step(card, `Started Claude in the app in ${card.cwd}${others.length ? ` with ${others.length} more repo${others.length === 1 ? '' : 's'}` : ''}`);
      this.step(card, `Gave Claude the packet with its system prompt (${fmtK(size)}); it stays through /clear and compacting`);
      this.step(card, `Linked session ${card.sessionId.slice(0, 8)} to this card`);
      this.step(card, card.launch.mode === 'plan' ? 'Claude started on a plan' : 'Claude started work');
      // Saved before the session starts: its first hook (UserPromptSubmit) looks the card up.
      this.store.saveCard(card, token);
      try {
        await this.opts.startSession(card, others);
      } catch (e) {
        this.store.deleteCard(card.id);
        throw e;
      }
      this.opts.changed(card);
      return card;
    }
    const claudeArgs = [...this.claudeArgs(card), ...others.flatMap((r) => ['--add-dir', r])];
    await this.openTab(card, token, claudeArgs, card.launch.message);
    this.step(card, `Opened a Windows Terminal tab in ${card.cwd}${others.length ? ` with ${others.length} more repo${others.length === 1 ? '' : 's'}` : ''}`);
    this.step(card, 'Waiting for the session to start', 'go');
    this.store.saveCard(card, token);
    this.opts.changed(card);
    this.waits.set(card.id, setTimeout(() => this.noWord(card.id), HOOK_WAIT_MS));
    return card;
  }

  /** The arguments every tab of the card gives `claude`: the hooks, the channel, its mode and model. */
  private claudeArgs(card: Card): string[] {
    return ['--settings', writeHookSettings(), ...channelArgs(),
      '--permission-mode', card.launch.mode, ...((card.launch.model ?? this.opts.model) ? ['--model', card.launch.model ?? this.opts.model!] : [])];
  }

  /** The card's other repos, each by the folder it works in (its worktree, if it has one). */
  private otherFolders(card: Card, start: string): string[] {
    return includedRepos(card.packet).filter((r) => !samePath(r, start)).map((r) => folderFor(card, r));
  }

  /** Open a Windows Terminal tab titled with the card's key, running `claude` with the card's variables. */
  private async openTab(card: Card, token: string, claudeArgs: string[], message: string): Promise<void> {
    // The title stays the card's key (Claude Code would otherwise retitle the tab), so g can find the tab again.
    const args = ['-w', '0', 'nt', '--title', card.key, '--suppressApplicationTitle', '-d', card.cwd!, ...tabCommand(findClaude(), claudeArgs, message)];
    await new Promise<void>((resolve, reject) => {
      const child = spawn('wt.exe', args, { env: tabEnv(process.env, card.id, token, this.opts.port), stdio: 'ignore', windowsHide: true, detached: true });
      child.on('error', (e) => reject(new Error(`Couldn't open Windows Terminal (wt.exe): ${e.message}`)));
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Windows Terminal exited with code ${code}.`))));
      child.unref();
    });
  }

  /**
   * The way a card is always reachable (§85): its session is opened again in a new tab with
   * `claude --resume`, with the same hooks, channel and token, so the card follows it as before
   * and the message box works again. Refused while its tab looks alive (the hooks spoke within the
   * last two minutes and the session hasn't ended): two tabs on one session would both write its
   * transcript; g brings that tab forward instead.
   */
  async reopen(id: string, fromApp = false): Promise<Card> {
    const card = this.get(id);
    if (!card) throw new Error('That card is gone.');
    if (!card.sessionId) throw new Error(`${card.key} hasn’t started a session yet.`);
    if (!card.cwd || !isDir(card.cwd)) throw new Error(`${card.cwd ?? 'Its folder'} isn’t there any more, so its session can’t be resumed.`);
    const token = this.store.cardToken(id);
    if (!token) throw new Error(`${card.key} has no token, so a new tab couldn’t prove itself. Start a new card.`);
    // From the app (g on a card the app runs, §93): the app has just let go of the session, so its hooks speaking a moment ago were the app's.
    const spokeAt = card.live?.phase !== 'ended' && !fromApp ? card.live?.at ?? 0 : 0;
    if (Date.now() - spokeAt < ALIVE_MS) throw new Error(`${card.key}’s tab looks open (its session spoke ${Math.round((Date.now() - spokeAt) / 1000)} s ago) but can’t be reached: g brings the tab forward.`);
    // The tab itself, by its title: an idle one is still a tab, and a second claude on its session would write the same transcript.
    if (await tabExists(card.key)) throw new Error(`${card.key}’s tab is open but can’t be reached from here (it started before this, or its launcher is gone): g brings it forward.`);
    const home = card.cwd;
    const others = this.otherFolders(card, cardRepos(card)[0] ?? home).filter((r) => !samePath(r, home));
    const claudeArgs = ['--resume', card.sessionId, ...this.claudeArgs(card), ...others.flatMap((r) => ['--add-dir', r])];
    await this.openTab(card, token, claudeArgs, '');
    card.boot = card.boot.filter((b) => b.state !== 'go');
    this.step(card, `Opened a new tab in ${card.cwd}, resuming session ${card.sessionId.slice(0, 8)}`);
    this.step(card, 'Waiting for the session to resume', 'go');
    if (card.live) card.live = { ...card.live, phase: 'working', text: 'Resuming in a new tab', at: Date.now(), ask: undefined };
    // The tab owns the session now; its HTTP hooks keep the card current (and a send goes in through the tab's way in, or moves it back once the tab is gone).
    card.runner = 'terminal';
    this.save(card);
    clearTimeout(this.waits.get(id));
    this.waits.set(id, setTimeout(() => this.noResume(id), HOOK_WAIT_MS));
    return card;
  }

  private noResume(id: string): void {
    this.waits.delete(id);
    const card = this.get(id);
    if (!card) return;
    const i = card.boot.findIndex((b) => b.state === 'go');
    if (i < 0) return;
    card.boot[i] = { at: Date.now(), text: 'No word from the resumed session yet: look at the tab (g).', state: 'bad' };
    this.save(card);
  }

  /** The server just started: no channel is connected and no launcher has polled yet, whatever the cards say (each says so again as it reconnects). */
  resetChannels(): void {
    for (const card of this.list()) if (card.channel || card.keys) this.store.saveCard({ ...card, channel: false, keys: false });
  }

  /** The card's tab can be typed into through its launcher (§87), or no longer. */
  keysState(id: string, on: boolean): void {
    const card = this.get(id);
    if (!card || Boolean(card.keys) === on) return;
    this.save({ ...card, keys: on });
  }

  /** The page answered a prompt by keys typed into the tab: the hooks say what Claude does next. */
  typedAnswer(id: string): void {
    const card = this.get(id);
    if (!card?.live) return;
    this.save({ ...card, live: { ...card.live, text: 'Answered from here' } });
  }

  /** A card made outside start (a seeded one, §80) with a token, so a launcher or hook can prove itself to it on a test server. */
  putWithToken(card: Card, token: string): void {
    this.store.saveCard(card, token);
    this.opts.changed(card);
  }

  /** With the setting on, new worktrees are marked trusted so the tab doesn't stop at Claude Code's prompt. A problem is a boot line, never a failed start. */
  private trust(card: Card, dirs: string[]): void {
    if (!dirs.length || !this.opts.trustWorktrees?.()) return;
    try {
      const marked = trustFolders(dirs);
      if (marked.length) this.step(card, `Marked ${marked.length === 1 ? repoName(marked[0]) : `${marked.length} folders`} trusted in ~/.claude.json (your setting)`);
    } catch (e) {
      this.step(card, `Couldn’t mark the folder trusted in ~/.claude.json (${(e as Error).message}): answer the trust prompt in the tab`, 'bad');
    }
  }

  /** The card's channel connected (its terminal can be typed into from here) or went away. */
  channelState(id: string, on: boolean): void {
    const card = this.get(id);
    if (!card || Boolean(card.channel) === on) return;
    this.save({ ...card, channel: on });
  }

  /**
   * The terminal relayed a permission prompt through the channel: kept on the card until it is
   * answered or the tool runs, beside whatever the hooks say (they arrive in their own time).
   */
  channelAsk(id: string, tool: string, requestId: string, description?: string): void {
    const card = this.get(id);
    if (!card) return;
    this.save({ ...card, relayed: { requestId, tool, ...(description ? { description } : {}), at: Date.now() } });
  }

  /** The page answered the prompt: the hooks say what Claude does next. */
  channelAnswered(id: string, requestId: string): void {
    const card = this.get(id);
    if (!card?.relayed || card.relayed.requestId !== requestId) return;
    const { relayed: _r, ...rest } = card;
    this.save({ ...rest, ...(rest.live ? { live: { ...rest.live, text: 'Answered from here' } } : {}) });
  }

  private noWord(id: string): void {
    this.waits.delete(id);
    const card = this.get(id);
    if (!card || card.sessionId) return;
    const i = card.boot.findIndex((b) => b.state === 'go');
    if (i >= 0) card.boot[i] = { at: Date.now(), text: 'No word from the session yet. If the tab asks whether to trust the folder, answer it there.', state: 'bad' };
    this.save(card);
  }

  /** The card a hook names, if its token matches, and the session the hook came from. */
  private checked(id: string, token: string, input: HookInput): { card: Card; sessionId: string } {
    const card = this.get(id);
    const expected = card && this.store.cardToken(id);
    if (!card || !expected || !sameToken(token, expected)) throw new Error('Unknown card or wrong token.');
    const sessionId = str(input.session_id, 80);
    if (!/^[\w-]{8,80}$/.test(sessionId)) throw new Error('No session id.');
    return { card, sessionId };
  }

  /**
   * The SessionStart hook: check the card's token, link the session, and return what the hook
   * prints (the packet as additionalContext). A resumed session already has the packet, so it
   * only gets linked; a cleared or compacted one lost it, so it gets it again.
   *
   * Once linked, only /clear in the card's tab moves the card to a new session. Anything else
   * starting with the card's variables (a `claude -p` that Claude runs inside the tab inherits
   * them, or /resume to another session) is not this card's session and gets nothing.
   */
  sessionStart(id: string, token: string, input: HookInput): object | null {
    const { card, sessionId } = this.checked(id, token, input);
    const source = str(input.source, 20) || 'startup';
    if (card.sessionId && card.sessionId !== sessionId && source !== 'clear') return null;
    clearTimeout(this.waits.get(id));
    this.waits.delete(id);
    const giving = source !== 'resume';
    // Anything added since goes with the packet: waiting items, and on /clear or compaction the
    // ones already sent, which the session has just lost.
    const later = card.later ?? [];
    let text = packetText(card, card.key, card.branchName);
    if (giving && later.length) {
      text += `

${laterText(card.key, later, card, this.opts.runnable?.(card))}`;
      const now = Date.now();
      card.later = later.map((i) => (i.sent ? i : { ...i, sent: now }));
    }
    card.boot = card.boot.filter((b) => b.state !== 'go' && !(b.state === 'bad' && !card.sessionId));
    const again = card.sessionId ? (source === 'clear' ? ' after /clear' : source === 'compact' ? ' after compacting' : source === 'resume' ? ' (resumed)' : ' again') : '';
    if (giving) this.step(card, `SessionStart hook fetched the packet${again} (${fmtK(tokens(text))})`);
    if (card.sessionId !== sessionId) this.step(card, `Linked session ${sessionId.slice(0, 8)} to this card`);
    if (!card.sessionId) this.step(card, card.launch.mode === 'plan' ? 'Claude started on a plan' : 'Claude started work');
    card.sessionId = sessionId;
    card.live = { ...card.live, phase: 'working', text: 'Session started', at: Date.now(), mode: card.launch.mode };
    this.save(card);
    return giving ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } } : null;
  }

  /**
   * Any other hook event: follow the session on the card. Events from other sessions are ignored.
   * A message typed in the tab (UserPromptSubmit) also takes whatever waits on the card, and the
   * hook prints it as additionalContext, so it reaches Claude with that message.
   */
  hookEvent(id: string, token: string, event: string, input: HookInput): object | null {
    const { card, sessionId } = this.checked(id, token, input);
    if (card.sessionId !== sessionId) return null;
    return this.applyHook(card, event, input);
  }

  /**
   * An event from the in-process hooks of a session the app runs for the card (§93): no token (the
   * hooks were made for this card), and the session is the card's whatever its id (a /clear moves
   * the card with it, see followSession).
   */
  appEvent(id: string, event: string, input: HookInput): object | null {
    const card = this.get(id);
    if (!card) return null;
    const out = this.applyHook(card, event, input);
    const after = this.get(id);
    if (after) this.opts.onEvent?.(after, event);
    return out;
  }

  /** What a card's session starts with in the app (§93): its mode, model, the packet in its system prompt, the hooks. */
  sessionOptions(card: Card): { mode: PermissionMode; options: Record<string, unknown> } {
    const model = card.model ?? card.launch.model ?? this.opts.model;
    return {
      mode: modeOf(card),
      options: {
        ...(model ? { model } : {}),
        // The packet, recorded with the session and re-rendered after /clear and compacting: what SessionStart's additionalContext did for a tab.
        systemPrompt: { type: 'preset', preset: 'claude_code', append: packetText(card, card.key, card.branchName) },
        hooks: appHooks((event, input) => this.appEvent(card.id, event, input)),
      },
    };
  }

  /** The card whose app session this is (§93). */
  bySession(sessionId: string): Card | undefined {
    return this.list().find((c) => c.runner === 'app' && c.sessionId === sessionId);
  }

  /**
   * The permission broker holds a request from a card's app session (§93): the card asks, with the
   * request's id, which y / n and the question form answer. The same PermissionRequest event a tab's
   * hook sends, so the card reads it the same way.
   */
  appAsk(sessionId: string, requestId: string, tool: string, toolInput: Record<string, unknown>): void {
    const card = this.bySession(sessionId);
    if (!card) return;
    const next = inApp(applyEvent(card, 'PermissionRequest', { session_id: sessionId, tool_name: tool, tool_input: toolInput }, Date.now()));
    if (next.live?.ask) next.live = { ...next.live, ask: { ...next.live.ask, requestId } };
    this.save(next);
  }

  /**
   * y / n answered the card's ask from here (§93): the card says so at once. An approved plan moves
   * it to Build: the broker settles before the tool runs, so the hooks' PostToolUse no longer finds
   * the ask that would have told applyEvent the plan was approved.
   */
  answered(id: string, behavior: 'allow' | 'deny'): void {
    const card = this.get(id);
    const ask = card?.live?.ask;
    if (!card?.live || !ask?.requestId) return;
    const plan = ask.kind === 'plan';
    const locked = card.stage === 'ship' || card.stage === 'done' || card.stage === 'inbox';
    const what = (ask.detail ?? ask.tool).replace(/^running: /, '');
    const text = plan ? (behavior === 'allow' ? 'Plan approved: building' : 'Not yet: Claude keeps planning') : `${behavior === 'allow' ? 'Allowed' : 'Denied'} ${ask.tool}: ${what}`;
    const stage = locked ? card.stage : plan ? (behavior === 'allow' ? 'build' : 'plan') : card.stage === 'needs' ? (card.live.mode === 'plan' ? 'plan' : 'build') : card.stage;
    this.save({ ...card, stage, live: { ...card.live, phase: 'working', text, ask: undefined, ...(plan && behavior === 'allow' ? { mode: 'default' } : {}) } });
  }

  /** The broker's request is over (answered, interrupted, or the session stopped): its ask leaves the card. */
  askResolved(sessionId: string, requestId: string): void {
    const card = this.bySession(sessionId);
    if (!card?.live?.ask || card.live.ask.requestId !== requestId) return;
    this.save({ ...card, live: { ...card.live, phase: 'working', text: 'Answered from here', ask: undefined } });
  }

  /**
   * The app's session went idle (§93). A turn that ends normally has said so through its Stop hook
   * already; one stopped mid-way (Esc) never fires Stop, so the card would read "working" forever.
   */
  sessionIdle(sessionId: string): void {
    const card = this.bySession(sessionId);
    if (!card?.live || card.live.phase !== 'working') return;
    this.save({ ...card, live: { ...card.live, phase: 'waiting', text: 'Stopped', turnSince: undefined, at: Date.now() } });
  }

  /**
   * The session moved to a new id: /clear starts a fresh conversation that way (§93; the manager
   * follows it). The card follows too, and what was added since goes again with the next message:
   * the fresh conversation has only the packet.
   */
  followSession(oldId: string, newId: string): void {
    const card = this.bySession(oldId);
    if (!card) return;
    const later = (card.later ?? []).map(({ sent: _s, ...i }) => i);
    this.save({ ...card, sessionId: newId, later, boot: [...card.boot, { at: Date.now(), text: `Fresh start (/clear): linked session ${newId.slice(0, 8)}; the packet came with it${later.length ? ', and what was added since goes with your next message' : ''}`, state: 'ok' }] });
  }

  /**
   * The server just started (§93): no card session is running, whatever the cards say. One that was
   * working or asking waits instead, and says the next message resumes it.
   */
  afterRestart(): void {
    for (const card of this.list()) {
      if (card.runner !== 'app' || (card.live?.phase !== 'working' && card.live?.phase !== 'needs')) continue;
      const text = 'The server restarted; the next message resumes the session';
      this.store.saveCard({ ...card, live: { ...card.live, phase: 'waiting', text, ask: undefined, turnSince: undefined, at: Date.now() }, boot: [...card.boot, { at: Date.now(), text, state: 'ok' }] });
    }
  }

  /**
   * A terminal card (legacy) whose tab can't be reached: its session moves to the app (§93), so the
   * message resumes it here. Refused while its tab looks alive: two writers on one transcript.
   */
  async toApp(id: string): Promise<Card> {
    const card = this.get(id);
    if (!card?.sessionId) throw new Error(`${card?.key ?? 'That card'} hasn’t started a session yet.`);
    if (card.runner === 'app') return card;
    if (!card.cwd || !isDir(card.cwd)) throw new Error(`${card.cwd ?? 'Its folder'} isn’t there any more, so its session can’t be resumed.`);
    const spokeAt = card.live?.phase !== 'ended' ? card.live?.at ?? 0 : 0;
    if (Date.now() - spokeAt < ALIVE_MS) throw new Error(`${card.key}’s tab looks open (its session spoke ${Math.round((Date.now() - spokeAt) / 1000)} s ago) but can’t be reached: g brings the tab forward.`);
    if (await tabExists(card.key)) throw new Error(`${card.key}’s tab is open but can’t be reached from here: g brings it forward, or close it and send again.`);
    const next: Card = { ...card, runner: 'app', channel: false, keys: false, relayed: undefined, boot: [...card.boot.filter((b) => b.state !== 'go'), { at: Date.now(), text: `Its tab is gone: the session moved into the app (${card.sessionId.slice(0, 8)})`, state: 'ok' }] };
    this.save(next);
    return next;
  }

  /** Apply a hook event to the card and save it; on UserPromptSubmit, return what was added since as additionalContext. */
  private applyHook(card: Card, event: string, input: HookInput): object | null {
    let next = applyEvent(card, event, input, Date.now());
    // The broker's request stays on the card until it is answered (askResolved): a parallel tool's PreToolUse doesn't take away what y / n answer.
    const held = card.live?.ask?.requestId ? card.live : undefined;
    if (held && next.live && !next.live.ask) next = { ...next, stage: card.stage, live: { ...next.live, phase: 'needs', text: held.text, ask: held.ask } };
    if (card.runner === 'app') next = inApp(next);
    // A relayed prompt is over once its tool ran (or was refused), the turn ended, or you typed in the tab.
    if (next.relayed && ((event === 'PostToolUse' && str(input.tool_name, 80) === next.relayed.tool) || event === 'Stop' || event === 'UserPromptSubmit' || event === 'SessionEnd')) {
      const { relayed: _r, ...rest } = next;
      next = rest;
    }
    const sending = event === 'UserPromptSubmit' ? waiting(next) : [];
    if (sending.length) {
      const now = Date.now();
      next = { ...next, later: next.later!.map((i) => (i.sent ? i : { ...i, sent: now })) };
    }
    if (next !== card) this.save(next);
    return sending.length ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: laterText(card.key, sending, card, this.opts.runnable?.(card)) } } : null;
  }

  /**
   * Add context to a card that has started: repos, related tickets and your note wait on it until
   * the session takes them (see hookEvent). What it already has is skipped; nothing new is an error.
   * On a worktree card a new git repo gets a worktree on the card's branch first (and is used from
   * there); if that can't be made, nothing is added.
   */
  async addContext(id: string, rawItems: unknown, note: unknown): Promise<LaterItem[]> {
    const card = this.get(id);
    if (!card) throw new Error('That card is no longer on the line.');
    if (card.stage === 'done') throw new Error(`${card.key} is done.`);
    const repos = cardRepos(card);
    const had = new Set([...card.packet.card, ...(card.later ?? [])].map((i) => i.id));
    if (card.ticket) had.add(`ticket:${card.ticket.key}`);
    const now = Date.now();
    const add: LaterItem[] = [];
    for (const i of cleanItems(rawItems)) {
      if (!i.on || i.kind === 'note' || had.has(i.id) || (i.kind === 'repo' && repos.some((r) => samePath(r, i.id)))) continue;
      had.add(i.id);
      add.push({ ...i, at: now });
    }
    const text = str(note, 8000).trim();
    if (text) add.push({ kind: 'note', id: `note:${now}`, label: `Your note: ${text.length > 60 ? `${text.slice(0, 59)}…` : text}`, text, on: true, at: now });
    if (!add.length) throw new Error(`Nothing new to add: ${card.key} already has all of that.`);
    const next: Card = { ...card, later: [...(card.later ?? []), ...add] };
    const newRepos = add.filter((i) => i.kind === 'repo').map((i) => i.id);
    if (card.launch.branch === 'worktree' && card.branchName && newRepos.length) {
      const { folders } = await makeWorktrees(newRepos, '', card.key, card.branchName, true);
      if (folders.length) {
        next.folders = [...(card.folders ?? []), ...folders];
        next.boot = [...card.boot, { at: now, text: `Made ${folders.length === 1 ? `a worktree ${repoName(folders[0].dir)}` : `worktrees ${folders.map((f) => repoName(f.dir)).join(', ')}`} on ${card.branchName}${card.runner === 'app' ? '' : ' (added later: run /add-dir there in the tab)'}`, state: 'ok' }];
        this.trust(next, folders.map((f) => f.dir));
        this.linkPackages(next, folders.map((f) => f.dir));
      }
    }
    this.save(next);
    return add;
  }

  /**
   * What waits on the card, as the message that hands it to Claude now (§93: an idle session the
   * app runs takes it at once), marked sent. Null when nothing waits.
   */
  takeWaiting(id: string): string | null {
    const card = this.get(id);
    const items = card ? waiting(card) : [];
    if (!card || !items.length) return null;
    const now = Date.now();
    this.save({ ...card, later: card.later!.map((i) => (i.sent ? i : { ...i, sent: now })) });
    return laterText(card.key, items, card, this.opts.runnable?.(card));
  }

  /** The card's worktrees as they are now (Shift+X). */
  worktrees(id: string): Promise<CardWorktree[]> {
    const card = this.get(id);
    if (!card) throw new Error('That card is no longer on the line.');
    return worktreeStates(card);
  }

  /**
   * Remove a card's worktrees (Shift+X, or the Delete dialog's w). A card still in flight keeps
   * them unless it is being deleted: its session works in them. The clean ones go; the others need
   * `force`, after the dialog has shown what they hold.
   */
  async removeWorktrees(id: string, force: boolean, deleting = false): Promise<{ removed: CardWorktree[]; kept: CardWorktree[] }> {
    const card = this.get(id);
    if (!card) throw new Error('That card is no longer on the line.');
    if (card.stage !== 'done' && !deleting) throw new Error(`${card.key} isn’t done: its session works in those folders. Remove them with the card (Delete, then w), or once it is done.`);
    const { removed, kept, problems } = await removeWorktrees(card, force);
    if (removed.length) {
      const gone = new Set(removed.map((w) => w.dir));
      const text = `Removed ${removed.map((w) => repoName(w.dir)).join(', ')}${card.launch.branch === 'worktree' && card.branchName ? ` and the branch ${card.branchName}` : ''}`;
      this.save({ ...card, folders: (card.folders ?? []).filter((f) => !gone.has(f.dir)), boot: [...card.boot, { at: Date.now(), text, state: 'ok' }] });
    }
    if (problems.length) throw new Error(`Couldn’t remove ${problems.join('; ')}`);
    return { removed, kept };
  }

  /** Take back something that is still waiting on the card. */
  withdraw(id: string, itemId: string): void {
    const card = this.get(id);
    const item = card?.later?.find((i) => i.id === itemId);
    if (!card || !item) return;
    if (item.sent) throw new Error('That has already gone to Claude.');
    this.save({ ...card, later: card.later!.filter((i) => i !== item) });
  }

  /**
   * The card's ticket as the tracker has it now: its status is kept on the card, and when it has
   * moved past the work (`finished`: Done, Ready for PO) the card goes to Done on its own, with the
   * tile saying why. Nothing happens to a card already done, or when nothing changed.
   */
  ticketMoved(t: Ticket, finished: boolean): Card | undefined {
    const card = this.list().find((c) => c.ticket?.key === t.key && c.ticket.source === t.source);
    if (!card || card.stage === 'done') return undefined;
    const same = card.ticket!.status === t.status && card.ticket!.done === t.done;
    if (same && !finished) return undefined;
    const ticket: Ticket = { ...card.ticket!, status: t.status, done: t.done, updatedAt: Math.max(card.ticket!.updatedAt, t.updatedAt) };
    const next: Card = finished
      ? { ...card, ticket, stage: 'done', live: { ...(card.live ?? { phase: 'waiting' as const }), text: `${t.status} in ${SOURCE_NAME[t.source]}: done`, at: Date.now() } }
      : { ...card, ticket };
    this.save(next);
    return next;
  }

  /** A QA or review card you are finished with (its report copied, or posted by hand) goes to Done. */
  finish(id: string): void {
    const card = this.get(id);
    if (!card) throw new Error('That card is no longer on the line.');
    // A Develop card ships through its PR; once pushed (in Ship) it can be closed by hand too: a PR merged elsewhere, or a host Ship can't follow.
    if ((!card.kind || card.kind === 'build') && card.stage !== 'ship') throw new Error(`${card.key} ships with a pull request: s ships it.`);
    this.save({ ...card, stage: 'done' });
  }

  delete(id: string): void {
    clearTimeout(this.waits.get(id));
    this.waits.delete(id);
    this.store.deleteCard(id);
    this.opts.changed();
  }

  stop(): void {
    for (const t of this.waits.values()) clearTimeout(t);
  }
}
