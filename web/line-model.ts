// The Ticket Line's pure logic: which card sits where on the board, how arrows move between them,
// and the new-card screen's state (its three panels and what each key does to them).
// Tested in line-model.test.ts; the components only draw it.

import {
  branchFor, CARD_KINDS, CARD_MODELS, cardRepos, defaultMessage, homeOf, includedRepos, kindDefaults, kindForTicket, LAUNCH_MODES, modelName, STAGES, TESTING_NOTES, WORKSPACE_NOTES,
  type BranchChoice, type Card, type CardDraft, type CardKind, type Packet, type PacketItem, type PrTarget, type Stage,
} from '../shared/cards.ts';
import type { RepoInfo, Workspace } from '../shared/protocol.ts';
import { recipeFor, recipeLabel, recipeText, wsRecipeKey, type RunRecipe } from '../shared/recipes.ts';
import { relatedItem, ticketItems, ticketSub, type Ticket } from '../shared/tickets.ts';
import { homeRepo, repoName, samePath } from '../shared/workspaces.ts';

/** Which workspace's cards the board shows. */
export type LineFilter = 'all' | string;

/** Does the / filter's text match? Every word must appear somewhere in `hay`. */
export function matches(q: string, hay: string): boolean {
  const h = hay.toLowerCase();
  return q.trim().toLowerCase().split(/\s+/).every((w) => !w || h.includes(w));
}

/** A column of the board: its cards, and for the Inbox, the tickets no card has started yet. */
export interface Lane { stage: Stage; name: string; cards: Card[]; tickets: Ticket[] }

export function lanes(cards: Card[], filter: LineFilter, q = '', inbox: Ticket[] = []): Lane[] {
  return STAGES.map((s) => ({
    stage: s.id,
    name: s.name,
    cards: cards.filter((c) => c.stage === s.id && (filter === 'all' || c.workspaceId === filter) && matches(q, `${c.key} ${c.title} ${c.branchName ?? ''}`)),
    tickets: s.id === 'inbox' ? inbox.filter((t) => matches(q, `${t.key} ${t.title}`)) : [],
  }));
}

/** A ticket in the Inbox has the board's focus as "t:SHOP-155". */
export const ticketFocus = (key: string) => `t:${key}`;
export const focusedTicket = (focus: string | null) => (focus?.startsWith('t:') ? focus.slice(2) : null);

/** What arrows walk in a column: its tickets, then its cards. */
const laneIds = (l: { cards: { id: string }[]; tickets?: { key: string }[] }) => [...(l.tickets ?? []).map((t) => ticketFocus(t.key)), ...l.cards.map((c) => c.id)];

/** The cards' sessions, column by column: what Alt+↑ ↓ walk. */
export function lineSessions(cols: { cards: Card[] }[]): string[] {
  return [...new Set(cols.flatMap((l) => l.cards.map((c) => c.sessionId).filter((id): id is string => Boolean(id))))];
}

/** Arrows on the board: ↑ ↓ within a column, ← → to the nearest column that has cards, keeping the row. */
export function moveFocus(cols: { cards: Card[]; tickets?: Ticket[] }[], focus: string | null, dx: number, dy: number): string | null {
  const ids = cols.map(laneIds);
  let ci = -1;
  let ri = 0;
  ids.forEach((c, i) => { const j = c.indexOf(focus ?? ''); if (j >= 0) { ci = i; ri = j; } });
  if (ci < 0) return ids.find((c) => c.length)?.[0] ?? null;
  if (dy) return ids[ci][Math.max(0, Math.min(ids[ci].length - 1, ri + dy))];
  for (let c = ci + dx; c >= 0 && c < ids.length; c += dx) {
    if (ids[c].length) return ids[c][Math.min(ri, ids[c].length - 1)];
  }
  return focus;
}

/**
 * ← → with a card open: the previous or next card the board shows, column by column (Inbox
 * tickets aren't cards, so they are skipped). Where it is among them, for "3 of 7".
 */
