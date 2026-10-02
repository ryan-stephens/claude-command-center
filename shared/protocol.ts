// WebSocket protocol shared by server and web. Plain types only (erasable TS, runs under Node type stripping).

import type { Card, CardDraft, CardWorktree, PacketItem, PrTarget } from './cards.ts';
import type { PromptContext, SavedPrompt } from './prompts.ts';
import type { CardRun, LogLine, RunRecipe } from './recipes.ts';
import type { ShipPlan, ShipRequest } from './ship.ts';
import type { Stack, StackApiRow, StackChoice } from './stack.ts';
import type { Finding } from './stack-detect.ts';
import type { Ticket, TicketProject, TicketSources } from './tickets.ts';

/**
 * Bump when the client starts relying on a message an older server doesn't handle. The server
 * says `hello` first; a page that hears anything else first is talking to a server from before
 * this existed, which drops newer messages without a word, so the page says to restart it.
 */
import type { Changes } from './changes.ts';
import type { TicketTransition } from './tickets.ts';

export const PROTOCOL = 25;

export type SessionStatus = 'idle' | 'running' | 'requires_action' | 'stopped';

/** How much Claude may do without asking (Claude Code's Shift+Tab modes). */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'dontAsk' | 'auto';
/** The modes Shift+Tab cycles through, in order (bypassing permissions is never offered). */
/** Shift+Tab cycles these, as in Claude Code. Never bypassPermissions. */
export const MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto'];

/** A file offered as you type "@" in the message box. */
export interface FileHit {
  /** What goes after "@": relative in the session's own repo, full for its other repos. */
  path: string;
  /** Relative to its repo, for display. */
  label: string;
  /** Set for files in the session's other repos. */
  repo?: string;
}

/** An image pasted or dropped into a message. */
export interface ImageAttachment {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  /** Base64, no data: prefix. */
  data: string;
}

/** One line of Claude's to-do list (TodoWrite, or the TaskCreate / TaskUpdate tools). */
export interface Todo {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  /** "Running the tests": shown while it is in progress. */
  activeForm?: string;
}

/** One multiple-choice question Claude asks (the AskUserQuestion tool). */
export interface Question {
  question: string;
  /** A short chip, e.g. "Auth method". */
  header: string;
  multiSelect: boolean;
  options: { label: string; description: string }[];
}

export interface SessionSummary {
  id: string;
  title: string;
  cwd: string;
  branch?: string;
  lastModified: number;
  /** Owned by this server (a live `query()`), so it can be driven. */
  live: boolean;
  /** Only meaningful for live sessions. */
  status?: SessionStatus;
  /** Transcript written recently by someone else, probably an open terminal. */
  activeElsewhere?: boolean;
  ctxPct?: number;
  /** Live sessions: subagents / shells still running in the background. */
  background?: number;
  /** Repos added to this session itself, besides its own cwd (SDK `additionalDirectories`). */
  extraDirs?: string[];
  /** Repos it can use because a workspace holding its cwd lists them (also `additionalDirectories`). */
  workspaceDirs?: string[];
  /** Live sessions: the permission mode and model its CLI reports. */
  mode?: PermissionMode;
  model?: string;
}

/** The parts of a tool call worth showing in plain language (a Bash call's own description, the file, an edit). */
export interface ToolFields {
  command?: string;
  /** Claude's own one-line explanation of a Bash call, e.g. "Check app.js for syntax errors". */
  description?: string;
  filePath?: string;
  pattern?: string;
  url?: string;
  /** Edit / Write: the text replaced and its replacement, trimmed for display. */
  edit?: { before: string; after: string };
}

// ---- Workspaces and the repo library -----------------------------------------

/** A named group of repos. Sessions belong to it by their cwd. */
export interface Workspace {
  id: string;
  name: string;
  /** One of WORKSPACE_COLORS. */
  color: string;
  /** Absolute repo paths, in display order. */
  repos: string[];
  /** Where new sessions start; defaults to the first repo. */
  home?: string;
  /** Notes for Claude that every card in the workspace starts with. */
  notes?: string;
  /** How this team tests (tools, test data, environments): QA cards start with it. */
  testing?: string;
}

