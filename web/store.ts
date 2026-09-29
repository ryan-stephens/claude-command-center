import { create } from 'zustand';
import type { Command, CommandGroup, PermissionRequest, SessionSummary, TranscriptItem } from '../shared/protocol.ts';

export type Tab = 'inbox' | 'live' | 'history';
export const TABS: Tab[] = ['inbox', 'live', 'history'];
/** Where keys go inside the session view. Esc steps outward: composer → board → list. */
export type SessionZone = 'composer' | 'board';
export type Modal =
  | { kind: 'new' }
  | { kind: 'help' }
  | { kind: 'rename'; id: string }
  | { kind: 'stop'; id: string }
  | { kind: 'template'; sessionId: string; command: Command }
  | { kind: 'edit'; group: CommandGroup | null; slot: number }
  | { kind: 'delete'; group: CommandGroup; slot: number }
  | null;

interface State {
  connected: boolean;
  sessions: SessionSummary[];
  repos: string[];
  transcripts: Record<string, TranscriptItem[]>;
  partials: Record<string, string>;
  permissions: Record<string, PermissionRequest>;
  /** Sessions that finished a turn while you weren't looking, with the time it happened. */
  unread: Record<string, number>;
  lastError: string | null;
  /** Short-lived status line message, e.g. "Nothing needs you". */
  flash: string | null;
  sound: boolean;

  screen: 'list' | 'session';
  tab: Tab;
  filter: string;
  filterFocused: boolean;
  selectedId: string | null;
  openId: string | null;
  zone: SessionZone;
  expandTools: boolean;
  modal: Modal;

  /** Command board of the open session. */
  board: { sessionId: string; groups: CommandGroup[] } | null;
  /** `${scope}:${name}` of the selected group, so it survives board refreshes. */
  groupKey: string | null;
  /** Focused tile (1–9) while the board zone has focus. */
  boardSlot: number;
  /** Unsent composer text per session. The numpad fires commands only while this is empty. */
  drafts: Record<string, string>;
}

export const useStore = create<State>(() => ({
  connected: false,
  sessions: [],
  repos: [],
  transcripts: {},
  partials: {},
  permissions: {},
  unread: {},
  lastError: null,
  flash: null,
  sound: loadSound(),

  screen: 'list',
  tab: 'history',
  filter: '',
  filterFocused: false,
  selectedId: null,
  openId: null,
  zone: 'composer',
  expandTools: false,
  modal: null,

  board: null,
  groupKey: null,
  boardSlot: 5,
  drafts: {},
}));

export const set = useStore.setState;
export const get = useStore.getState;

type ListState = Pick<State, 'sessions' | 'tab' | 'filter' | 'permissions' | 'unread'>;

/**
 * Sessions that need you, in the order Alt+N serves them: pending approvals
 * (oldest first), then sessions that finished unseen (oldest first).
 */
export function attention(s: Pick<State, 'sessions' | 'permissions' | 'unread'>): SessionSummary[] {
  const byId = new Map(s.sessions.map((x) => [x.id, x]));
  const ids = [
    ...Object.values(s.permissions).sort((a, b) => a.createdAt - b.createdAt).map((p) => p.sessionId),
    ...Object.entries(s.unread).sort((a, b) => a[1] - b[1]).map(([id]) => id),
  ];
  return [...new Set(ids)].map((id) => byId.get(id)).filter((x): x is SessionSummary => Boolean(x));
}

/** Sessions shown in the list for the current tab and filter, in display order. */
export function visibleSessions(s: ListState): SessionSummary[] {
  const needle = s.filter.trim().toLowerCase();
  const base = s.tab === 'inbox' ? attention(s) : s.tab === 'live' ? s.sessions.filter((x) => x.live) : s.sessions;
  if (!needle) return base;
  return base.filter((x) => `${x.title} ${x.cwd} ${x.branch ?? ''} ${x.status ?? ''}`.toLowerCase().includes(needle));
}

export function sessionById(id: string | null): SessionSummary | undefined {
  return id ? get().sessions.find((s) => s.id === id) : undefined;
}

export function pendingFor(sessionId: string | null): PermissionRequest | undefined {
  if (!sessionId) return undefined;
  return Object.values(get().permissions).find((p) => p.sessionId === sessionId);
}

export function markRead(id: string): void {
  const { unread } = get();
  if (!(id in unread)) return;
  const { [id]: _, ...rest } = unread;
  set({ unread: rest });
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;
export function flash(message: string): void {
  set({ flash: message });
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => set({ flash: null }), 2500);
}

// Sound preference is a per-browser convenience, so localStorage is enough (and may be unavailable).
function loadSound(): boolean {
  try { return localStorage.getItem('cc-control.sound') !== 'off'; } catch { return true; }
}
export function toggleSound(): void {
  const sound = !get().sound;
  set({ sound });
  try { localStorage.setItem('cc-control.sound', sound ? 'on' : 'off'); } catch { /* ignore */ }
  flash(sound ? 'Sound on' : 'Sound off');
}

export const groupKeyOf = (g: CommandGroup): string => `${g.scope}:${g.name}`;

/**
 * The board group currently shown, falling back to the first for display. `exact` is false when
 * the selected group isn't on the board (yet), and firing must not happen then.
 */
export function currentGroup(s: Pick<State, 'board' | 'groupKey'>): { group: CommandGroup | null; index: number; exact: boolean } {
  const groups = s.board?.groups ?? [];
  const i = groups.findIndex((g) => groupKeyOf(g) === s.groupKey);
  const index = i < 0 ? 0 : i;
  return { group: groups[index] ?? null, index, exact: i >= 0 || s.groupKey === null };
}

export function setDraft(id: string, text: string): void {
  set({ drafts: { ...get().drafts, [id]: text } });
}
