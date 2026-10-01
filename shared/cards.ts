// The Ticket Line's cards: a piece of work, the context Claude starts with, and how it starts.
// Pure and erasable TS, shared by the server (what the hook returns, what gets launched) and the
// web app (the new-card screen's preview and command), so both always say the same thing.

import type { PullRequest } from './ship.ts';
import { ticketText, type Ticket } from './tickets.ts';
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

/**
 * What the card is for. Not every ticket is code to write: some are someone else's change to test
 * (QA), some are a pull request to review. The kind sets what Claude is told its job is, the
 * branch and mode it starts with, and how the card ends: a PR (Develop) or a report (QA, Review).
 */
export type CardKind = 'build' | 'qa' | 'review';
export const CARD_KINDS: { id: CardKind; name: string; blurb: string }[] = [
  { id: 'build', name: 'Develop', blurb: 'Plan and make the change, try it, ship a PR.' },
  { id: 'qa', name: 'QA', blurb: 'Test someone’s change: a test plan from the ticket, the test data set up, a walk through each check, a report.' },
  { id: 'review', name: 'Code review', blurb: 'Review the ticket’s pull request against the ticket, read-only. Findings stay here until you post them.' },
];

export const kindName = (k: CardKind | undefined) => CARD_KINDS.find((x) => x.id === (k ?? 'build'))!.name;

/** A ticket waiting for QA is a QA card; one in review is a review; the rest are development. */
export function kindForTicket(t: Pick<Ticket, 'status' | 'views'> | null | undefined): CardKind {
  if (!t) return 'build';
  if (t.views?.includes('qa') && !t.views.includes('mine')) return 'qa';
  if (/\b(qa|testing|in test)\b/i.test(t.status)) return 'qa';
  if (/review/i.test(t.status)) return 'review';
  return 'build';
}

/** The pull request a QA or review card looks at, as the host found it by the ticket's key. */
export interface PrTarget {
  number: number;
  title: string;
  url: string;
  host: 'github' | 'azure';
  /** Its branch, and the branch it goes into. */
  source: string;
  target: string;
  /** The repo it was found in (one of the card's). */
  repo: string;
}

/** Git-safe branch names only: they go on a git command line. */
export const BRANCH_NAME = /^(?!-)[\w./-]{1,200}$/;

/** new: a branch named after the card · current: stay where the repo is · worktree: a new folder on a new branch · pr: a new folder on the PR's branch (QA and review). */
export type BranchChoice = 'new' | 'current' | 'worktree' | 'pr';

/**
 * One thing in the packet. Repos carry their absolute path as the id. The ticket layer holds the
 * ticket's parts (desc, ac, comments, attach, linked); a 'ticket' in the card layer is a related one.
 * `text` is what Claude gets when it differs from the label (a description, the comments).
 */
export interface PacketItem {
  kind: PacketKind;
  id: string;
  label: string;
  text?: string;
  on: boolean;
}
export type PacketKind = 'repo' | 'note' | 'desc' | 'ac' | 'comments' | 'attach' | 'linked' | 'ticket' | 'recipe';
export const PACKET_KINDS: PacketKind[] = ['repo', 'note', 'desc', 'ac', 'comments', 'attach', 'linked', 'ticket', 'recipe'];