/** A workspace as a file to share: repos by folder name, since paths differ between machines. */
export interface WorkspaceFile {
  /** The workspace's own run recipe (steps as written), when it has one. */
  recipe?: { steps: string[]; url?: string };
  /** The workspace's stack (the APIs Try it can start, and the UI pointed at them), when it has one. */
  stack?: Stack;
  kind: 'cc-control.workspace';
  version: 1;
  name: string;
  color: string;
  repos: { name: string; home?: boolean }[];
  workflows: CommandPack;
  /** The workspace's notes for Claude, and how the team tests: shared team knowledge. */
  notes?: string;
  testing?: string;
}

/** A git repo found under one of the library's source folders. */
export interface RepoInfo {
  path: string;
  name: string;
  branch?: string;
  lastModified?: number;
}

/** One folder in the folder picker. */
export interface FolderEntry {
  name: string;
  path: string;
  /** It is a git repo itself. */
  repo: boolean;
  /** Git repos directly inside it: a good folder to give the repo library. */
  repos: number;
  /** Starting points only: "drive", "your home folder", "suggested"… */
  note?: string;
}

/** A folder's subfolders, or (path null) the starting points: drives, home, likely repo folders. */
export interface FolderListing {
  path: string | null;
  parent: string | null;
  /** The breadcrumb, root first. */
  crumbs: { name: string; path: string }[];
  repo: boolean;
  /** Repos directly inside this folder. */
  repos: number;
  entries: FolderEntry[];
  /** More subfolders than were listed. */
  truncated: boolean;
}

export type TranscriptItem =
  | { kind: 'user'; uuid: string; text: string }
  | { kind: 'assistant'; uuid: string; text: string }
  | { kind: 'tool'; uuid: string; toolUseId: string; name: string; input: string; fields?: ToolFields }
  | { kind: 'tool_result'; uuid: string; toolUseId: string; text: string; isError: boolean }
  | { kind: 'result'; uuid: string; subtype: string; durationMs?: number; costUsd?: number }
  | { kind: 'notice'; uuid: string; text: string };

// ---- Live activity: what the session is doing right now (Claude Code's spinner line) ----

export type ActivityPhase =
  | 'idle'
  | 'requesting' // waiting on the model
  | 'thinking'
  | 'writing'
  | 'tool' // running a tool
  | 'compacting'
  | 'retrying' // API error, backing off
  | 'approval'; // blocked on you

export interface ActivityTask {
  id: string;
  /** e.g. local_agent (subagent), local_bash (shell), local_workflow */
  kind: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'killed' | 'paused';
  /** Runs independently of the turn (keeps going after the session is idle). */
  background: boolean;
  startedAt: number;
  endedAt?: number;
  lastTool?: string;
  toolUses?: number;
  summary?: string;
}

export interface SessionActivity {
  phase: ActivityPhase;
  /** Epoch ms the current phase began; the UI ticks elapsed time from it. */
  phaseSince: number;
  /** Epoch ms the current turn began; absent between turns. */
  turnStartedAt?: number;
  /** The tool being run (phase 'tool' or 'approval'). */
  tool?: { name: string; detail?: string; fields?: ToolFields };
  thinkingTokens?: number;
  retry?: { attempt: number; max: number; resumeAt: number; status: number | null };
  /** Subagents, shells and workflows: running ones, plus recently finished ones for context. */
  tasks: ActivityTask[];
}

export interface PermissionRequest {
  reqId: string;
  sessionId: string;
  tool: string;
  /** Human-readable summary of the tool input. */
  input: string;
  fields?: ToolFields;
  /** Whether an "Always allow" rule is on offer. */
  canAlways: boolean;
  /** Claude is asking you something (AskUserQuestion): answer, don't allow. */
  questions?: Question[];
  /** Claude proposes this plan (ExitPlanMode, markdown) and wants to start on it. */
  plan?: string;
  /** Epoch ms; the inbox and Alt+N serve the oldest first. */
  createdAt: number;
}

export type PermissionDecision = 'allow' | 'always' | 'deny';

/** Per-install preferences, stored in SQLite and shared by every browser. */
/** Where the keycaps show: everywhere (the cockpit), only while hovering (and in ?), or nowhere but ?. */
export type KeyHints = 'always' | 'hover' | 'never';
export const KEY_HINTS: KeyHints[] = ['always', 'hover', 'never'];

