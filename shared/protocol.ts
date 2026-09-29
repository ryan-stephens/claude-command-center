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
}

export type TranscriptItem =
  | { kind: 'user'; uuid: string; text: string }
  | { kind: 'assistant'; uuid: string; text: string }
  | { kind: 'tool'; uuid: string; toolUseId: string; name: string; input: string }
  | { kind: 'tool_result'; uuid: string; toolUseId: string; text: string; isError: boolean }
  | { kind: 'result'; uuid: string; subtype: string; durationMs?: number; costUsd?: number }
  | { kind: 'notice'; uuid: string; text: string };

export interface PermissionRequest {
  reqId: string;
  sessionId: string;
  tool: string;
  /** Human-readable summary of the tool input. */
  input: string;
  /** Whether an "Always allow" rule is on offer. */
  canAlways: boolean;
}

export type PermissionDecision = 'allow' | 'always' | 'deny';

export type ClientMsg =
  | { type: 'session.create'; reqId: string; cwd: string; prompt?: string }
  | { type: 'session.open'; id: string }
  | { type: 'session.send'; id: string; text: string }
  | { type: 'session.interrupt'; id: string }
  | { type: 'session.stop'; id: string }
  | { type: 'session.rename'; id: string; title: string }
  | { type: 'permission.respond'; reqId: string; decision: PermissionDecision };

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
  | { type: 'permission.request'; request: PermissionRequest }
  | { type: 'permission.resolved'; reqId: string }
  | { type: 'error'; message: string; reqId?: string };
