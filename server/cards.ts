// The Ticket Line's server half: a card saves its context, makes its branch and starts `claude` in
// a Windows Terminal tab. The tab's SessionStart hook (hooks/cc-control-hook.mjs, loaded with
// `claude --settings`, so nothing is added to the user's own settings) calls back here with the
// card id and token, gets the packet as additionalContext, and reports the session id, which
// links the card to the session.

import { execFile, spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRANCH_NAME, branchFor, CARD_KINDS, CARD_MODELS, cardRepos, defaultMessage, folderFor, PACKET_KINDS, homeOf, includedRepos, isClean, LAUNCH_MODES, laterText, modelFor, ownFolders, packetText, tokens, fmtK, waiting, worktreeFor, wtArg,
  type BranchChoice, type BootStep, type Card, type CardDraft, type CardFolder, type CardKind, type CardWorktree, type LaterItem, type LaunchMode, type Packet, type PacketItem, type PrTarget,
} from '../shared/cards.ts';
import type { Workspace } from '../shared/protocol.ts';
import type { Ticket } from '../shared/tickets.ts';
import { repoName, samePath } from '../shared/workspaces.ts';
import { applyEvent, TRACKED_EVENTS, type HookInput } from './card-events.ts';
import { SECRET } from './config.ts';
import { normalizeFolder } from './fs-browse.ts';
import { DB_PATH, type Store } from './store.ts';
import { trustFolders } from './trust.ts';

const HOOK_SCRIPT = fileURLToPath(new URL('../hooks/cc-control-hook.mjs', import.meta.url));
/** How long a new tab has to report in before the card says something may be wrong. */
const HOOK_WAIT_MS = 45_000;
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
  if (!channel) return [claude, ...args, '--', wtArg(message)];
  const payload = Buffer.from(JSON.stringify([claude, ...args, '--', message]), 'utf8').toString('base64');
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
    launch: { home, mode, branch, ...(model ? { model } : {}), message: str(l.message, 1000).replace(/[\r\n]+/g, ' ').trim() },
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
 * left as it is and named in `skipped`, except the home repo, which must be one. If any worktree
 * can't be made, the ones already made are removed with their branches, so nothing is left half done.
 */