export interface Settings {
  /** Key binding overrides: action id → combos (see web/bindings.ts). */
  bindings?: Record<string, string[]>;
  /** Key hints on the screens (web/hints.ts). Unset: always. */
  keyHints?: KeyHints;
  /** Mark a card's new worktrees trusted in ~/.claude.json before its tab opens, so Claude Code doesn't ask. Unset: off. */
  trustWorktrees?: boolean;
  /** The new-card screen: the one-column simple look (§59), or the full three-panel one. Unset: simple. */
  newCardLook?: NewCardLook;
}

export type NewCardLook = 'simple' | 'full';
export const NEW_CARD_LOOKS: NewCardLook[] = ['simple', 'full'];

// ---- Command board ---------------------------------------------------------

/** send: fire immediately · insert: drop into the composer · template: fill {{placeholders}} first */
export type CommandMode = 'send' | 'insert' | 'template';
/** workspace: SQLite, per workspace · global: SQLite · repo: <cwd>/.cc-control/commands.json · auto: the session's slash commands (read-only) */
export type CommandScope = 'workspace' | 'global' | 'repo' | 'auto';

export interface Command {
  label: string;
  body: string;
  mode: CommandMode;
  /** 1–9, the numpad key. */
  slot: number;
}

export interface CommandGroup {
  name: string;
  scope: CommandScope;
  commands: Command[];
  /** Workspace scope: which workspace owns the group. */
  workspaceId?: string;
}

/** A slash command or skill the session's CLI understands, for suggestions as you type "/". */
export interface SlashInfo {
  name: string;
  description: string;
  /** e.g. "<model>"; absent when it takes no arguments. */
  argumentHint?: string;
  /** Other names that run it, e.g. reset and new for clear. */
  aliases?: string[];
}

/** A model /model can switch to (SDK supportedModels). */
export interface ModelChoice {
  /** What goes after /model, e.g. "sonnet". */
  value: string;
  displayName: string;
  description?: string;
}

/** Shareable JSON: the format of repo packs and of import/export. */
export interface CommandPack {
  version: 1;
  groups: { name: string; commands: (Omit<Command, 'mode'> & { mode?: CommandMode })[] }[];
}

/** Addresses one tile in an editable scope. */
export interface SlotRef {
  scope: 'workspace' | 'global' | 'repo';
  /** Required for repo scope: whose `.cc-control/commands.json`. */
  cwd?: string;
  /** Required for workspace scope. */
  workspaceId?: string;
  group: string;
  slot: number;
}

