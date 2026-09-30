// Keys on the Ticket Line: the board, a card's drawer and the new-card screen. keys.ts routes here
// while the line is on screen, before the global shortcuts, so Ctrl+Enter starts work instead of
// expanding a session. Every key here has a row in LINE_SECTIONS (the ? overlay) and in
// lineLegendFor (the bar at the bottom).

import { flash, get, set } from './store.ts';
import {
  draftOf, goRows, lanes, moveFocus, newComposer, packetRows, PANES, sources, stepOption, togglePacketRow, toggleSource,
  type Composer,
} from './line-model.ts';
import { send, startCard } from './ws.ts';

export const LINE_SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Ticket Line',
    keys: [
      ['← → ↑ ↓', 'Move between cards'],
      ['Enter', 'Open the card: Overview, Context (how it started, what Claude was given), Transcript'],
      ['c', 'New card: build its context and start work in a terminal tab'],
      ['1–9  /  0', 'Show one workspace’s cards / all of them'],
      ['Tab (card open)', 'Overview, Context, Transcript'],
      ['Delete', 'Take the card off the line (its terminal session keeps running)'],
      ['Esc', 'Close the card; on the board, back home'],
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
      ['e', 'Write your own note for Claude'],
      ['← → (how it starts)', 'Change the option: workspace, the repo it starts in, branch, mode'],
      ['p', 'Preview exactly what Claude gets'],
      ['Ctrl+Enter', 'Start work (also while typing)'],
      ['Esc', 'Leave the text field, then cancel'],
    ],
  },
];

export function openLine(): void {
  const s = get();
  const cols = lanes(s.cards, s.line.filter);
  const focus = s.cards.some((c) => c.id === s.line.focus) ? s.line.focus : moveFocus(cols, null, 1, 0);
  set({ screen: 'line', line: { ...s.line, focus }, modal: null });
}

export function leaveLine(): void {
  set({ screen: 'list', composer: null });
}

export function toggleLine(): void {
  if (get().screen === 'line') leaveLine();
  else openLine();
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
  const up = e.key === 'ArrowUp';
  const down = e.key === 'ArrowDown';
  const step = up ? -1 : down ? 1 : 0;
  if (c.pane === 'src') {
    const list = sources(c, s.library.repos);
    if (step) { updateComposer((x) => ({ ...x, si: Math.max(0, Math.min(list.length - 1, x.si + step)) })); return true; }
    if (e.key === ' ' || e.key === 'Enter') {
      const repo = list[Math.min(c.si, list.length - 1)];
      if (repo) updateComposer((x) => toggleSource(x, repo.path));
      else if (!s.library.repos.length) flash('The repo library is empty. Pick its folders from home: Tab, then F.');
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
    return false;
  }
  const rows = goRows(c, s.workspaces, s.nextKey);
  if (step) { updateComposer((x) => ({ ...x, gi: Math.max(0, Math.min(rows.length - 1, x.gi + step)) })); return true; }
  const row = rows[Math.min(c.gi, rows.length - 1)];
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    updateComposer((x) => stepOption(x, row, e.key === 'ArrowRight' ? 1 : -1, s.workspaces, s.nextKey));
    return true;
  }
  if (e.key === 'Enter' && row.id === 'msg') { focusField('cp-msg'); return true; }
  return false;
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

function boardKeys(e: KeyboardEvent): boolean {
  const s = get();
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  const cols = lanes(s.cards, s.line.filter);
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key]) {
    const [dx, dy] = arrows[e.key];
    set({ line: { ...s.line, focus: moveFocus(cols, s.line.focus, dx, dy) } });
    return true;
  }
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (digit && !e.shiftKey) {
    const n = Number(digit[1]);
    const ws = s.workspaces[n - 1];
    if (n && !ws) { flash(`There is no workspace ${n}`); return true; }
    const filter = n === 0 ? 'all' : ws.id;
    const focus = moveFocus(lanes(s.cards, filter), null, 1, 0);
    set({ line: { ...s.line, filter, focus } });
    flash(n === 0 ? 'Every workspace' : ws.name);
    return true;
  }
  const focused = cols.some((l) => l.cards.some((c) => c.id === s.line.focus)) ? s.line.focus : null;
  switch (e.key) {
    case 'Enter': if (focused) openCard(focused); return true;
    case 'c': openComposer(); return true;
    case 'Delete': if (focused) set({ modal: { kind: 'deleteCard', id: focused } }); return true;
    case 'Escape': leaveLine(); return true;
  }
  return false;
}

export function lineKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  if (s.screen !== 'line' || s.modal) return false;
  if (s.composer) return composerKeys(e, typing);
  if (typing) return false;
  if (s.line.drawer) return drawerKeys(e);
  return boardKeys(e);
}

/** Take a card off the line (the Delete dialog's yes). */
export function deleteCard(id: string): void {
  send({ type: 'card.delete', id });
  const s = get();
  const cols = lanes(s.cards.filter((c) => c.id !== id), s.line.filter);
  set({ line: { ...s.line, drawer: s.line.drawer === id ? null : s.line.drawer, focus: s.line.focus === id ? moveFocus(cols, null, 1, 0) : s.line.focus } });
}
