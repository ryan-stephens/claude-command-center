// Keys on the Ticket Line, the home page: the board, a card's drawer and the new-card screen, plus the workspace keys that used to live on Home. keys.ts routes here
// while the line is on screen, before the global shortcuts, so Ctrl+Enter starts work instead of
// expanding a session. Every key here has a row in LINE_SECTIONS (the ? overlay) and in
// lineLegendFor (the bar at the bottom).

import { exportWorkspace, importWorkspace } from './commands.ts';
import { openSession } from './keys.ts';
import { currentWorkspace, flash, get, set, setFilter, type WorkspaceAction } from './store.ts';
import {
  cycleModel, draftOf, goRows, keepForWorkspace, lanes, lineSessions, moveFocus, newComposer, packetRows, PANES, sources, stepOption, togglePacketRow, toggleSource,
  type Composer,
} from './line-model.ts';
import { send, startCard } from './ws.ts';

export const LINE_SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Ticket Line',
    keys: [
      ['← → ↑ ↓', 'Move between cards'],
      ['Enter', 'Open the card: Overview, Context (how it started, what Claude was given), Transcript'],
      ['Ctrl+Enter', 'The card’s session full screen, to read and type there (Esc comes back)'],
      ['c', 'New card: build its context and start work in a terminal tab'],
      ['1–9  /  0', 'Show one workspace’s cards / all of them'],
      ['/', 'Filter the cards by words'],
      ['Tab (card open)', 'Overview, Context, Transcript'],
      ['Delete', 'Take the card off the line (its terminal session keeps running)'],
      ['Esc', 'Close the card, or clear the filter'],
    ],
  },
  {
    title: 'Workspaces (Ticket Line)',
    keys: [
      ['W', 'New workspace'],
      ['E', 'Edit the workspace shown (with All showing, pick which)'],
      ['+ / −', 'Add a repo from the library to the workspace shown / remove one (every card and session in it can use them all)'],
      ['F', 'Choose the folders the repo library lists'],
      ['Shift+E / Shift+I', 'Share the workspace as a file / import one'],
      ['Shift+Delete', 'Delete the workspace shown (its repos and sessions stay)'],
    ],
  },
  {
    title: 'New card',
    keys: [
      ['Tab / Shift+Tab', 'Next / previous panel: add context → what Claude will know → how it starts'],
      ['↑ ↓', 'Move in the panel'],
      ['Space', 'Add a repo from the library, or take it out; include or leave out a line of the context'],
      ['/', 'Search the repo library'],
      ['x', 'Remove something you added to this card'],
      ['w (what Claude will know)', 'Keep a repo you added to this card for the whole workspace'],
      ['e', 'Write your own note for Claude'],
      ['← → (how it starts)', 'Change the option: workspace, the repo it starts in, branch, mode, model'],
      ['m', 'Change the model: your default, Opus, Sonnet or Haiku'],
      ['p', 'Preview exactly what Claude gets'],
      ['Ctrl+Enter', 'Start work (also while typing)'],
      ['Esc', 'Leave the text field, then cancel'],
    ],
  },
];

export function openLine(): void {
  const s = get();
  const cols = lanes(s.cards, s.line.filter, s.line.q);
  const focus = s.cards.some((c) => c.id === s.line.focus) ? s.line.focus : moveFocus(cols, null, 1, 0);
  set({ screen: 'line', line: { ...s.line, focus }, modal: null });
}

/** The cards' sessions, in column order (what Alt+↑ ↓ walk from a session). Ctrl+K finds any other session. */
export function lineSessionIds(): string[] {
  const s = get();
  return lineSessions(lanes(s.cards, s.line.filter, s.line.q));
}

/** The expand key on the line: the focused card's session full screen. */
export function expandFromLine(): void {
  const s = get();
  if (s.screen !== 'line' || s.composer) return;
  const id = s.line.drawer ?? s.line.focus;
  const card = s.cards.find((c) => c.id === id);
  if (!card) { flash('Pick a card first'); return; }
  if (!card.sessionId) { flash(`${card.key} has no session yet: it links once its terminal tab starts`); return; }
  openSession(card.sessionId);
}