export type ClientMsg =
  | { type: 'session.create'; reqId: string; cwd: string; prompt?: string; extraDirs?: string[] }
  | { type: 'session.open'; id: string }
  | { type: 'session.send'; id: string; text: string; images?: ImageAttachment[] }
  /** Files in a session's repos matching what follows "@". Names only. */
  | { type: 'fs.files'; reqId: string; sessionId: string; query: string }
  | { type: 'session.interrupt'; id: string }
  | { type: 'session.stop'; id: string }
  /** Stop one subagent / background shell (a task id from the session's activity). */
  | { type: 'task.stop'; id: string; taskId: string }
  /** Send the running tool or subagent to the background, like Ctrl+B in the terminal. */
  | { type: 'session.background'; id: string }
  | { type: 'session.rename'; id: string; title: string }
  /** `answers` (question → chosen labels) answer a question card; `mode` switches mode as a plan is approved. */
  | { type: 'permission.respond'; reqId: string; decision: PermissionDecision; answers?: Record<string, string>; mode?: PermissionMode }
  /** Change how much Claude may do without asking (Shift+Tab). */
  | { type: 'session.mode'; id: string; mode: PermissionMode }
  /** Ask for the board of a session (its cwd's repo pack, global groups, its slash commands). */
  | { type: 'board.get'; sessionId: string }
  /** `from`: the tile this edit moves away from; it is removed only after the save succeeds. */
  | { type: 'command.save'; ref: SlotRef; command: Omit<Command, 'slot'>; from?: SlotRef }
  | { type: 'command.delete'; ref: SlotRef }
  /** Swap two slots in the same group (Ctrl+arrows). */
  | { type: 'command.swap'; ref: SlotRef; otherSlot: number }
  | { type: 'pack.import'; pack: CommandPack }
  | { type: 'pack.export'; reqId: string }
  | { type: 'settings.set'; settings: Settings }
  /** Save an opening prompt (§62); a new one has a fresh id. */
  | { type: 'prompt.save'; prompt: SavedPrompt }
  | { type: 'prompt.delete'; id: string }
  /** Have Claude write the opening message from rough text and the card's context (one cheap-model turn, no tools). */
  | { type: 'prompt.write'; reqId: string; text: string; context: PromptContext }
  /** Create (no matching id) or replace a workspace. */
  | { type: 'workspace.save'; workspace: Workspace; /** New workspaces: a WORKFLOW_TEMPLATES id to seed its workflows. */ template?: string }
  | { type: 'workspace.delete'; id: string }
  /** Add one repo to a workspace (drag and drop). */
  | { type: 'workspace.addRepo'; id: string; path: string }
  | { type: 'workspace.removeRepo'; id: string; path: string }
  /** Give a session another repo to work in. A live, idle session restarts in place to pick it up. */
  | { type: 'session.addDir'; id: string; path: string }
  | { type: 'session.removeDir'; id: string; path: string }
  /** The folders the repo library scans for git repos. */
  | { type: 'library.setSources'; sources: string[]; /** Answered with `ok` or an `error` carrying it. */ reqId?: string }
  | { type: 'library.scan' }
  /** Scan one folder for git repos without saving it anywhere: a source of repos for one card (§65). Answered with `library.peeked`, or an `error`. */
  | { type: 'library.peek'; reqId: string; path: string }
  /** Subfolders of `path`, for the folder picker; no path lists the starting points. Read-only. */
  | { type: 'fs.list'; reqId: string; path?: string }
  /** Open the machine's own folder dialog (Windows Explorer's) and answer with the folder chosen, or none. */
  | { type: 'fs.pickFolder'; reqId: string }
  | { type: 'workspace.export'; reqId: string; id: string }
  /** An untrusted WorkspaceFile; its repos are matched by name against the library. */
  | { type: 'workspace.import'; file: unknown }
  /** Ticket Line: save the card and start its session in a terminal tab. Answered with card.started or an error. */
  | { type: 'card.start'; reqId: string; draft: CardDraft }
  /** Take a card off the line (its terminal session keeps running). */
  | { type: 'card.delete'; id: string }
  /** Add context to a running card: it waits there until the next message in its tab. Answered with ok or an error. */
  | { type: 'card.addContext'; reqId: string; id: string; items: PacketItem[]; note: string }
  /** Take back something still waiting on a card. */
  | { type: 'card.withdraw'; id: string; itemId: string }
  /** Type into the card's terminal session through its channel. Answered with ok or an error. */
  | { type: 'card.send'; reqId: string; id: string; text: string }
  /** What the card changed in every repo it works in, each file with its patch (Shift+D). Answered with card.changes. */
  | { type: 'card.changes'; reqId: string; id: string }
  /** Bring the card's Windows Terminal tab to the front (g). Answered with ok or an error. */
  | { type: 'card.focusTab'; reqId: string; id: string }
  /** Answer the permission prompt the terminal relayed (card.live.ask.requestId). Answered with ok or an error. */
  | { type: 'card.answer'; reqId: string; id: string; requestId: string; behavior: 'allow' | 'deny' }
  /** Try it: run the card's recipe in its folder (again, if it ran before), or its workspace's stack with what was picked. Answered with ok or an error. */
  /** Try it. With a stack: `choice` starts a new session (every picked service); `service` starts (or starts again) one service of the session that is up (§82). */
  | { type: 'card.try'; reqId: string; id: string; choice?: StackChoice; service?: string }
  /** Try it with a stack: the picker's rows (which APIs the card has, which changed). Answered with stack.plan. */
  | { type: 'card.stackPlan'; reqId: string; id: string }
  /** Save a workspace's stack (checked on the server); null removes it. Answered with ok or an error. */
  | { type: 'stack.save'; reqId: string; workspaceId: string; stack: unknown }
  /** What the workspace's repos say the stack is (shared/stack-detect.ts): for the editor's starting point, and t with no stack yet. */
  | { type: 'stack.detect'; reqId: string; workspaceId: string }
  /** Stop the card's run and the app it started. */
  /** Stop the card's run; with a stack, every service and the session (its ports and proxy copy), or one `service` alone. */
  | { type: 'card.stopRun'; id: string; service?: string }
  /** Follow these runs' output (§84): the keys (runKey) this connection wants, replacing the last set; each new one is answered with run.log, then run.lines as it prints. */
  | { type: 'run.follow'; keys: string[] }
  /** Save the run recipe you wrote for a repo; no steps goes back to the detected one. Answered with ok or an error. */
  | { type: 'recipe.save'; reqId: string; repo?: string; workspaceId?: string; steps: string[]; url?: string }
  /** Ship: what shipping the card will do, one block per repo it changed (answered with ship.plan), do it (ok or an error), look at its PRs again, merge them. */
  | { type: 'card.shipPlan'; reqId: string; id: string }
  | { type: 'card.ship'; reqId: string; id: string; request: ShipRequest }
  | { type: 'card.prRefresh'; reqId: string; id: string }
  | { type: 'card.merge'; reqId: string; id: string }
  /** Tickets: show the demo set, map a project (Jira key / Trello board) to a workspace, fetch again. */
  | { type: 'tickets.demo'; on: boolean }
  | { type: 'tickets.map'; project: string; workspaceId: string | null }
  /** Hide a ticket from the Inbox (Delete on it), or show it again (Shift+T). Read-only towards the tracker. */
  | { type: 'tickets.hide'; key: string; hidden: boolean }
  | { type: 'tickets.refresh' }
  /** Writes to the tracker, each asked for on the page: a comment on a ticket (ok or an error), where it can move (tickets.transitions), moving it (ok or an error). */
  | { type: 'tickets.comment'; reqId: string; key: string; text: string }
  | { type: 'tickets.transitions'; reqId: string; key: string }
  | { type: 'tickets.transition'; reqId: string; key: string; id: string }
  /** Search the tracker for any ticket (not only yours): a key or words. Answered with tickets.found. Read-only. */
  | { type: 'tickets.search'; reqId: string; q: string }
  /** Find the pull request for a ticket in these repos (QA and review cards). Answered with pr.found. Read-only. */
  | { type: 'card.findPr'; reqId: string; key: string; repos: string[] }
  /** A QA or review card is finished with: it goes to Done. */
  | { type: 'card.done'; id: string }
  /** Tests only: a card that looks started, with no terminal tab or session. Refused on the default port. Answered with card.started. */
  | { type: 'cards.seed'; reqId: string; options: unknown }
  /** The card's worktrees as they are now (Shift+X). */
  | { type: 'card.worktrees'; reqId: string; id: string }
  /** Remove them (and their branch): only the clean ones unless `force`; `thenDelete` takes the card off the line after. */
  | { type: 'card.removeWorktrees'; reqId: string; id: string; force?: boolean; thenDelete?: boolean };

