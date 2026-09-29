// WebSocket protocol shared by server and web. Plain types only (erasable TS, runs under Node type stripping).

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
}

export type TranscriptItem =
  | { kind: 'user'; uuid: string; text: string }
  | { kind: 'assistant'; uuid: string; text: string }
  | { kind: 'tool'; uuid: string; toolUseId: string; name: string; input: string }
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
  tool?: { name: string; detail?: string };
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
/** global: SQLite · repo: <cwd>/.cc-control/commands.json · auto: the session's slash commands (read-only) */
export type CommandScope = 'global' | 'repo' | 'auto';

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
}

/** Shareable JSON: the format of repo packs and of import/export. */
export interface CommandPack {
  version: 1;
  groups: { name: string; commands: (Omit<Command, 'mode'> & { mode?: CommandMode })[] }[];
}

/** Addresses one tile in an editable scope. */
export interface SlotRef {
  scope: 'global' | 'repo';
  /** Required for repo scope: whose `.cc-control/commands.json`. */
  cwd?: string;
  group: string;
  slot: number;
}

export type ClientMsg =
  | { type: 'session.create'; reqId: string; cwd: string; prompt?: string }
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
  | { type: 'settings.set'; settings: Settings };

export type ServerMsg =
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
  | { type: 'error'; message: string; reqId?: string };