/** The workspace keys: act on the workspace shown, or with All showing, ask which. */
export function workspaceKey(then: WorkspaceAction): void {
  const s = get();
  const ws = currentWorkspace(s);
  if (ws) { runWorkspaceAction(then, ws.id); return; }
  if (!s.workspaces.length) {
    if (then === 'addRepo') set({ modal: { kind: 'workspace', id: null } });
    else flash('No workspaces yet. W makes one.');
    return;
  }
  if (s.workspaces.length === 1) { runWorkspaceAction(then, s.workspaces[0].id); return; }
  set({ modal: { kind: 'pickWorkspace', then } });
}

export function runWorkspaceAction(then: WorkspaceAction, id: string): void {
  const ws = get().workspaces.find((w) => w.id === id);
  if (!ws) return;
  switch (then) {
    case 'addRepo': set({ modal: { kind: 'repoPicker', target: { kind: 'workspace', id } } }); return;
    case 'removeRepo':
      if (ws.repos.length) set({ modal: { kind: 'repoRemove', target: { kind: 'workspace', id } } });
      else { set({ modal: null }); flash(`${ws.name} has no repos yet. + adds one.`); }
      return;
    case 'edit': set({ modal: { kind: 'workspace', id } }); return;
    case 'share': set({ modal: null }); exportWorkspace(id); return;
    case 'delete': set({ modal: { kind: 'deleteWorkspace', id } }); return;
  }
}

export function openComposer(): void {
  const s = get();
  const ws = s.line.filter !== 'all' ? s.workspaces.find((w) => w.id === s.line.filter) ?? null : s.workspaces[0] ?? null;
  set({ composer: newComposer(ws, s.nextKey), line: { ...s.line, drawer: null } });
  setTimeout(() => document.getElementById('cp-title')?.focus(), 0);
}

export function updateComposer(change: (c: Composer) => Composer | string): void {
  const c = get().composer;
  if (!c) return;
  const next = change(c);
  if (typeof next === 'string') flash(next);
  else set({ composer: { ...next, error: null } });
}

export function startWork(): void {
  const c = get().composer;
  if (!c || c.starting) return;
  const draft = draftOf(c);
  if (typeof draft === 'string') {
    set({ composer: { ...c, error: draft } });
    if (!c.title.trim()) document.getElementById('cp-title')?.focus();
    return;
  }
  set({ composer: { ...c, starting: true, error: null } });
  startCard(draft).then(
    (id) => {
      set({ composer: null, line: { ...get().line, focus: id, drawer: id, tab: 'ctx' } });
      flash('Started in a terminal tab');
    },
    (e: Error) => {
      const now = get().composer;
      if (now) set({ composer: { ...now, starting: false, error: e.message } });
    },
  );
}

export function openCard(id: string): void {
  set({ line: { ...get().line, focus: id, drawer: id, tab: 'over' } });
}

const TABS = ['over', 'ctx', 'tx'] as const;

function focusField(id: string): void {
  setTimeout(() => document.getElementById(id)?.focus(), 0);
}

/** A text field on the new-card screen has focus: most keys type, a few still drive the screen. */
function composerTyping(e: KeyboardEvent, c: Composer): boolean {
  const el = e.target as HTMLElement;
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { el.blur(); startWork(); return true; }
  if (e.key === 'Escape') { el.blur(); return true; }
  if (e.key === 'Tab') {
    el.blur();
    // From the title, Tab goes to the first panel; from a panel's own field, to the next panel.
    if (el.id !== 'cp-title') updateComposer((x) => ({ ...x, pane: PANES[(PANES.indexOf(x.pane) + (e.shiftKey ? 2 : 1)) % 3] }));
    return true;
  }
  if (e.key === 'Enter' && el.tagName === 'INPUT') {
    el.blur();
    if (el.id === 'cp-q') {
      const first = sources(c, get().library.repos)[0];
      if (first) updateComposer((x) => ({ ...toggleSource(x, first.path), q: '', si: 0 }));
    }
    return true;
  }
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && el.id === 'cp-q') {
    updateComposer((x) => ({ ...x, si: Math.max(0, x.si + (e.key === 'ArrowDown' ? 1 : -1)) }));
    return true;
  }
  return false;
}

function composerKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  const c = s.composer!;
  if (typing) return composerTyping(e, c);
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { startWork(); return true; }
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  if (e.key === 'Escape') { set({ composer: null }); return true; }
  if (e.key === 'Tab') { updateComposer((x) => ({ ...x, pane: PANES[(PANES.indexOf(x.pane) + (e.shiftKey ? 2 : 1)) % 3] })); return true; }
  if (e.key === 'p') { updateComposer((x) => ({ ...x, preview: !x.preview })); return true; }
  if (e.key === 'e') { updateComposer((x) => ({ ...x, pane: 'pkt', preview: false })); focusField('cp-note'); return true; }
  if (e.key === 'm') { updateComposer(cycleModel); return true; }
  const up = e.key === 'ArrowUp';
  const down = e.key === 'ArrowDown';
  const step = up ? -1 : down ? 1 : 0;
  if (c.pane === 'src') {
    const list = sources(c, s.library.repos);
    if (step) { updateComposer((x) => ({ ...x, si: Math.max(0, Math.min(list.length - 1, x.si + step)) })); return true; }
    if (e.key === ' ' || e.key === 'Enter') {
      const repo = list[Math.min(c.si, list.length - 1)];
      if (repo) updateComposer((x) => toggleSource(x, repo.path));
      else if (!s.library.repos.length) flash('The repo library is empty. On the board, F picks the folders it scans.');
      return true;
    }
    if (e.key === '/') { focusField('cp-q'); return true; }
    return false;
  }
  if (c.pane === 'pkt') {
    if (c.preview) return false;
    const rows = packetRows(c);
    if (step) { updateComposer((x) => ({ ...x, pi: Math.max(0, Math.min(rows.length - 1, x.pi + step)) })); return true; }
    if (e.key === ' ' || e.key === 'Enter') {
      if (rows[c.pi]?.layer === 'note') focusField('cp-note');
      else updateComposer((x) => togglePacketRow(x, x.pi));
      return true;
    }
    if (e.key === 'x' || e.key === 'Delete') { updateComposer((x) => togglePacketRow(x, x.pi, true)); return true; }
    if (e.key === 'w') { keepRepo(c.pi); return true; }
    return false;
  }
  const rows = goRows(c, s.workspaces, s.nextKey, { pinned: s.cardModel, user: s.userModel });
  if (step) { updateComposer((x) => ({ ...x, gi: Math.max(0, Math.min(rows.length - 1, x.gi + step)) })); return true; }
  const row = rows[Math.min(c.gi, rows.length - 1)];
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    updateComposer((x) => stepOption(x, row, e.key === 'ArrowRight' ? 1 : -1, s.workspaces, s.nextKey));
    return true;
  }
  if (e.key === 'Enter' && row.id === 'msg') { focusField('cp-msg'); return true; }
  return false;
}

/** w on the new-card screen: the card's repo goes to the workspace, for every card after this one too. */
export function keepRepo(index: number): void {
  const c = get().composer;
  if (!c) return;
  const r = keepForWorkspace(c, index);
  if (typeof r === 'string') { flash(r); return; }
  send({ type: 'workspace.addRepo', id: c.workspaceId!, path: r.repo });
  set({ composer: { ...r.composer, error: null } });
  const ws = get().workspaces.find((w) => w.id === c.workspaceId);
  flash(`Kept for ${ws?.name ?? 'the workspace'}: every card there gets it`);
}

