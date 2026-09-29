import { create } from 'zustand';
import type { Command, CommandGroup, PermissionRequest, RepoInfo, SessionActivity, SessionSummary, Settings, TranscriptItem, Workspace } from '../shared/protocol.ts';
import { groupSessions, sessionsIn, type Flags, type Scope } from './home-model.ts';
import { applyTheme, loadTheme, type ThemePref } from './theme.ts';

/** Home is three columns you walk with ← →, plus the repo library (Tab). */
export type HomeCol = 'workspaces' | 'sessions' | 'preview' | 'library';
export const HOME_COLS: HomeCol[] = ['workspaces', 'sessions', 'preview'];
/** Where keys go inside the session view. Esc steps outward: composer → number pad → home. */
export type SessionZone = 'composer' | 'board';
/** Where a repo picked from the library goes. */
export type RepoTarget = { kind: 'session'; id: string } | { kind: 'workspace'; id: string };

export type Modal =
  | { kind: 'new'; workspaceId: string | null; repo?: string }
  | { kind: 'help' }
  | { kind: 'rename'; id: string }
  | { kind: 'stop'; id: string }
  | { kind: 'template'; sessionId: string; command: Command }
  | { kind: 'edit'; group: CommandGroup | null; slot: number }
  | { kind: 'delete'; group: CommandGroup; slot: number }
  | { kind: 'voiceMatch'; sessionId: string; text: string; command: Command }
  | { kind: 'palette' }
  | { kind: 'bindings' }
  | { kind: 'welcome' }
  | { kind: 'workspace'; id: string | null }
  | { kind: 'deleteWorkspace'; id: string }
  | { kind: 'repoPicker'; target: RepoTarget }
  /** Take a repo out of a workspace, or out of a session (the ones added to it). */
  | { kind: 'repoRemove'; target: RepoTarget }
  | { kind: 'sources' }
  | null;

export interface Library {
  sources: string[];
  repos: RepoInfo[];
  suggested: string[];
}

interface State {
  connected: boolean;
  sessions: SessionSummary[];
  repos: string[];
  workspaces: Workspace[];
  /** False until the server has sent them once (so first-run setup doesn't flash). */
  workspacesLoaded: boolean;
  library: Library;
  transcripts: Record<string, TranscriptItem[]>;
  partials: Record<string, string>;
  /** Live sessions: what each is doing right now (phase, tool, background tasks). */
  activity: Record<string, SessionActivity>;
  permissions: Record<string, PermissionRequest>;
  /** Sessions that finished a turn while you weren't looking, with the time it happened. */
  unread: Record<string, number>;
  lastError: string | null;
  /** The server predates this page ('server': restart it) or the page predates the server ('page': reload). */
  outdated: 'server' | 'page' | null;
  /** Short-lived status line message, e.g. "Nothing needs you". */
  flash: string | null;
  sound: boolean;
  theme: ThemePref;

  screen: 'list' | 'session';
  /** The workspace column's selection. */
  scope: Scope;
  homeCol: HomeCol;
  /** Selected repo in the library row. */
  libIndex: number;
  filter: string;
  filterFocused: boolean;
  selectedId: string | null;
  openId: string | null;
  zone: SessionZone;
  expandTools: boolean;
  modal: Modal;

  /** Command board of the open session. */
  board: { sessionId: string; groups: CommandGroup[] } | null;
  /** groupKeyOf() of the selected group, so it survives board refreshes. */
  groupKey: string | null;
  /** Focused key (1–9) while the number pad has focus. */
  boardSlot: number;
  /** Unsent composer text per session. The numpad fires commands only while this is empty. */
  drafts: Record<string, string>;
  /** Push-to-talk in progress: the live transcript, shown in the composer. */
  voice: { sessionId: string; state: 'listening' | 'finishing'; text: string } | null;
  settings: Settings;
  /** Phones: number pad panel shown under the composer. */
  mobileBoard: boolean;
  /** A repo card is being dragged: drop targets light up. */
  dragging: string | null;
}

const theme = loadTheme();
applyTheme(theme);

