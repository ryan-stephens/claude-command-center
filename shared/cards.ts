// The Ticket Line's cards: a piece of work, the context Claude starts with, and how it starts.
// Pure and erasable TS, shared by the server (what the hook returns, what gets launched) and the
// web app (the new-card screen's preview and command), so both always say the same thing.

import { repoName, samePath } from './workspaces.ts';

/** The columns of the line, left to right. */
export type Stage = 'inbox' | 'plan' | 'build' | 'needs' | 'try' | 'ship' | 'done';

export const STAGES: { id: Stage; name: string }[] = [
  { id: 'inbox', name: 'Inbox' },
  { id: 'plan', name: 'Plan' },
  { id: 'build', name: 'Build' },
  { id: 'needs', name: 'Needs you' },
  { id: 'try', name: 'Try it' },
  { id: 'ship', name: 'Ship' },
  { id: 'done', name: 'Done' },
];

/** Claude Code's --permission-mode for the session a card starts. */
export type LaunchMode = 'plan' | 'default' | 'auto';
export const LAUNCH_MODES: { id: LaunchMode; name: string }[] = [
  { id: 'plan', name: 'Plan first' },
  { id: 'default', name: 'Ask before edits' },
  { id: 'auto', name: 'Auto' },
];

/**
 * The model a card's session starts with: one of Claude Code's model aliases for `--model`, or
 * nothing, which leaves it to Claude Code (your settings, or the server's CC_CONTROL_MODEL).
 */
export type CardModel = 'opus' | 'sonnet' | 'haiku';
export const CARD_MODELS: { id: CardModel; name: string }[] = [
  { id: 'opus', name: 'Opus' },
  { id: 'sonnet', name: 'Sonnet' },
  { id: 'haiku', name: 'Haiku' },
];

/** The model a card will run: its own choice, else the server's pinned one, else the user's setting. */
export function modelFor(launch: Pick<CardLaunch, 'model'>, pinned?: string, userDefault?: string): string | undefined {
  return launch.model ?? pinned ?? userDefault;
}

/** "Opus" for an alias, the id itself otherwise (a full model id from settings or the server). */
export function modelName(id: string | undefined): string {
  return CARD_MODELS.find((m) => m.id === id)?.name ?? id ?? 'Claude Code’s default';
}

/** new: a branch named after the card · current: stay where the repo is · worktree: a new folder on a new branch. */
export type BranchChoice = 'new' | 'current' | 'worktree';

/** One thing in the packet. Repos carry their absolute path as the id. */
export interface PacketItem {
  kind: 'repo' | 'note';
  id: string;
  label: string;
  on: boolean;
}

/** What Claude starts with, in three layers, plus your own note. */
export interface Packet {
  /** Shared by every card in the workspace: its repos (later: notes, run recipe). */
  workspace: PacketItem[];
  /** From the card's ticket (Jira / Trello, later). */
  ticket: PacketItem[];
  /** Only this card: repos from the library and other extras. */
  card: PacketItem[];
  note: string;
}

export interface CardLaunch {
  /** The repo claude starts in; one of the packet's included repos. */
  home: string;
  branch: BranchChoice;
  mode: LaunchMode;
  /** Chosen on the new-card screen; unset means the default (see modelFor). */
  model?: CardModel;
  /** The first thing claude is told. */
  message: string;
}

/** What the new-card screen sends to start work. */
export interface CardDraft {
  title: string;
  workspaceId: string | null;
  packet: Packet;
  launch: CardLaunch;
}

/** One line of "How it started" on the card's Context tab. */
export interface BootStep {
  at: number;
  text: string;
  state: 'ok' | 'go' | 'bad';
}

/** What the card's session is doing now, followed through its hooks. */
export interface CardLive {
  /** working: Claude is on it · needs: waiting on you in the tab · waiting: its turn ended · ended: the session closed. */
  phase: 'working' | 'needs' | 'waiting' | 'ended';
  /** One line for the tile: "editing GiftCardField.tsx", "Plan ready: approve it in the tab". */
  text: string;
  at: number;
  /** Claude Code's permission mode as the session last reported it. */
  mode?: string;
  /** What it is asking in the tab: a tool to allow, a question, or a plan to approve (with its text). */
  ask?: { kind: 'tool' | 'question' | 'plan'; tool: string; detail?: string; plan?: string };
  /** When the current turn began (for elapsed time). */
  turnSince?: number;
  /** Claude's last message, from the Stop hook. */
  lastMessage?: string;
}

export interface CardTodo {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

export interface Card extends CardDraft {
  id: string;
  /** "CARD-3": what the board and the terminal tab show. Later a ticket key, e.g. SHOP-155. */
  key: string;
  stage: Stage;
  createdAt: number;
  /** The branch it made or stayed on. */
  branchName?: string;
  /** The model it started with, when known (its choice, the server's, or the user's setting). */
  model?: string;
  /** Where claude runs: the home repo, or the worktree made for the card. */
  cwd?: string;
  /** The Claude Code session the SessionStart hook reported. */
  sessionId?: string;
  boot: BootStep[];
  live?: CardLive;
  /** Files Claude wrote or edited, absolute, in the order first touched. */
  files?: string[];
  /** Claude's to-do list: the card's steps. */
  todos?: CardTodo[];
  /** TaskCreate calls waiting for the id in their result (server bookkeeping for the to-do list). */
  creating?: Record<string, { content: string; activeForm?: string }>;
  /** 1, then 2 after you send it back from Try it, and so on. */
  round?: number;
}

/** The repos Claude gets, home first. */
export function includedRepos(p: Packet): string[] {
  const out: string[] = [];
  for (const i of [...p.workspace, ...p.card]) {
    if (i.kind === 'repo' && i.on && !out.some((r) => samePath(r, i.id))) out.push(i.id);
  }
  return out;
}

/** The home repo if it is still included, otherwise the first included repo. */
export function homeOf(p: Packet, launch: Pick<CardLaunch, 'home'>): string | undefined {
  const repos = includedRepos(p);
  return repos.find((r) => samePath(r, launch.home)) ?? repos[0];
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'for', 'to', 'of', 'on', 'in', 'and', 'with']);