function drawerKeys(e: KeyboardEvent): boolean {
  const s = get();
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  switch (e.key) {
    case 'Escape': set({ line: { ...s.line, drawer: null } }); return true;
    case 'Tab': {
      const i = TABS.indexOf(s.line.tab);
      set({ line: { ...s.line, tab: TABS[(i + (e.shiftKey ? 2 : 1)) % 3] } });
      return true;
    }
    case 'Delete': if (s.line.drawer) set({ modal: { kind: 'deleteCard', id: s.line.drawer } }); return true;
  }
  return false;
}

/** The workspace keys on the board. */
function workspaceKeys(e: KeyboardEvent): boolean {
  if (e.key === 'Delete' && e.shiftKey) { workspaceKey('delete'); return true; }
  switch (e.key) {
    case 'w': case 'W': set({ modal: { kind: 'workspace', id: null } }); return true;
    case 'e': workspaceKey('edit'); return true;
    case 'E': workspaceKey('share'); return true;
    case 'I': importWorkspace(); return true;
    case 'f': case 'F': set({ modal: { kind: 'sources' } }); return true;
    case '+': case '=': workspaceKey('addRepo'); return true;
    case '-': workspaceKey('removeRepo'); return true;
  }
  return false;
}

function boardKeys(e: KeyboardEvent): boolean {
  const s = get();
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (digit && !e.shiftKey) {
    const n = Number(digit[1]);
    const ws = s.workspaces[n - 1];
    if (n && !ws) { flash(s.workspaces.length ? `There is no workspace ${n}` : 'No workspaces yet. W makes one.'); return true; }
    const filter = n === 0 ? 'all' : ws.id;
    setFilter(filter);
    set({ line: { ...get().line, focus: moveFocus(lanes(s.cards, filter, s.line.q), null, 1, 0) } });
    flash(n === 0 ? 'Every workspace' : ws.name);
    return true;
  }
  if (workspaceKeys(e)) return true;
  if (e.key === '/' && !e.shiftKey) { set({ line: { ...s.line, searching: true } }); focusField('line-q'); return true; }
  const cols = lanes(s.cards, s.line.filter, s.line.q);
  const focused = cols.some((l) => l.cards.some((c) => c.id === s.line.focus)) ? s.line.focus : null;
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key]) {
    const [dx, dy] = arrows[e.key];
    set({ line: { ...s.line, focus: moveFocus(cols, focused, dx, dy) } });
    return true;
  }
  switch (e.key) {
    case 'Enter': if (focused) openCard(focused); return true;
    case 'c': openComposer(); return true;
    case 'Delete': if (focused) set({ modal: { kind: 'deleteCard', id: focused } }); return true;
    case 'Escape': if (s.line.q) set({ line: { ...s.line, q: '' } }); return true;
  }
  return false;
}

/** The filter box (/): typing filters, Enter or ↓ goes back to the board with the filter kept, Esc clears it. */
function searchKeys(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement;
  if (el.id !== 'line-q') return false;
  if (e.key === 'Escape') { el.blur(); set({ line: { ...get().line, q: '', searching: false } }); return true; }
  if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'Tab') { el.blur(); set({ line: { ...get().line, searching: false } }); return true; }
  return false;
}

export function lineKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  if (s.screen !== 'line' || s.modal) return false;
  if (s.composer) return composerKeys(e, typing);
  if (typing) return searchKeys(e);
  if (s.line.drawer) return drawerKeys(e);
  return boardKeys(e);
}

/** Take a card off the line (the Delete dialog's yes). */
export function deleteCard(id: string): void {
  send({ type: 'card.delete', id });
  const s = get();
  const cols = lanes(s.cards.filter((c) => c.id !== id), s.line.filter, s.line.q);
  set({ line: { ...s.line, drawer: s.line.drawer === id ? null : s.line.drawer, focus: s.line.focus === id ? moveFocus(cols, null, 1, 0) : s.line.focus } });
}