export const useStore = create<State>(() => ({
  connected: false,
  sessions: [],
  repos: [],
  workspaces: [],
  workspacesLoaded: false,
  library: { sources: [], repos: [], suggested: [] },
  transcripts: {},
  partials: {},
  activity: {},
  permissions: {},
  unread: {},
  lastError: null,
  outdated: null,
  flash: null,
  sound: loadSound(),
  theme,

  screen: 'list',
  scope: loadScope(),
  homeCol: 'sessions',
  libIndex: 0,
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
  voice: null,
  settings: {},
  mobileBoard: false,
  dragging: null,
}));

export const set = useStore.setState;
export const get = useStore.getState;

type AttentionState = Pick<State, 'sessions' | 'permissions' | 'unread'>;

/**
 * Sessions that need you, in the order Alt+N serves them: pending approvals
 * (oldest first), then sessions that finished unseen (oldest first).
 */
export function attention(s: AttentionState): SessionSummary[] {
  const byId = new Map(s.sessions.map((x) => [x.id, x]));
  const ids = [
    ...Object.values(s.permissions).sort((a, b) => a.createdAt - b.createdAt).map((p) => p.sessionId),
    ...Object.entries(s.unread).sort((a, b) => a[1] - b[1]).map(([id]) => id),
  ];
  return [...new Set(ids)].map((id) => byId.get(id)).filter((x): x is SessionSummary => Boolean(x));
}

export function flagsFor(s: Pick<State, 'permissions' | 'unread'>, id: string): Flags {
  return { pending: Object.values(s.permissions).some((p) => p.sessionId === id), unread: id in s.unread };
}

/** A session's flags as a hook. Selects the two booleans separately: a fresh object per call would re-render forever. */
export function useFlags(id: string | null): Flags {
  const pending = useStore((s) => Boolean(id) && Object.values(s.permissions).some((p) => p.sessionId === id));
  const unread = useStore((s) => Boolean(id) && id! in s.unread);
  return { pending, unread };
}

type ListState = Pick<State, 'sessions' | 'workspaces' | 'scope' | 'filter' | 'permissions' | 'unread'>;

/** The sessions column: the scope's sessions, filtered, grouped (needs you → working → done → earlier). */
export function sessionGroups(s: ListState) {
  const needle = s.filter.trim().toLowerCase();
  let list = sessionsIn(s.scope, s.sessions, s.workspaces);
  if (needle) list = list.filter((x) => `${x.title} ${x.cwd} ${x.branch ?? ''}`.toLowerCase().includes(needle));
  return groupSessions(list, (x) => flagsFor(s, x.id), attention(s).map((x) => x.id));
}

/** The sessions column in display order: what ↑ ↓ walk through. */
export function visibleSessions(s: ListState): SessionSummary[] {
  return sessionGroups(s).flatMap((g) => g.sessions);
}

/** The workspace column's entries in key order: workspaces 1–9…, then "everything else" (0). */
export function scopes(s: Pick<State, 'workspaces'>): Scope[] {
  return [...s.workspaces.map((w): Scope => ({ kind: 'workspace', id: w.id })), { kind: 'rest' }];
}

export function sameScope(a: Scope, b: Scope): boolean {
  return a.kind === b.kind && (a.kind === 'rest' || a.id === (b as { id: string }).id);
}

export function currentWorkspace(s: Pick<State, 'workspaces' | 'scope'>): Workspace | null {
  const scope = s.scope;
  return scope.kind === 'workspace' ? s.workspaces.find((w) => w.id === scope.id) ?? null : null;
}

export function setScope(scope: Scope): void {
  set({ scope, filter: '' });
  try { localStorage.setItem('cc-control.scope', JSON.stringify(scope)); } catch { /* ignore */ }
}

function loadScope(): Scope {
  try {
    const v = JSON.parse(localStorage.getItem('cc-control.scope') ?? 'null') as Scope | null;
    if (v?.kind === 'workspace' && typeof v.id === 'string') return v;
  } catch { /* default */ }
  return { kind: 'rest' };
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

export const groupKeyOf = (g: CommandGroup): string => `${g.scope}:${g.workspaceId ?? ''}:${g.name}`;

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

/** Stable empty values for selectors (a fresh {} or [] per call would re-render forever). */
export const NO_BINDINGS: Record<string, string[]> = {};