export function stepCard(cols: { cards: Card[] }[], id: string, delta: number): { id: string | null; at: number; total: number } {
  const ids = cols.flatMap((l) => l.cards.map((c) => c.id));
  const at = ids.indexOf(id);
  const next = at < 0 ? null : ids[at + delta] ?? null;
  return { id: next, at, total: ids.length };
}

/** A card is still starting until its session reports in. */
export function booting(c: Card): boolean {
  return !c.sessionId;
}

/**
 * The line under the card's title: what its session is doing (from its hooks), or while it is
 * starting, the latest start-up step. go: working · bad: needs you · ok: waiting · off: ended.
 */
export function cardActivity(c: Card): { text: string; state: 'ok' | 'go' | 'bad' | 'off' } {
  if (c.sessionId && c.live) {
    const p = c.live.phase;
    return { text: c.live.text, state: p === 'working' ? 'go' : p === 'needs' ? 'bad' : p === 'ended' ? 'off' : 'ok' };
  }
  const last = c.boot[c.boot.length - 1];
  return last ? { text: last.text, state: last.state } : { text: 'Not started', state: 'go' };
}

/** Waiting on you in its terminal tab, or stuck starting. */
export function needsYou(c: Card): boolean {
  return c.live?.phase === 'needs' || (!c.sessionId && c.boot.some((b) => b.state === 'bad'));
}

/** Steps done out of steps, from Claude's to-do list; null when it has none. */
export function progress(c: Card): { done: number; total: number } | null {
  const todos = c.todos ?? [];
  return todos.length ? { done: todos.filter((t) => t.status === 'completed').length, total: todos.length } : null;
}

