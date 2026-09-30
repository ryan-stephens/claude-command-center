// Sessions per workspace, bucketed by what they need from you, with plain status words: the
// session view and the palette use them. Pure (tested in home-model.test.ts).

import type { SessionSummary, Workspace } from '../shared/protocol.ts';
import { workspacesFor } from '../shared/workspaces.ts';

export type Bucket = 'needs' | 'working' | 'done' | 'earlier';
export const BUCKET_TITLE: Record<Bucket, string> = { needs: 'Needs you', working: 'Working', done: 'Done', earlier: 'Earlier' };

export type Tone = 'amber' | 'blue' | 'green' | 'violet' | 'grey';

export interface Flags {
  /** An approval card is waiting. */
  pending: boolean;
  /** Finished a turn while you weren't looking. */
  unread: boolean;
}

export function bucketOf(s: SessionSummary, f: Flags): Bucket {
  if (f.pending || f.unread || s.status === 'requires_action') return 'needs';
  if (s.live && (s.status === 'running' || s.background)) return 'working';
  if (s.live && s.status !== 'stopped') return 'done';
  return 'earlier';
}

export function statusLabel(s: SessionSummary, f: Flags): { text: string; tone: Tone } {
  if (f.pending || s.status === 'requires_action') return { text: 'Waiting for your OK', tone: 'amber' };
  if (f.unread) return { text: 'Finished · your turn', tone: 'amber' };
  if (s.live) {
    if (s.status === 'running') return { text: 'Working on it', tone: 'blue' };
    if (s.status === 'stopped') return { text: 'Stopped', tone: 'grey' };
    if (s.background) return { text: `Done · ${s.background} still running`, tone: 'violet' };
    return { text: 'Done', tone: 'green' };
  }
  if (s.activeElsewhere) return { text: 'Open in a terminal', tone: 'violet' };
  return { text: '', tone: 'grey' };
}

/** The sessions in one workspace (by folder), or every session for 'all'. */
export function sessionsIn(filter: 'all' | string, sessions: SessionSummary[], workspaces: Workspace[]): SessionSummary[] {
  if (filter === 'all') return sessions;
  const w = workspaces.find((x) => x.id === filter);
  return w ? sessions.filter((s) => workspacesFor(s.cwd, [w]).length > 0) : [];
}

/**
 * Sessions in display order, grouped. "Needs you" follows `attentionOrder` (the order Alt+N
 * serves them); the rest keep the incoming order (most recent first).
 */
export function groupSessions(
  list: SessionSummary[],
  flags: (s: SessionSummary) => Flags,
  attentionOrder: string[] = [],
): { bucket: Bucket; sessions: SessionSummary[] }[] {
  const by: Record<Bucket, SessionSummary[]> = { needs: [], working: [], done: [], earlier: [] };
  for (const s of list) by[bucketOf(s, flags(s))].push(s);
  const rank = new Map(attentionOrder.map((id, i) => [id, i]));
  by.needs.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  return (['needs', 'working', 'done', 'earlier'] as Bucket[]).filter((b) => by[b].length).map((bucket) => ({ bucket, sessions: by[bucket] }));
}

/** Short age for rows: "now", "4m", "3h", "2d", "5w". */
export function age(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)}d`;
  return `${Math.round(s / (86400 * 7))}w`;
}