/** "card-3-size-guide-product" for CARD-3 "Add a size guide to product pages": short, git-safe. */
export function branchFor(key: string, title: string): string {
  const words = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !STOP_WORDS.has(w)).slice(0, 4);
  return [key.toLowerCase(), ...words].join('-').replace(/-+/g, '-').slice(0, 60).replace(/-$/, '');
}

/** The folder a worktree for the card goes in: next to the home repo. */
export function worktreeFor(home: string, key: string): string {
  return `${home.replace(/[\\/]+$/, '')}-${key.toLowerCase()}`;
}

/** What Claude is told first when the card doesn't say otherwise. */
export function defaultMessage(key: string, mode: LaunchMode): string {
  return mode === 'plan' ? `Plan ${key}.` : `Work on ${key}.`;
}

/**
 * Exactly what Claude receives: the SessionStart hook returns this as additionalContext.
 * `key` and `branch` are known once the card exists; the preview passes what they will be.
 */
export function packetText(d: Pick<CardDraft, 'title' | 'packet' | 'launch'>, key: string, branch?: string): string {
  const L: string[] = [];
  const title = d.title.trim() || 'New card';
  L.push(`# Context from cc-control · ${key} ${title}`);
  L.push('', '## The task', title);
  const repos = includedRepos(d.packet);
  const home = homeOf(d.packet, d.launch);
  if (repos.length) {
    L.push('', '## Repos');
    for (const r of repos) L.push(`- ${repoName(r)} (${r === home ? 'you start here' : 'also yours to read and edit'}): ${r}`);
  }
  if (branch) L.push('', `Work on the branch ${branch}.`);
  const notes = [...d.packet.workspace, ...d.packet.ticket, ...d.packet.card].filter((i) => i.kind === 'note' && i.on);
  if (notes.length) {
    L.push('', '## Notes');
    for (const n of notes) L.push(`- ${n.label}`);
  }
  if (d.packet.note.trim()) L.push('', '## From you', d.packet.note.trim());
  if (d.launch.mode === 'plan') L.push('', 'Start with a plan. Don’t change any files until the plan is approved.');
  return L.join('\n');
}

/** A rough token count (about 4 characters each), as the new-card screen shows it: "1.2k". */
export function tokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function fmtK(n: number): string {
  // Something is never shown as nothing: a one-line repo is still 0.1k.
  return `${(n > 0 ? Math.max(1, Math.round(n / 100)) / 10 : 0).toFixed(1)}k`;
}

/** The share of a 200k-token context window, at least 1%. */
export function memoryPct(n: number): number {
  return Math.max(1, Math.round((n / 200_000) * 100));
}

/** What one packet item adds to the text, for the size beside it. */
export function itemTokens(i: PacketItem): number {
  return tokens(i.kind === 'repo' ? `- ${i.label} (also yours to read and edit): ${i.id}\n` : `- ${i.label}\n`);
}

/**
 * Claude Code puts additionalContext over 10,000 characters in a file and gives Claude only a
 * preview of it, so a packet should stay under this.
 */
export const HOOK_CONTEXT_LIMIT = 10_000;

/**
 * An argument for the command Windows Terminal runs in the new tab. wt splits its own command line
 * on `;` (escaped as `\;`) and then re-quotes each argument for the program, so the text has to
 * survive a second round of Windows quoting: quotes escaped, and backslashes before a quote or at
 * the end doubled.
 */
export function wtArg(s: string): string {
  return s
    .replace(/[\r\n]+/g, ' ')
    .replace(/(\\*)"/g, (_m, bs: string) => `${bs}${bs}\\"`)
    .replace(/(\\+)$/, '$1$1')
    .replace(/;/g, '\\;');
}

/**
 * The steps Start work takes, as shown under "What happens" (and run by the server). `pinned` is
 * the server's CC_CONTROL_MODEL; the card's own choice wins over it.
 */
export function launchLines(d: Pick<CardDraft, 'title' | 'packet' | 'launch'>, key: string, pinned?: string): string[] {
  const model = d.launch.model ?? pinned;
  const home = homeOf(d.packet, d.launch) ?? '(no repo)';
  const others = includedRepos(d.packet).filter((r) => !samePath(r, home));
  const branch = branchFor(key, d.title || 'new');
  const L: string[] = [];
  let dir = home;
  if (d.launch.branch === 'new') L.push(`git -C ${home} switch -c ${branch}`);
  if (d.launch.branch === 'worktree') {
    dir = worktreeFor(home, key);
    L.push(`git -C ${home} worktree add ${dir} -b ${branch}`);
  }
  L.push(`set CC_CONTROL_CARD=${key}`);
  L.push(`wt -w 0 nt --title ${key} -d ${dir} claude --settings <cc-control hook> --permission-mode ${d.launch.mode}`
    + (model ? ` --model ${model}` : '')
    + others.map((r) => ` --add-dir ${r}`).join('')
    + ` -- "${d.launch.message}"`);
  return L;
}
