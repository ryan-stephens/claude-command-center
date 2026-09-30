// The Ticket Line's pure logic: which card sits where on the board, how arrows move between them,
// and the new-card screen's state (its three panels and what each key does to them).
// Tested in line-model.test.ts; the components only draw it.

import {
  branchFor, defaultMessage, homeOf, includedRepos, LAUNCH_MODES, STAGES,
  type Card, type CardDraft, type Packet, type PacketItem, type Stage,
} from '../shared/cards.ts';
import type { RepoInfo, Workspace } from '../shared/protocol.ts';
import { homeRepo, repoName, samePath } from '../shared/workspaces.ts';

/** Which workspace's cards the board shows. */
export type LineFilter = 'all' | string;

export function lanes(cards: Card[], filter: LineFilter): { stage: Stage; name: string; cards: Card[] }[] {
  return STAGES.map((s) => ({
    stage: s.id,
    name: s.name,
    cards: cards.filter((c) => c.stage === s.id && (filter === 'all' || c.workspaceId === filter)),
  }));
}

/** Arrows on the board: ↑ ↓ within a column, ← → to the nearest column that has cards, keeping the row. */
export function moveFocus(cols: { cards: Card[] }[], focus: string | null, dx: number, dy: number): string | null {
  let ci = -1;
  let ri = 0;
  cols.forEach((c, i) => { const j = c.cards.findIndex((x) => x.id === focus); if (j >= 0) { ci = i; ri = j; } });
  if (ci < 0) return cols.find((c) => c.cards.length)?.cards[0].id ?? null;
  if (dy) return cols[ci].cards[Math.max(0, Math.min(cols[ci].cards.length - 1, ri + dy))].id;
  for (let c = ci + dx; c >= 0 && c < cols.length; c += dx) {
    if (cols[c].cards.length) return cols[c].cards[Math.min(ri, cols[c].cards.length - 1)].id;
  }
  return focus;
}

/** A card is still starting until its session reports in. */
export function booting(c: Card): boolean {
  return !c.sessionId;
}

/** The line under the card's title: the latest thing that happened to it. */
export function cardActivity(c: Card): { text: string; state: 'ok' | 'go' | 'bad' } {
  const last = c.boot[c.boot.length - 1];
  return last ? { text: last.text, state: last.state } : { text: 'Not started', state: 'go' };
}

// ---- The new-card screen ------------------------------------------------------------------

export type Pane = 'src' | 'pkt' | 'go';
export const PANES: Pane[] = ['src', 'pkt', 'go'];

export interface Composer {
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
}

const repoItem = (path: string): PacketItem => ({ kind: 'repo', id: path, label: repoName(path), on: true });

function workspaceLayer(ws: Workspace | null): PacketItem[] {
  return ws ? ws.repos.map(repoItem) : [];
}

export function newComposer(ws: Workspace | null, key: string): Composer {
  return {
    title: '',
    workspaceId: ws?.id ?? null,
    packet: { workspace: workspaceLayer(ws), ticket: [], card: [], note: '' },
    launch: { home: (ws && homeRepo(ws)) ?? '', branch: 'new', mode: 'plan', message: defaultMessage(key, 'plan') },
    pane: 'src', si: 0, pi: 0, gi: 0, preview: false, q: '', msgTouched: false, starting: false, error: null,
  };
}

/** Switch workspace: its repos replace the workspace layer; what you added to the card stays. */
export function setWorkspace(c: Composer, ws: Workspace | null): Composer {
  const packet = { ...c.packet, workspace: workspaceLayer(ws) };
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
  if (item.kind === 'repo' && item.on && includedRepos(c.packet).length === 1) return 'A card needs at least one repo.';
  const list = c.packet[row.layer];
  const next = remove ? list.filter((i) => i !== item) : list.map((i) => (i === item ? { ...i, on: !i.on } : i));
  return withHome({ ...c, packet: { ...c.packet, [row.layer]: next } });
}

/** Panel 3's rows: each a choice you change with ← →, or the message you type. */
export interface GoRow {
  id: 'where' | 'ws' | 'home' | 'branch' | 'mode' | 'msg';
  label: string;
  opts: string[];
  at: number;
  /** Options shown but not offered yet. */
  off?: number[];
}

export function goRows(c: Composer, workspaces: Workspace[], key: string): GoRow[] {
  const repos = includedRepos(c.packet);
  const home = homeOf(c.packet, c.launch);
  return [
    { id: 'where', label: 'Where it runs', opts: ['Terminal tab', 'In the app (later)'], at: 0, off: [1] },
    { id: 'ws', label: 'Workspace', opts: [...workspaces.map((w) => w.name), 'None'], at: Math.max(0, c.workspaceId ? workspaces.findIndex((w) => w.id === c.workspaceId) : workspaces.length) },
    { id: 'home', label: 'Starts in', opts: repos.length ? repos.map(repoName) : ['(no repo)'], at: Math.max(0, repos.findIndex((r) => r === home)) },
    { id: 'branch', label: 'Branch', opts: [`New: ${branchFor(key, c.title || 'new')}`, 'Current branch', 'New worktree'], at: ['new', 'current', 'worktree'].indexOf(c.launch.branch) },
    { id: 'mode', label: 'Mode', opts: LAUNCH_MODES.map((m) => m.name), at: LAUNCH_MODES.findIndex((m) => m.id === c.launch.mode) },
    { id: 'msg', label: 'Opening message', opts: [], at: 0 },
  ];
}

/** ← → on a panel 3 row. */
export function stepOption(c: Composer, row: GoRow, delta: number, workspaces: Workspace[], key: string): Composer {
  const n = row.opts.length;
  if (!n) return c;
  let at = row.at;
  for (let tries = 0; tries < n; tries++) {
    at = (at + delta + n) % n;
    if (!row.off?.includes(at)) break;
  }
  return pickOption(c, row.id, at, workspaces, key);
}

export function pickOption(c: Composer, id: GoRow['id'], at: number, workspaces: Workspace[], key: string): Composer {
  switch (id) {
    case 'ws': return setWorkspace(c, workspaces[at] ?? null);
    case 'home': { const r = includedRepos(c.packet)[at]; return r ? { ...c, launch: { ...c.launch, home: r } } : c; }
    case 'branch': return { ...c, launch: { ...c.launch, branch: (['new', 'current', 'worktree'] as const)[at] ?? 'new' } };
    case 'mode': {
      const mode = LAUNCH_MODES[at]?.id ?? 'plan';
      return { ...c, launch: { ...c.launch, mode, message: c.msgTouched ? c.launch.message : defaultMessage(key, mode) } };
    }
    default: return c;
  }
}

/** What Ctrl+Enter sends, or why it can't yet. */
export function draftOf(c: Composer): CardDraft | string {
  if (!c.title.trim()) return 'Give the card a title first.';
  if (!includedRepos(c.packet).length) return 'A card needs at least one repo.';
  return { title: c.title.trim(), workspaceId: c.workspaceId, packet: c.packet, launch: { ...c.launch, home: homeOf(c.packet, c.launch)! } };
}