/** "42m", "1h 05m": how long since the card started. */
export function elapsed(since: number, now: number): string {
  const m = Math.max(0, Math.floor((now - since) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** A path as the drawer shows it: relative to the card's folder when inside it. */
export function shortPath(path: string, cwd?: string): string {
  if (!cwd) return path;
  const p = path.replace(/\\/g, '/');
  const c = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  return p.toLowerCase().startsWith(`${c.toLowerCase()}/`) ? p.slice(c.length + 1) : path;
}

// ---- The new-card screen ------------------------------------------------------------------

export type Pane = 'src' | 'pkt' | 'go';
export type SourceTab = 'tickets' | 'repos' | 'folders';
export const SOURCE_TABS: SourceTab[] = ['tickets', 'repos', 'folders'];

/** ← → in panel 1: the next tab, round. */
export function nextTab(t: SourceTab, delta: number): SourceTab {
  return SOURCE_TABS[(SOURCE_TABS.indexOf(t) + delta + SOURCE_TABS.length) % SOURCE_TABS.length];
}

/**
 * The Folders tab: folders this card has that the repo library doesn't list (any folder on disk:
 * docs, a spec folder, a tool's install). They go in like extra repos, with --add-dir.
 */
export function cardFolders(c: Composer, library: RepoInfo[]): PacketItem[] {
  return c.packet.card.filter((i) => i.kind === 'repo' && !library.some((r) => samePath(r.path, i.id)));
}

/** A folder from the picker: added to the card, unless it has it already. */
export function addFolder(c: Composer, path: string): Composer | string {
  if (cardHasRepo(c, path)) return `${c.addTo!.key} can already use ${repoName(path)}`;
  if (hasRepo(c, path) || c.packet.card.some((i) => i.kind === 'repo' && samePath(i.id, path))) return `${repoName(path)} is in the card already`;
  return withHome({ ...c, packet: { ...c.packet, card: [...c.packet.card, repoItem(path)] } });
}
export const PANES: Pane[] = ['src', 'pkt', 'go'];

export interface Composer {
  /** The card's ticket, if it has one: its title is the card's, its parts are the ticket layer. */
  ticket: Ticket | null;
  /** Panel 1 shows tickets, the repo library, or folders you added from anywhere on disk (← → switch). */
  tab: SourceTab;
  title: string;
  workspaceId: string | null;
  packet: Packet;
  launch: CardDraft['launch'];
  pane: Pane;
  /** Highlighted row in each panel. */
  si: number;
  pi: number;
  gi: number;
  /** Panel 2 shows the exact text instead of the layers. */
  preview: boolean;
  /** Search in panel 1. */
  q: string;
  /** The opening message was typed by hand, so changing the mode leaves it alone. */
  msgTouched: boolean;
  starting: boolean;
  error: string | null;
  /** Set when adding context to a card that has started, instead of making a new one. */
  addTo?: AddTarget;
  /** Develop, QA or Code review (k). Follows the ticket until you pick one yourself. */
  kind: CardKind;
  kindTouched: boolean;
  /** QA and review: the ticket's pull request, once the server has looked (`prFor` is the ticket it looked for). */
  pr?: PrTarget;
  prFor?: string;
  prLooking?: boolean;
  /** Why no pull request was found, a line per repo. */
  prNotes?: string[];
}

/** The running card the new-card screen adds to, and what it already has (so it isn't added twice). */
export interface AddTarget {
  id: string;
  key: string;
  /** The card's own ticket, if any. */
  ticketKey?: string;
  /** Ids of the packet items it started with or was given since ("ticket:SHOP-160", "note:…"). */
  had: string[];
  /** Every repo its session can use. */
  repos: string[];
}

const repoItem = (path: string): PacketItem => ({ kind: 'repo', id: path, label: repoName(path), on: true });

/** Run recipes by repo path, as the server sends them. */
export type Recipes = Record<string, RunRecipe>;

const firstLine = (t: string) => { const l = t.trim().split(/\n/)[0]; return l.length > 60 ? `${l.slice(0, 58)}…` : l; };

/** The workspace's repos, its notes (and for QA, how the team tests), and the run recipe of the repo cards start in. */
function workspaceLayer(ws: Workspace | null, recipes: Recipes, kind: CardKind = 'build'): PacketItem[] {
  if (!ws) return [];
  const r = recipes[wsRecipeKey(ws.id)] ?? recipeFor(recipes, homeRepo(ws) ?? ws.repos[0]);
  return [
    ...ws.repos.map(repoItem),
    ...(ws.notes ? [{ kind: 'note' as const, id: WORKSPACE_NOTES, label: `Workspace notes: ${firstLine(ws.notes)}`, text: ws.notes, on: true }] : []),
    ...(ws.testing && kind === 'qa' ? [{ kind: 'note' as const, id: TESTING_NOTES, label: `How this team tests: ${firstLine(ws.testing)}`, text: ws.testing, on: true }] : []),
    ...(r ? [{ kind: 'recipe' as const, id: `recipe:${r.repo}`, label: recipeLabel(r), text: recipeText(r), on: true }] : []),
  ];
}

/**
 * A new-card screen worth keeping when it closes: a title, a ticket, a note or context of its own.
 * (Not one that adds to a running card: that is one keystroke to redo.)
 */
export function hasWork(c: Composer): boolean {
  if (c.addTo) return false;
  return Boolean(c.title.trim() || c.ticket || c.packet.note.trim() || c.packet.card.length);
}

/** The draft as it comes back: not starting, no error, the list instead of the preview. */
export function asDraft(c: Composer): Composer {
  return { ...c, starting: false, error: null, preview: false, q: '', prLooking: false };
}

export function newComposer(ws: Workspace | null, key: string, ticket: Ticket | null = null, recipes: Recipes = {}): Composer {
  const kind = kindForTicket(ticket);
  const { mode, branch } = kindDefaults(kind);
  return {
    ticket,
    // From a ticket, the ticket is settled, so panel 1 opens on the repos; otherwise on the tickets.
    tab: ticket ? 'repos' : 'tickets',
    title: ticket?.title ?? '',
    workspaceId: ws?.id ?? null,
    packet: { workspace: workspaceLayer(ws, recipes, kind), ticket: ticket ? ticketItems(ticket) : [], card: [], note: '' },
    launch: { home: (ws && homeRepo(ws)) ?? '', branch, mode, message: defaultMessage(ticket?.key ?? key, mode, kind) },
    pane: 'src', si: 0, pi: 0, gi: 0, preview: false, q: '', msgTouched: false, starting: false, error: null,
    kind, kindTouched: false,
  };
}

/**
 * k, or the Kind row: Develop, QA or Code review. The mode and branch follow the kind, the
 * opening message too unless you typed one, and a QA card gets the workspace's testing notes.
 */
export function setKind(c: Composer, kind: CardKind, key: string, workspaces: Workspace[], recipes: Recipes = {}, touched = true): Composer {
  if (c.addTo) return c;
  const ws = workspaces.find((w) => w.id === c.workspaceId) ?? null;
  const { mode, branch } = kindDefaults(kind, c.pr);
  const workspace = ws ? keepSwitches(c.packet.workspace, workspaceLayer(ws, recipes, kind)) : c.packet.workspace;
  return {
    ...c, kind, kindTouched: c.kindTouched || touched,
    packet: { ...c.packet, workspace },
    launch: { ...c.launch, mode, branch, ...(branch === 'pr' && c.pr ? { home: c.pr.repo } : {}), message: c.msgTouched ? c.launch.message : defaultMessage(c.ticket?.key ?? key, mode, kind) },
  };
}

/** A rebuilt layer keeps what you switched off in the old one. */
function keepSwitches(old: PacketItem[], next: PacketItem[]): PacketItem[] {
  return next.map((i) => { const was = old.find((o) => o.id === i.id && o.kind === i.kind); return was ? { ...i, on: was.on } : i; });
}

/** k: the next kind. */
export function cycleKind(c: Composer, key: string, workspaces: Workspace[], recipes: Recipes = {}): Composer {
  const at = CARD_KINDS.findIndex((k) => k.id === c.kind);
  return setKind(c, CARD_KINDS[(at + 1) % CARD_KINDS.length].id, key, workspaces, recipes);
}

/** Should the page ask the server for the ticket's pull request? QA and review cards with a ticket, once per ticket. */
export function wantsPr(c: Composer): string | null {
  if (c.addTo || c.kind === 'build' || !c.ticket || c.prLooking || c.prFor === c.ticket.key) return null;
  return c.ticket.key;
}

/** The server's answer: the PR (a review starts on its branch, in its repo) or why there is none. */
export function gotPr(c: Composer, key: string, pr: PrTarget | undefined, notes: string[]): Composer {
  if (c.ticket?.key !== key) return c;
  const { pr: _old, ...rest } = c;
  const next: Composer = { ...rest, prFor: key, prLooking: false, prNotes: notes };
  if (!pr) return { ...next, launch: { ...next.launch, branch: next.launch.branch === 'pr' ? 'current' : next.launch.branch } };
  // Its repo must be one of the card's; add it when it isn't.
  const has = includedRepos(next.packet).some((r) => samePath(r, pr.repo));
  const packet = has ? next.packet : { ...next.packet, card: [...next.packet.card, repoItem(pr.repo)] };
  const branch = c.kind === 'review' ? 'pr' : next.launch.branch;
  return { ...next, pr, packet, launch: { ...next.launch, branch, ...(branch === 'pr' ? { home: pr.repo } : {}) } };
}

/** c in a card's drawer: the same screen, adding to that card. Only the card layer and your note. */
export function addComposer(card: Card, tickets: Ticket[] = []): Composer {
  return {
    ticket: null,
    // Opens on the tickets when there are some to relate, else on the repos.
    tab: tickets.length ? 'tickets' : 'repos',
    title: card.title,
    workspaceId: card.workspaceId,
    packet: { workspace: [], ticket: [], card: [], note: '' },
    launch: card.launch,
    pane: 'src', si: 0, pi: 0, gi: 0, preview: false, q: '', msgTouched: true, starting: false, error: null,
    kind: card.kind ?? 'build', kindTouched: true,
    addTo: {
      id: card.id, key: card.key, ...(card.ticket ? { ticketKey: card.ticket.key } : {}),
      had: [...card.packet.card, ...(card.later ?? [])].map((i) => i.id), repos: cardRepos(card),
    },
  };
}

/** Adding to a running card, does it already have this repo? */
export function cardHasRepo(c: Composer, path: string): boolean {
  return Boolean(c.addTo?.repos.some((r) => samePath(r, path)));
}

/** Adding to a running card, does it already have this ticket (its own, or a related one)? */
export function cardHasTicket(c: Composer, key: string): boolean {
  return Boolean(c.addTo && (c.addTo.ticketKey === key || c.addTo.had.includes(`ticket:${key}`)));
}

/** What Ctrl+Enter adds to the running card, or why it can't yet. */
export function additionOf(c: Composer): { items: PacketItem[]; note: string } | string {
  const items = c.packet.card.filter((i) => i.on);
  const note = c.packet.note.trim();
  if (!items.length && !note) return 'Add something first: a repo, a ticket, or a note (e).';
  return { items, note };
}

/** What the card will be called: its ticket's key, or the next CARD-n. */
export function composerKey(c: Composer, nextKey: string): string {
  return c.addTo?.key ?? c.ticket?.key ?? nextKey;
}

/**
 * Panel 1's Tickets tab: every ticket, filtered by the search. Open ones without a card come first
 * (newest first), then those already on the line, then done ones.
 */
export function ticketSources(c: Composer, tickets: Ticket[], started: Set<string> = new Set(), found: Ticket[] = []): Ticket[] {
  const q = c.q.trim().toLowerCase();
  const rank = (t: Ticket) => (t.done ? 3 : t.hidden ? 2 : started.has(t.key) ? 1 : 0);
  const local = tickets
    .filter((t) => !q || `${t.key} ${t.title} ${ticketSub(t)}`.toLowerCase().includes(q))
    .sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
  // What the tracker's search found that isn't here already: other people's tickets, after yours.
  const more = q ? found.filter((t) => !local.some((x) => x.key === t.key)) : [];
  return [...local, ...more];
}

/**
 * Space on a ticket in panel 1. The first becomes the card's ticket (its title, its parts, its
 * workspace when the project is mapped); later ones go in as related tickets, and Space again
 * takes a related one back out.
 */
export function pickTicket(c: Composer, t: Ticket, workspaces: Workspace[], started: Set<string>, recipes: Recipes = {}): Composer | string {
  if (c.ticket?.key === t.key) return 'That is this card’s ticket. x takes it off.';
  if (c.addTo && cardHasTicket(c, t.key)) return c.addTo.ticketKey === t.key ? `${t.key} is this card’s own ticket: it has it already.` : `${c.addTo.key} already has ${t.key}.`;
  if (!c.ticket && !c.addTo) {
    if (started.has(t.key)) return `${t.key} already has a card on the line.`;
    const ws = t.workspaceId ? workspaces.find((w) => w.id === t.workspaceId) ?? null : null;
    const base = ws && ws.id !== c.workspaceId ? setWorkspace(c, ws, recipes) : c;
    const picked: Composer = {
      ...base, ticket: t, title: t.title, packet: { ...base.packet, ticket: ticketItems(t) },
      launch: { ...base.launch, message: c.msgTouched ? c.launch.message : defaultMessage(t.key, c.launch.mode, c.kind) },
    };
    // The ticket says what kind of work it is, unless you already chose.
    return c.kindTouched ? picked : setKind(picked, kindForTicket(t), t.key, workspaces, recipes, false);
  }
  const id = relatedItem(t).id;
  const has = c.packet.card.some((i) => i.id === id);
  return { ...c, packet: { ...c.packet, card: has ? c.packet.card.filter((i) => i.id !== id) : [...c.packet.card, relatedItem(t)] } };
}

/** x on the card's ticket in panel 1: a card without a ticket again. */
export function dropTicket(c: Composer, nextKey: string): Composer {
  if (!c.ticket) return c;
  const { pr: _pr, prFor: _for, prNotes: _notes, ...rest } = c;
  return {
    ...rest, ticket: null, title: '', packet: { ...c.packet, ticket: [] },
    launch: { ...c.launch, branch: c.launch.branch === 'pr' ? 'current' : c.launch.branch, message: c.msgTouched ? c.launch.message : defaultMessage(nextKey, c.launch.mode, c.kind) },
  };
}

/** Switch workspace: its repos replace the workspace layer; what you added to the card stays. */
export function setWorkspace(c: Composer, ws: Workspace | null, recipes: Recipes = {}): Composer {
  const packet = { ...c.packet, workspace: workspaceLayer(ws, recipes, c.kind) };
  const home = (ws && homeRepo(ws)) ?? includedRepos(packet)[0] ?? '';
  return { ...c, workspaceId: ws?.id ?? null, packet, launch: { ...c.launch, home } };
}

/** Panel 1: the repo library, filtered by the search. */
export function sources(c: Composer, repos: RepoInfo[]): RepoInfo[] {
  const q = c.q.trim().toLowerCase();
  return q ? repos.filter((r) => `${r.name} ${r.path}`.toLowerCase().includes(q)) : repos;
}

/** Is this repo in the packet (switched on)? */
export function hasRepo(c: Composer, path: string): boolean {
  return includedRepos(c.packet).some((r) => samePath(r, path));
}

/** Where a repo from the library is, if anywhere: its workspace said so, or it was added to the card. */
export function repoOrigin(c: Composer, path: string): 'workspace' | 'card' | null {
  if (c.packet.workspace.some((i) => i.kind === 'repo' && samePath(i.id, path))) return 'workspace';
  if (c.packet.card.some((i) => i.kind === 'repo' && samePath(i.id, path))) return 'card';
  return null;
}

/** Space on a library repo: add it to this card, or take it out again (a workspace repo is switched off, not removed). */
export function toggleSource(c: Composer, path: string): Composer {
  if (cardHasRepo(c, path)) return c;
  const flip = (list: PacketItem[]) => list.map((i) => (i.kind === 'repo' && samePath(i.id, path) ? { ...i, on: !i.on } : i));
  const where = repoOrigin(c, path);
  let packet: Packet;
  if (where === 'workspace') packet = { ...c.packet, workspace: flip(c.packet.workspace) };
  else if (where === 'card') packet = { ...c.packet, card: c.packet.card.filter((i) => !(i.kind === 'repo' && samePath(i.id, path))) };
  else packet = { ...c.packet, card: [...c.packet.card, repoItem(path)] };
  return withHome({ ...c, packet });
}

/** The home repo follows the packet: if it was switched off, the first included repo takes over. */
function withHome(c: Composer): Composer {
  const home = homeOf(c.packet, c.launch) ?? '';
  return home === c.launch.home ? c : { ...c, launch: { ...c.launch, home } };
}

/** Panel 2's rows, top to bottom: the workspace layer, the ticket layer, this card's layer, then your note. */
export type PacketRow = { layer: 'workspace' | 'ticket' | 'card'; item: PacketItem } | { layer: 'note' };

export function packetRows(c: Composer): PacketRow[] {
  return [
    ...c.packet.workspace.map((item) => ({ layer: 'workspace' as const, item })),
    ...c.packet.ticket.map((item) => ({ layer: 'ticket' as const, item })),
    ...c.packet.card.map((item) => ({ layer: 'card' as const, item })),
    { layer: 'note' as const },
  ];
}

/**
 * Space on a packet row: include or leave out. `remove` (x) takes a card-layer item out
 * altogether. The last included repo can't go: a card needs somewhere to start.
 */
export function togglePacketRow(c: Composer, index: number, remove = false): Composer | string {
  const row = packetRows(c)[index];
  if (!row || row.layer === 'note') return c;
  if (remove && row.layer !== 'card') return 'Only what you added to this card can be removed. Space leaves it out.';
  const { item } = row;
  if (item.kind === 'repo' && item.on && !c.addTo && includedRepos(c.packet).length === 1) return 'A card needs at least one repo.';
  const list = c.packet[row.layer];
  const next = remove ? list.filter((i) => i !== item) : list.map((i) => (i === item ? { ...i, on: !i.on } : i));
  return withHome({ ...c, packet: { ...c.packet, [row.layer]: next } });
}

/**
 * w on a repo this card added: keep it for the whole workspace. It moves to the workspace layer
 * here, and the caller tells the server, so every later card in the workspace gets it too.
 */
export function keepForWorkspace(c: Composer, index: number): { composer: Composer; repo: string } | string {
  const row = packetRows(c)[index];
  if (c.addTo) return 'Adding to a running card: keep repos for the workspace with + on the board.';
  if (!row || row.layer !== 'card' || row.item.kind !== 'repo') return 'Only a repo you added to this card can be kept for the workspace.';
  if (!c.workspaceId) return 'This card has no workspace. Pick one under How it starts.';
  const { item } = row;
  const packet = { ...c.packet, card: c.packet.card.filter((i) => i !== item), workspace: [...c.packet.workspace, { ...item, on: true }] };
  return { composer: { ...c, packet }, repo: item.id };
}

/** Panel 3's rows: each a choice you change with ← →, or the message you type. */
export interface GoRow {
  id: 'kind' | 'where' | 'ws' | 'home' | 'branch' | 'mode' | 'model' | 'msg' | 'deliver';
  label: string;
  opts: string[];
  at: number;
  /** Options shown but not offered yet. */
  off?: number[];
}

/** What the default model is, for the Model row's first option: the server's pin, else the user's setting. */
export interface ModelDefaults { pinned?: string | null; user?: string | null }

/** The Model row's options: the default (named when known), then Opus, Sonnet, Haiku. */
export function modelOpts(d: ModelDefaults = {}): string[] {
  const def = d.pinned ?? d.user;
  return [def ? `Default · ${modelName(def)}` : 'Default', ...CARD_MODELS.map((x) => x.name)];
}

export function goRows(c: Composer, workspaces: Workspace[], key: string, models: ModelDefaults = {}): GoRow[] {
  // Adding to a running card: only when it reaches Claude. The channel (a preview flag) comes later.
  if (c.addTo) return [{ id: 'deliver', label: 'When it reaches Claude', opts: ['With your next message', 'Right now, through the channel (later)'], at: 0, off: [1] }];
  const repos = includedRepos(c.packet);
  const home = homeOf(c.packet, c.launch);
  const branches = branchOpts(c, key);
  return [
    { id: 'kind', label: 'Kind of work', opts: CARD_KINDS.map((k) => k.name), at: CARD_KINDS.findIndex((k) => k.id === c.kind) },
    { id: 'where', label: 'Where it runs', opts: ['Terminal tab'], at: 0 },
    { id: 'ws', label: 'Workspace', opts: [...workspaces.map((w) => w.name), 'None'], at: Math.max(0, c.workspaceId ? workspaces.findIndex((w) => w.id === c.workspaceId) : workspaces.length) },
    { id: 'home', label: 'Starts in', opts: repos.length ? repos.map(repoName) : ['(no repo)'], at: Math.max(0, repos.findIndex((r) => r === home)) },
    {
      id: 'branch', label: 'Branch', opts: branches.map((b) => b.name), at: Math.max(0, branches.findIndex((b) => b.id === c.launch.branch)),
      off: branches.flatMap((b, i) => (b.off ? [i] : [])),
    },
    { id: 'mode', label: 'Mode', opts: LAUNCH_MODES.map((m) => m.name), at: LAUNCH_MODES.findIndex((m) => m.id === c.launch.mode) },
    { id: 'model', label: 'Model', opts: modelOpts(models), at: c.launch.model ? 1 + CARD_MODELS.findIndex((x) => x.id === c.launch.model) : 0 },
    { id: 'msg', label: 'Opening message', opts: [], at: 0 },
  ];
}

/**
 * The Branch row's choices. Development makes its own branch; QA and review work on what is
 * there: the current checkout, or a copy of the repo on the pull request's branch once it is found.
 */
export function branchOpts(c: Composer, key: string): { id: BranchChoice; name: string; off?: boolean }[] {
  if (c.kind === 'build') return [{ id: 'new', name: `New: ${branchFor(key, c.title || 'new')}` }, { id: 'current', name: 'Current branch' }, { id: 'worktree', name: 'New worktree' }];
  return [
    { id: 'current', name: 'Current branch' },
    c.pr ? { id: 'pr', name: `PR #${c.pr.number}’s branch, in a copy` } : { id: 'pr', name: c.prLooking ? 'PR’s branch (looking…)' : 'PR’s branch (none found)', off: true },
  ];
}

/** m on the new-card screen: the next model (default → Opus → Sonnet → Haiku → default). */
export function cycleModel(c: Composer): Composer {
  const at = c.launch.model ? 1 + CARD_MODELS.findIndex((x) => x.id === c.launch.model) : 0;
  return pickOption(c, 'model', (at + 1) % (CARD_MODELS.length + 1), [], '');
}

export function stepOption(c: Composer, row: GoRow, delta: number, workspaces: Workspace[], key: string, recipes: Recipes = {}): Composer {
  const n = row.opts.length;
  if (!n) return c;
  let at = row.at;
  for (let tries = 0; tries < n; tries++) {
    at = (at + delta + n) % n;
    if (!row.off?.includes(at)) break;
  }
  return pickOption(c, row.id, at, workspaces, key, recipes);
}

export function pickOption(c: Composer, id: GoRow['id'], at: number, workspaces: Workspace[], key: string, recipes: Recipes = {}): Composer {
  switch (id) {
    case 'ws': return setWorkspace(c, workspaces[at] ?? null, recipes);
    case 'home': { const r = includedRepos(c.packet)[at]; return r ? { ...c, launch: { ...c.launch, home: r } } : c; }
    case 'kind': return setKind(c, CARD_KINDS[at]?.id ?? 'build', key, workspaces, recipes);
    case 'branch': {
      const b = branchOpts(c, key)[at];
      if (!b || b.off) return c;
      return { ...c, launch: { ...c.launch, branch: b.id, ...(b.id === 'pr' && c.pr ? { home: c.pr.repo } : {}) } };
    }
    case 'model': {
      const { model: _, ...launch } = c.launch;
      const pick = CARD_MODELS[at - 1]?.id;
      return { ...c, launch: pick ? { ...launch, model: pick } : launch };
    }
    case 'mode': {
      const mode = LAUNCH_MODES[at]?.id ?? 'plan';
      return { ...c, launch: { ...c.launch, mode, message: c.msgTouched ? c.launch.message : defaultMessage(key, mode, c.kind) } };
    }
    default: return c;
  }
}

/** What Ctrl+Enter sends, or why it can't yet. */
export function draftOf(c: Composer): CardDraft | string {
  const title = (c.ticket?.title ?? c.title).trim();
  if (!title) return 'Give the card a title first, or pick a ticket.';
  if (!includedRepos(c.packet).length) return 'A card needs at least one repo.';
  if (c.launch.branch === 'pr' && !c.pr) return 'No pull request was found for this ticket: pick Current branch.';
  return {
    title, workspaceId: c.workspaceId, packet: c.packet, launch: { ...c.launch, home: homeOf(c.packet, c.launch)! }, ...(c.ticket ? { ticketKey: c.ticket.key } : {}),
    ...(c.kind !== 'build' ? { kind: c.kind } : {}), ...(c.kind !== 'build' && c.pr ? { pr: c.pr } : {}),
  };
}
