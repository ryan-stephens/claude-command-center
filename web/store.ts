import { create } from 'zustand';
import type { PermissionRequest, SessionSummary, TranscriptItem } from '../shared/protocol.ts';

export type Tab = 'live' | 'history';
/** Where keys go inside the session view. Esc steps outward: composer → transcript → list. */
export type SessionZone = 'composer' | 'transcript';
export type Modal =
  | { kind: 'new' }
  | { kind: 'help' }
  | { kind: 'rename'; id: string }
  | { kind: 'stop'; id: string }
  | null;

interface State {
  connected: boolean;
  sessions: SessionSummary[];
  repos: string[];
  transcripts: Record<string, TranscriptItem[]>;
  partials: Record<string, string>;
  permissions: Record<string, PermissionRequest>;
  lastError: string | null;

  screen: 'list' | 'session';
  tab: Tab;
  filter: string;
  filterFocused: boolean;
  selectedId: string | null;
  openId: string | null;
  zone: SessionZone;
  expandTools: boolean;
  modal: Modal;
}

export const useStore = create<State>(() => ({
  connected: false,
  sessions: [],
  repos: [],
  transcripts: {},
  partials: {},
  permissions: {},
  lastError: null,

  screen: 'list',
  tab: 'history',
  filter: '',
  filterFocused: false,
  selectedId: null,
  openId: null,
  zone: 'composer',
  expandTools: false,
  modal: null,
}));

export const set = useStore.setState;
export const get = useStore.getState;

/** Sessions shown in the list for the current tab and filter, in display order. */
export function visibleSessions(s: Pick<State, 'sessions' | 'tab' | 'filter'>): SessionSummary[] {
  const needle = s.filter.trim().toLowerCase();
  return s.sessions.filter((x) => {
    if (s.tab === 'live' && !x.live) return false;
    if (!needle) return true;
    return `${x.title} ${x.cwd} ${x.branch ?? ''} ${x.status ?? ''}`.toLowerCase().includes(needle);
  });
}

export function sessionById(id: string | null): SessionSummary | undefined {
  return id ? get().sessions.find((s) => s.id === id) : undefined;
}

export function pendingFor(sessionId: string | null): PermissionRequest | undefined {
  if (!sessionId) return undefined;
  return Object.values(get().permissions).find((p) => p.sessionId === sessionId);
}

export function needsYou(s: SessionSummary): boolean {
  return s.status === 'requires_action';
}
