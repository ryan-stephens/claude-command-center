// WebSocket protocol shared by server and web. Plain types only (erasable TS, runs under Node type stripping).

/**
 * Bump when the client starts relying on a message an older server doesn't handle. The server
 * says `hello` first; a page that hears anything else first is talking to a server from before
 * this existed, which drops newer messages without a word, so the page says to restart it.
 */
export const PROTOCOL = 2;

export type SessionStatus = 'idle' | 'running' | 'requires_action' | 'stopped';

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
}

/** A workspace as a file to share: repos by folder name, since paths differ between machines. */
export interface WorkspaceFile {
  kind: 'cc-control.workspace';
  version: 1;
  name: string;
  color: string;
  repos: { name: string; home?: boolean }[];
  workflows: CommandPack;
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
  /** Epoch ms; the inbox and Alt+N serve the oldest first. */
  createdAt: number;
}

export type PermissionDecision = 'allow' | 'always' | 'deny';

/** Per-install preferences, stored in SQLite and shared by every browser. */
export interface Settings {
  /** Key binding overrides: action id → combos (see web/bindings.ts). */
  bindings?: Record<string, string[]>;
}

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
  | { type: 'session.send'; id: string; text: string }
  | { type: 'session.interrupt'; id: string }
  | { type: 'session.stop'; id: string }
  /** Stop one subagent / background shell (a task id from the session's activity). */
  | { type: 'task.stop'; id: string; taskId: string }
  /** Send the running tool or subagent to the background, like Ctrl+B in the terminal. */
  | { type: 'session.background'; id: string }
  | { type: 'session.rename'; id: string; title: string }
  | { type: 'permission.respond'; reqId: string; decision: PermissionDecision }
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
  /** Subfolders of `path`, for the folder picker; no path lists the starting points. Read-only. */
  | { type: 'fs.list'; reqId: string; path?: string }
  | { type: 'workspace.export'; reqId: string; id: string }
  /** An untrusted WorkspaceFile; its repos are matched by name against the library. */
  | { type: 'workspace.import'; file: unknown };

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
  | { type: 'permission.request'; request: PermissionRequest }
  | { type: 'permission.resolved'; reqId: string }
  | { type: 'board'; sessionId: string; groups: CommandGroup[] }
  /** Some commands changed: clients refetch the board of the open session. */
  | { type: 'commands.changed' }
  | { type: 'pack'; reqId: string; pack: CommandPack }
  | { type: 'settings'; settings: Settings }
  | { type: 'workspaces'; workspaces: Workspace[] }
  /** `suggested`: likely source folders, from where past sessions ran, for the first-run setup. */
  | { type: 'library'; sources: string[]; repos: RepoInfo[]; suggested: string[] }
  | { type: 'workspace.file'; reqId: string; file: WorkspaceFile }
  | { type: 'fs.list'; reqId: string; listing: FolderListing }
  /** A request with a `reqId` and nothing else to return worked. */
  | { type: 'ok'; reqId: string }
  /** Something worth a line in the status area, e.g. what an import could not match. */
  | { type: 'info'; message: string }
  | { type: 'error'; message: string; reqId?: string };