export type ServerMsg =
  /** Always the first message on a connection. */
  | { type: 'hello'; protocol: number }
  | { type: 'sessions'; sessions: SessionSummary[]; repos: string[] }
  | { type: 'session.upsert'; session: SessionSummary }
  | { type: 'session.created'; reqId: string; id: string }
  /** Sending to a session owned elsewhere forked it: the client should follow `newId`. */
  | { type: 'session.forked'; oldId: string; newId: string }
  | { type: 'session.transcript'; id: string; items: TranscriptItem[] }
  | { type: 'session.items'; id: string; items: TranscriptItem[] }
  /** Streaming text of the assistant message in progress; '' clears it. */
  | { type: 'session.partial'; id: string; text: string }
  | { type: 'session.activity'; id: string; activity: SessionActivity }
  /** A live session's to-do list changed. */
  | { type: 'session.todos'; id: string; todos: Todo[] }
  | { type: 'permission.request'; request: PermissionRequest }
  | { type: 'permission.resolved'; reqId: string }
  | { type: 'board'; sessionId: string; groups: CommandGroup[]; /** Its slash commands, for suggestions in the message box. */ slash?: SlashInfo[]; /** Models /model offers. */ models?: ModelChoice[] }
  /** Some commands changed: clients refetch the board of the open session. */
  | { type: 'commands.changed' }
  | { type: 'pack'; reqId: string; pack: CommandPack }
  | { type: 'settings'; settings: Settings }
  /** Every saved opening prompt, on connect and whenever one changes. */
  | { type: 'prompts'; prompts: SavedPrompt[] }
  | { type: 'workspaces'; workspaces: Workspace[] }
  /** `suggested`: likely source folders, from where past sessions ran, for the first-run setup. */
  | { type: 'library'; sources: string[]; repos: RepoInfo[]; suggested: string[] }
  /** The folder asked about with `library.peek`, made canonical, and the git repos directly inside it (none: not a folder of repos). */
  | { type: 'library.peeked'; reqId: string; source: string; repos: RepoInfo[] }
  | { type: 'workspace.file'; reqId: string; file: WorkspaceFile }
  | { type: 'fs.list'; reqId: string; listing: FolderListing }
  /** The folder picked in the machine's dialog; none when it was cancelled. */
  | { type: 'fs.picked'; reqId: string; path?: string }
  /** The opening message Claude wrote. */
  | { type: 'prompt.written'; reqId: string; text: string }
  | { type: 'fs.files'; reqId: string; hits: FileHit[] }
  /** A request with a `reqId` and nothing else to return worked. */
  | { type: 'ok'; reqId: string; /** card.focusTab: the tab was gone, so a new one was opened on the session (§85). */ note?: 'reopened' }
  /** Something worth a line in the status area, e.g. what an import could not match. */
  | { type: 'info'; message: string }
  | { type: 'error'; message: string; reqId?: string }
  /** Every card on the Ticket Line, on connect and whenever one changes. */
  | { type: 'ship.plan'; reqId: string; plan: ShipPlan }
  | { type: 'card.changes'; reqId: string; changes: Changes }
  | { type: 'card.worktrees'; reqId: string; id: string; worktrees: CardWorktree[] }
  | { type: 'card.worktreesRemoved'; reqId: string; id: string; removed: CardWorktree[]; kept: CardWorktree[] }
  /** The picker's rows for a card's stack, and the APIs to tick when nothing was picked before. */
  | { type: 'stack.plan'; reqId: string; rows: StackApiRow[]; suggested: string[] }
  /** `kubeconfigs`: the KUBECONFIG_* names set in the server's environment (config.env), names only, for the setup sheet. */
  | { type: 'stack.detected'; reqId: string; workspaceId: string; stack?: Stack; findings: Finding[]; kubeconfigs?: string[] }
  /** Run recipes by repo path: the library's, the workspaces' and the cards' repos. */
  | { type: 'recipes'; recipes: Record<string, RunRecipe>; /** Workspaces' own recipes, by workspace id. */ workspaceRecipes?: Record<string, RunRecipe> }
  /** Cards' runs of their recipes (Try it). */
  | { type: 'runs'; runs: CardRun[] }
  /** A followed run's output so far (the whole log: on follow, and again when the run starts afresh), then the lines since. */
  | { type: 'run.log'; key: string; lines: LogLine[] }
  | { type: 'run.lines'; key: string; lines: LogLine[] }
  | { type: 'cards'; cards: Card[]; /** What the next card will be called, for the preview. */ nextKey: string; /** The model card sessions start with, when the server pins one. */ model?: string; /** The model in the user's Claude Code settings (a card's default otherwise). */ userModel?: string }
  | { type: 'card.started'; reqId: string; id: string }
  | { type: 'tickets'; tickets: Ticket[]; projects: TicketProject[]; sources: TicketSources }
  /** What a search found, or why it couldn't search. */
  | { type: 'tickets.found'; reqId: string; q: string; tickets: Ticket[]; problem?: string }
  /** The ticket's pull request, or why none was found (a line per repo). */
  | { type: 'pr.found'; reqId: string; pr?: PrTarget; notes: string[] }
  | { type: 'tickets.transitions'; reqId: string; key: string; transitions: TicketTransition[] };