/** What Claude starts with, in three layers, plus your own note. */
export interface Packet {
  /** Shared by every card in the workspace: its repos and the home repo's run recipe (later: notes). */
  workspace: PacketItem[];
  /** From the card's ticket (Jira / Trello). */
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
  /** The card's ticket, when it has one: the page sends its key, the server fills in the ticket. */
  ticketKey?: string;
  /** Develop (unset), QA or Code review. */
  kind?: CardKind;
  /** QA and review: the ticket's pull request, when the host found one. */
  pr?: PrTarget;
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

/** A repo the card works on in a folder of its own: a worktree on the card's branch. */
export interface CardFolder {
  repo: string;
  dir: string;
}

export interface Card extends CardDraft {
  id: string;
  /**
   * The card's worktrees, one per git repo in its context (a worktree card), or the PR's copy (a
   * review): Claude, Try it and the stack's APIs use these in place of the repos' own folders.
   */
  folders?: CardFolder[];
  /** "CARD-3", or the ticket's key (SHOP-155): what the board and the terminal tab show. */
  key: string;
  /** The ticket as it was when the card started. */
  ticket?: Ticket;
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
  /** Its terminal is reachable through the channel: messages and permission answers go in from here. */
  channel?: boolean;
  /**
   * The permission prompt the terminal relayed through the channel, until it is answered or the
   * tool runs. Kept apart from live.ask: the hooks that describe the same prompt arrive in their own
   * time (PreToolUse clears the ask, PermissionRequest rebuilds it) and must not lose the id.
   */
  relayed?: { requestId: string; tool: string; description?: string; at: number };
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
  /** Context added since it started: it waits on the card until a hook hands it to Claude. */
  later?: LaterItem[];
  /** Shipping it: each step (branch, commit, push, PR, merge) and the pull request it opened. */
  ship?: { steps: BootStep[]; pr?: PullRequest };
  /** QA and review: the report Claude ended with (its QA report or review findings). */
  report?: CardReport;
}

/** A QA report or review findings, from the message Claude wrote it in. */
export interface CardReport {
  text: string;
  at: number;
  /** "Passed", "Failed", "Blocked"; "Approve", "Changes requested"… when the report says. */
  result?: string;
}

/** The heading a report starts with (Claude is told to use it, see jobText). */
const REPORT_HEADING = /^#{1,3}\s*(QA report|Code review)\b.*$/im;

/**
 * The report in a message, if it has one: from its heading to the end, with the result it states.
 * Only QA and review cards write reports.
 */
export function reportIn(message: string, at: number): CardReport | undefined {
  const m = REPORT_HEADING.exec(message);
  if (!m) return undefined;
  const text = message.slice(m.index).trim();
  const result = /^\W*(?:result|verdict)\W*[:\-–]\W*([A-Za-z][A-Za-z ]{1,30}?)\W*$/im.exec(text)?.[1]?.trim();
  return { text, at, ...(result ? { result } : {}) };
}

/**
 * Something added to a running card. It waits until the next message typed in the card's tab
 * (the UserPromptSubmit hook sends it along), or until the session starts or is cleared, when
 * SessionStart sends it with the packet. A note you wrote is a `note` whose text is yours.
 */
export interface LaterItem extends PacketItem {
  /** When you added it. */
  at: number;
  /** When a hook handed it to Claude; unset while it waits. */
  sent?: number;
}

/** Waiting on the card: not handed to Claude yet. */
export function waiting(c: Pick<Card, 'later'>): LaterItem[] {
  return (c.later ?? []).filter((i) => !i.sent);
}

/** Every repo the card's session can use: what it started with and any added since, home first. */
/**
 * What the card is asking, as the page answers it: the hook's description when it has one (fuller:
 * the plan text, the question), else the relayed prompt alone. `answerable` means y / n go through
 * the channel; a question is answered by typing instead.
 */
export function askOf(c: Pick<Card, 'live' | 'relayed' | 'channel'>): { kind: 'tool' | 'question' | 'plan'; tool: string; detail?: string; plan?: string; requestId?: string } | undefined {
  const ask = c.live?.ask;
  const r = c.relayed;
  const matches = r && (!ask || ask.tool === r.tool);
  if (ask) return matches && c.channel ? { ...ask, requestId: r.requestId } : ask;
  if (r && c.channel) return { kind: r.tool === 'ExitPlanMode' ? 'plan' : 'tool', tool: r.tool, ...(r.description ? { detail: r.description } : {}), requestId: r.requestId };
  return undefined;
}

export function cardRepos(c: Pick<Card, 'packet' | 'later'>): string[] {
  const out = includedRepos(c.packet);
  for (const i of c.later ?? []) if (i.kind === 'repo' && !out.some((r) => samePath(r, i.id))) out.push(i.id);
  return out;
}

/**
 * Exactly what Claude gets when context is added to a running card: the hook returns this as
 * additionalContext alongside your next message.
 */
export function laterText(key: string, items: PacketItem[]): string {
  const repos = items.filter((i) => i.kind === 'repo');
  const notes = items.filter((i) => i.kind === 'note');
  const rest = items.filter((i) => i.kind !== 'repo' && i.kind !== 'note');
  const L = [`# Added to ${key} by cc-control`, '', 'More context for this card, added since it started. Take it into account from here on.'];
  if (repos.length) {
    L.push('', '## More repos you can read and edit');
    for (const r of repos) L.push(`- ${r.label}: ${r.id}`);
  }
  if (rest.length) {
    L.push('', '## Also look at');
    for (const i of rest) L.push(`- ${(i.text ?? i.label).replace(/\n/g, '\n  ')}`);
  }
  for (const n of notes) L.push('', '## From you', (n.text ?? n.label).trim());
  return L.join('\n');
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

const STOP_WORDS = new Set(['a', 'an', 'the', 'for', 'to', 'of', 'on', 'in', 'and', 'with', 'at', 'by', 'from', 'into', 'is']);

/** "card-3-size-guide-product" for CARD-3 "Add a size guide to product pages": short, git-safe. */
export function branchFor(key: string, title: string): string {
  const words = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !STOP_WORDS.has(w)).slice(0, 4);
  return [key.toLowerCase(), ...words].join('-').replace(/-+/g, '-').slice(0, 60).replace(/-$/, '');
}

/** Where the card works on a repo: its worktree of it, else the repo's own folder. */
export function folderFor(c: { folders?: CardFolder[] }, repo: string): string {
  return c.folders?.find((f) => samePath(f.repo, repo))?.dir ?? repo;
}

/** The folder a worktree for the card goes in: next to the repo it is of. */
export function worktreeFor(home: string, key: string): string {
  return `${home.replace(/[\\/]+$/, '')}-${key.toLowerCase()}`;
}

/** What Claude is told first when the card doesn't say otherwise. */
export function defaultMessage(key: string, mode: LaunchMode, kind: CardKind = 'build'): string {
  if (kind === 'qa') return `QA ${key}: start with the test plan.`;
  if (kind === 'review') return `Review ${key}.`;
  return mode === 'plan' ? `Plan ${key}.` : `Work on ${key}.`;
}

/** The mode and branch each kind starts with: QA and review don't make a branch of their own. */
export function kindDefaults(kind: CardKind, pr?: PrTarget | null): Pick<CardLaunch, 'mode' | 'branch'> {
  if (kind === 'build') return { mode: 'plan', branch: 'new' };
  // A review stays read-only in plan mode; QA plans its checks first, then sets up data and tests.
  return { mode: 'plan', branch: kind === 'review' && pr ? 'pr' : 'current' };
}

const prLine = (pr: PrTarget) => `PR #${pr.number} “${pr.title}”, ${pr.source} → ${pr.target} (${pr.url})`;

/**
 * What a QA or review card is for, in Claude's words: the "Your job" section of the packet. A
 * development card needs none (the ticket is the job). The report heading is what cc-control
 * looks for to put the report on the card.
 */
export function jobText(kind: CardKind | undefined, key: string, pr?: PrTarget, onPrBranch = false): string[] {
  if (kind === 'qa') {
    return [
      '', '## Your job: QA this ticket',
      'Someone else built this change. You are testing it, not changing it.',
      ...(pr ? [`The change: ${prLine(pr)}.${onPrBranch ? ' You start in a copy of the repo on its branch.' : ''}`] : []),
      '1. Write a test plan from the ticket: numbered checks, at least one for each "Done when" item, plus the edge cases it implies. For each: the data it needs, the steps, and what should happen.',
      '2. Set up the test data the checks need, the way "How this team tests" below says (for example a loan in the state the ticket describes). Say what you created (ids, links) so it can be found again.',
      '3. Walk me through the checks one at a time: what to do and what to look for. Check what you can yourself (APIs, queries, logs); for the rest, wait for what I saw. Record each as pass or fail.',
      '4. Don’t change the code under test. For a bug, give the steps to reproduce it, what should happen and what did.',
      '5. End with the report, starting with this heading so cc-control picks it up:',
      `   # QA report: ${key}`,
      '   Result: Passed, Failed or Blocked',
      '   Then a table of the checks (pass / fail / notes), the bugs found, the test data used, and where it was tested.',
    ];
  }
  if (kind === 'review') {
    return [
      '', '## Your job: review this change',
      'You are reviewing someone else’s work. Read, don’t change: no edits, commits or pushes, and nothing posted anywhere.',
      ...(pr
        ? [`The change: ${prLine(pr)}.`, onPrBranch
          ? `You start in a copy of the repo on its branch: the change is \`git diff origin/${pr.target}...HEAD\`.`
          : `Its branch is ${pr.source}: fetch it and compare it with origin/${pr.target}.`]
        : [`No pull request was found for ${key}. Find its branch (git fetch, then git branch -r and git log --all --grep=${key}) and review it against the branch it goes into.`]),
      '1. Check it against the ticket: does it do each "Done when" item? Is anything missing, or anything done that the ticket didn’t ask for?',
      '2. Look for bugs, edge cases, security, error handling, missing tests, and anything that breaks the repo’s own patterns.',
      '3. End with your findings, starting with this heading so cc-control picks it up:',
      `   # Code review: ${key}`,
      '   Verdict: Approve, Approve with suggestions, or Changes requested',
      '   Then each finding as `path:line`, how serious (blocking, should fix, nit), what is wrong and what to do instead.',
    ];
  }
  return [];
}

/**
 * Exactly what Claude receives: the SessionStart hook returns this as additionalContext.
 * `key` and `branch` are known once the card exists; the preview passes what they will be.
 */
export function packetText(d: Pick<CardDraft, 'title' | 'packet' | 'launch' | 'kind' | 'pr'> & { ticket?: Pick<Ticket, 'key' | 'source'> | null; folders?: CardFolder[] }, key: string, branch?: string): string {
  const L: string[] = [];
  const title = d.title.trim() || 'New card';
  const kind = d.kind ?? 'build';
  L.push(`# Context from cc-control · ${key} ${title}`);
  if (d.ticket) L.push(...ticketText(d.ticket, d.packet.ticket));
  else L.push('', '## The task', title);
  L.push(...jobText(kind, key, d.pr, d.launch.branch === 'pr'));
  const repos = includedRepos(d.packet);
  const home = homeOf(d.packet, d.launch);
  if (repos.length) {
    L.push('', '## Repos');
    for (const r of repos) L.push(`- ${repoName(r)} (${r === home ? 'you start here' : kind === 'review' ? 'also yours to read' : 'also yours to read and edit'}): ${folderFor(d, r)}`);
  }
  const own = (d.folders ?? []).filter((f) => !samePath(f.dir, f.repo)).length;
  if (branch) L.push('', kind === 'build' ? `Work on the branch ${branch}.${own > 1 ? ' Each repo above is a worktree of its own on that branch: change them there, not in the repos’ usual folders.' : ''}` : `You are on ${branch}.`);
  const all = [...d.packet.workspace, ...d.packet.ticket, ...d.packet.card].filter((i) => i.kind === 'note' && i.on);
  const testing = all.filter((i) => i.id === TESTING_NOTES);
  const notes = all.filter((i) => i.id !== TESTING_NOTES);
  if (notes.length) {
    L.push('', '## Notes');
    for (const n of notes) L.push(n.text ? `${n.label}:\n${n.text.trim()}` : `- ${n.label}`);
  }
  for (const n of testing) L.push('', '## How this team tests', (n.text ?? n.label).trim());
  const recipes = d.packet.workspace.filter((i) => i.on && i.kind === 'recipe');
  if (recipes.length) {
    L.push('', '## Running the app');
    for (const r of recipes) L.push(r.text ?? r.label);
  }
  const extra = d.packet.card.filter((i) => i.on && i.kind === 'ticket');
  if (extra.length) {
    L.push('', '## Also look at');
    for (const i of extra) L.push(`- ${(i.text ?? i.label).replace(/\n/g, '\n  ')}`);
  }
  if (d.packet.note.trim()) L.push('', '## From you', d.packet.note.trim());
  if (d.launch.mode === 'plan') {
    L.push('', kind === 'qa' ? 'Start with the test plan. Don’t set up data or change anything until it is approved.'
      : kind === 'review' ? 'Plan mode keeps this read-only. There is nothing to build, so reply with your findings instead of presenting a plan.'
      : 'Start with a plan. Don’t change any files until the plan is approved.');
  }
  return L.join('\n');
}

/** The ids of the workspace's notes in the packet: for every card, and how the team tests (QA cards). */
export const WORKSPACE_NOTES = 'ws:notes';
export const TESTING_NOTES = 'ws:testing';

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
  return tokens(i.kind === 'repo' ? `- ${i.label} (also yours to read and edit): ${i.id}\n` : `- ${i.text ?? i.label}\n`);
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
export function launchLines(d: Pick<CardDraft, 'title' | 'packet' | 'launch' | 'pr'>, key: string, pinned?: string): string[] {
  const model = d.launch.model ?? pinned;
  const home = homeOf(d.packet, d.launch) ?? '(no repo)';
  const others = includedRepos(d.packet).filter((r) => !samePath(r, home));
  const branch = branchFor(key, d.title || 'new');
  const L: string[] = [];
  let dir = home;
  let add = others;
  if (d.launch.branch === 'new') L.push(`git -C ${home} switch -c ${branch}`);
  if (d.launch.branch === 'worktree') {
    // A worktree for every repo, all on the card's branch: Try it then runs each from the card's own code.
    dir = worktreeFor(home, key);
    for (const r of [home, ...others]) L.push(`git -C ${r} worktree add ${worktreeFor(r, key)} -b ${branch}`);
    add = others.map((r) => worktreeFor(r, key));
  }
  if (d.launch.branch === 'pr' && d.pr) {
    dir = worktreeFor(home, key);
    L.push(`git -C ${home} fetch origin ${d.pr.source} ${d.pr.target}`);
    L.push(`git -C ${home} worktree add --detach ${dir} origin/${d.pr.source}`);
  }
  L.push(`set CC_CONTROL_CARD=${key}`);
  L.push(`wt -w 0 nt --title ${key} -d ${dir} claude --settings <cc-control hook> --permission-mode ${d.launch.mode}`
    + (model ? ` --model ${model}` : '')
    + add.map((r) => ` --add-dir ${r}`).join('')
    + ` -- "${d.launch.message}"`);
  return L;
}
