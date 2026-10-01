import { create } from 'zustand';
import type { Card } from '../shared/cards.ts';
import type { CardRun, RunRecipe } from '../shared/recipes.ts';
import type { InboxView, Ticket, TicketProject, TicketSources } from '../shared/tickets.ts';
import type { Command, CommandGroup, ModelChoice, PermissionRequest, RepoInfo, SessionActivity, SessionSummary, Settings, SlashInfo, Todo, TranscriptItem, Workspace } from '../shared/protocol.ts';
import { loadFolds, saveFolds, toggled, type FoldKey, type Folds } from './folds.ts';
import type { QaState } from './questions.ts';
import type { Flags } from './home-model.ts';
import { applyTheme, loadTheme, type ThemePref } from './theme.ts';
import type { Composer, LineFilter } from './line-model.ts';

/** Where keys go inside the session view. Esc steps outward: composer → number pad → the line. */
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
  /** Take a card off the Ticket Line. */
  | { kind: 'deleteCard'; id: string }
  /** Write or edit a repo's run recipe (e in a card's drawer). */
  | { kind: 'recipe'; repo: string; workspaceId?: string }
  /** t on a card whose workspace has a stack: pick dev / uat and the APIs to run. */
  | { kind: 'tryPick'; id: string }
  /** Ship a card (s), or merge its PR once it has one. */
  | { kind: 'ship'; id: string }
  /** A QA or review card's report (s): copy it, or finish the card. */
  | { kind: 'report'; id: string }
  /** D on a card: what it changed, file by file, with the diffs. */
  | { kind: 'changes'; id: string }
  /** The new-card screen's Folders tab: pick any folder on disk to add as context. */
  | { kind: 'addFolder' }
  /** Where tickets come from, and which workspace each project goes to. */
  | { kind: 'tickets' }
  /** "All" is showing: which workspace a workspace key (+ − E ⇧E ⇧Delete) is for. */
  | { kind: 'pickWorkspace'; then: WorkspaceAction }
  | null;

/** What the workspace keys on the line do, once it is clear which workspace. */
export type WorkspaceAction = 'addRepo' | 'removeRepo' | 'edit' | 'share' | 'delete';

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

  /** The Ticket Line (a board of cards, the home page), or a session full screen. */
  screen: 'line' | 'session';
  /** Ticket Line cards, what the next one will be called, the model the server pins for them, and the one in the user's Claude Code settings. */
  cards: Card[];
  nextKey: string;
  cardModel: string | null;
  userModel: string | null;
  /** Tickets from Jira and Trello (and the demo set), the projects they come from, and how each source is doing. */
  tickets: Ticket[];
  /** Run recipes by repo path, and cards' runs of them (Try it). */
  recipes: Record<string, RunRecipe>;
  runs: Record<string, CardRun>;
  ticketProjects: TicketProject[];
  ticketSources: TicketSources | null;
  /**
   * The board: the focused card, the card open in the drawer and its tab, the workspace shown, and
   * the text filter (/).
   */
  line: { focus: string | null; drawer: string | null; tab: 'over' | 'ctx' | 'tx'; filter: LineFilter; q: string; searching: boolean; /** The Inbox's view (v): yours, or ready for QA. */ view: InboxView };
  /** What the tracker's search found for the new-card screen's search box (other people's tickets too). */
  found: Found;
  /** The new-card screen, while it is open. */
  composer: Composer | null;
  openId: string | null;
  zone: SessionZone;
  expandTools: boolean;
  modal: Modal;

  /** Command board of the open session. */
  board: { sessionId: string; groups: CommandGroup[] } | null;
  /** Slash commands of the open session, for suggestions as you type "/". */
  slash: { sessionId: string; commands: SlashInfo[]; models: ModelChoice[] } | null;
  /** Arrow-key choice on a tool or plan card: which answer is highlighted. */
  approvalPick: { reqId: string; index: number } | null;
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
  /** Collapsible sections the viewer folded away (remembered per browser). */
  folds: Folds;
  /** Answers in progress on a question card from Claude. */
  qa: QaState | null;
  /** Live sessions' to-do lists. */
  todos: Record<string, Todo[]>;
}

const theme = loadTheme();
applyTheme(theme);

/** The search box's results: for which text, what came back, whether it is still asking, and why it couldn't. */
export interface Found { q: string; tickets: Ticket[]; looking: boolean; problem?: string }
/** Stable, so a selector returning it doesn't re-render forever. */
export const NO_FOUND: Found = { q: '', tickets: [], looking: false };

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

  screen: 'line',
  cards: [],
  nextKey: 'CARD-1',
  cardModel: null,
  userModel: null,
  tickets: [],
  recipes: {},
  runs: {},
  ticketProjects: [],
  ticketSources: null,
  line: { focus: null, drawer: null, tab: 'over', filter: loadFilter(), q: '', searching: false, view: loadView() },
  found: NO_FOUND,
  composer: null,
  openId: null,
  zone: 'composer',
  expandTools: false,
  modal: null,

  board: null,
  slash: null,
  approvalPick: null,
  groupKey: null,
  boardSlot: 5,
  drafts: {},
  voice: null,
  settings: {},
  mobileBoard: false,
  folds: loadFolds(),
  qa: null,
  todos: {},
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

/** Fold or unfold a section: the number pad, Claude's to-do list. */
export function toggleFold(key: FoldKey): void {
  const folds = toggled(get().folds, key);
  set({ folds });
  saveFolds(folds);
}

/** The workspace the line is showing, or null for All. */
export function currentWorkspace(s: Pick<State, 'workspaces' | 'line'>): Workspace | null {
  const f = s.line.filter;
  return f === 'all' ? null : s.workspaces.find((w) => w.id === f) ?? null;
}

/** Show one workspace on the line (remembered per browser), or all of them. */
export function setFilter(filter: LineFilter): void {
  set({ line: { ...get().line, filter } });
  try { localStorage.setItem('cc-control.lineFilter', filter); } catch { /* ignore */ }
}

function loadFilter(): LineFilter {
  try { return localStorage.getItem('cc-control.lineFilter') || 'all'; } catch { return 'all'; }
}

/** v on the board: the Inbox shows your tickets or the ones ready for QA; remembered per browser. */
export function setInboxView(view: InboxView): void {
  set({ line: { ...get().line, view } });
  try { localStorage.setItem('cc-control.inboxView', view); } catch { /* ignore */ }
}

function loadView(): InboxView {
  try { return localStorage.getItem('cc-control.inboxView') === 'qa' ? 'qa' : 'mine'; } catch { return 'mine'; }
}

/** The session that takes the session keys: the one open full screen. */
export function activeSession(s: Pick<State, 'screen' | 'openId'>): string | null {
  return s.screen === 'session' ? s.openId : null;
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