export async function makeWorktrees(repos: string[], home: string, key: string, branch: string, onExisting = false): Promise<{ folders: CardFolder[]; skipped: string[] }> {
  const folders: CardFolder[] = [];
  const made: string[] = [];
  const skipped: string[] = [];
  try {
    for (const repo of repos) {
      const top = await git(repo, ['rev-parse', '--show-toplevel']).catch(() => '');
      if (!top || !samePath(top, repo)) {
        if (samePath(repo, home)) throw new Error(`${repoName(repo)} isn’t a git repo, so it can’t have a worktree.`);
        skipped.push(repo);
        continue;
      }
      const dir = worktreeFor(repo, key);
      if (existsSync(dir)) throw new Error(`${dir} already exists, so the worktree for ${repoName(repo)} can’t go there.`);
      const has = onExisting && Boolean(await git(repo, ['branch', '--list', branch]).catch(() => ''));
      await git(repo, ['worktree', 'add', dir, ...(has ? [branch] : ['-b', branch])]).catch((e: Error) => { throw new Error(`Couldn't make a worktree for ${repoName(repo)}: ${e.message}`); });
      folders.push({ repo, dir });
      if (!has) made.push(repo);
    }
  } catch (e) {
    for (const f of folders) {
      await git(f.repo, ['worktree', 'remove', '--force', f.dir]).catch(() => {});
      if (made.includes(f.repo)) await git(f.repo, ['branch', '-D', branch]).catch(() => {});
    }
    throw e;
  }
  return { folders, skipped };
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
      else await git(w.repo, ['worktree', 'remove', '--force', w.dir]);
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

/** claude.exe on PATH, so Windows Terminal starts the same one a terminal would. */
export function findClaude(): string {
  if (process.env.CC_CONTROL_CLAUDE) return process.env.CC_CONTROL_CLAUDE;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const exe = join(dir, 'claude.exe');
    if (dir && existsSync(exe)) return exe;
  }
  return 'claude';
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
  changed: () => void;
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
    return this.store.loadCards().find((c) => c.id === id);
  }

  /** Change a card and tell the page (Ship's steps and PR). Returns the card as saved. */
  update(id: string, change: (c: Card) => Card): Card | undefined {
    const card = this.get(id);
    if (!card) return undefined;
    const next = change(card);
    this.save(next);
    return next;
  }

  private save(card: Card): void {
    this.store.saveCard(card);
    this.opts.changed();
  }

  private step(card: Card, text: string, state: BootStep['state'] = 'ok'): void {
    card.boot.push({ at: Date.now(), text, state });
  }

  /** Branch, then the terminal tab. Fails before saving anything if either can't be done, so the new-card screen can be fixed and retried. */
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
      if (existsSync(dir)) throw new Error(`${dir} already exists, so the copy on PR #${number}'s branch can't go there.`);
      await git(start, ['fetch', 'origin', source, target]).catch((e: Error) => { throw new Error(`Couldn't fetch ${source} from origin in ${repoName(start)}: ${e.message}`); });
      await git(start, ['worktree', 'add', '--detach', dir, `origin/${source}`]).catch((e: Error) => { throw new Error(`Couldn't make a copy of ${repoName(start)} on ${source}: ${e.message}`); });
      card.cwd = dir;
      card.branchName = source;
      this.step(card, `Fetched PR #${number}’s branch and made a copy ${repoName(dir)} on ${source}`);
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
    }
    if (card.launch.branch === 'pr' && card.pr) card.folders = [{ repo: start, dir: card.cwd }];
    this.trust(card, ownFolders(card).map((f) => f.dir));

    card.model = modelFor(card.launch, this.opts.model, this.opts.userModel?.());
    const token = crypto.randomUUID();
    const others = includedRepos(card.packet).filter((r) => !samePath(r, start)).map((r) => folderFor(card, r));
    const claudeArgs = ['--settings', writeHookSettings(), ...channelArgs(),
      '--permission-mode', card.launch.mode, ...((card.launch.model ?? this.opts.model) ? ['--model', card.launch.model ?? this.opts.model!] : []),
      ...others.flatMap((r) => ['--add-dir', r])];
    // The title stays the card's key (Claude Code would otherwise retitle the tab), so g can find the tab again.
    const args = ['-w', '0', 'nt', '--title', key, '--suppressApplicationTitle', '-d', card.cwd, ...tabCommand(findClaude(), claudeArgs, card.launch.message)];
    await new Promise<void>((resolve, reject) => {
      const child = spawn('wt.exe', args, { env: tabEnv(process.env, card.id, token, this.opts.port), stdio: 'ignore', windowsHide: true, detached: true });
      child.on('error', (e) => reject(new Error(`Couldn't open Windows Terminal (wt.exe): ${e.message}`)));
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Windows Terminal exited with code ${code}.`))));
      child.unref();
    });
    this.step(card, `Opened a Windows Terminal tab in ${card.cwd}${others.length ? ` with ${others.length} more repo${others.length === 1 ? '' : 's'}` : ''}`);
    this.step(card, 'Waiting for the session to start', 'go');
    this.store.saveCard(card, token);
    this.opts.changed();
    this.waits.set(card.id, setTimeout(() => this.noWord(card.id), HOOK_WAIT_MS));
    return card;
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
    let next = applyEvent(card, event, input, Date.now());
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
        next.boot = [...card.boot, { at: now, text: `Made ${folders.length === 1 ? `a worktree ${repoName(folders[0].dir)}` : `worktrees ${folders.map((f) => repoName(f.dir)).join(', ')}`} on ${card.branchName} (added later: run /add-dir there in the tab)`, state: 'ok' }];
        this.trust(next, folders.map((f) => f.dir));
      }
    }
    this.save(next);
    return add;
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
