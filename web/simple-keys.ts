// Keys on the simple look of the new-card screen (PLAN §59). line-keys.ts hands the key here while
// the setting says simple (and the screen is making a card, not adding to one). Every key has a row
// in LINE_SECTIONS and in lineLegendFor.

import { flash, get } from './store.ts';
import { addFolder, cardFolders, composerKey, cycleKind, cycleModel, dropTicket, nextTab, packetRows, pickTicket, repoOrigin, sources, stepOption, ticketSources, togglePacketRow, toggleSource, type Composer, type SourceTab } from './line-model.ts';
import { foundFor, keepRepo, leaveComposer, startWork, updateComposer } from './line-keys.ts';
import { chips, howRows, simpleOf, stepBlock, withSimple } from './simple-model.ts';
import { listFolder, pickFolderOnDisk, send } from './ws.ts';

/** The simple look has no branch choice for Develop: a worktree of each repo, always, so cards never share a checkout. */
export function develop(c: Composer): Composer {
  return c.kind === 'build' && c.launch.branch !== 'worktree' ? { ...c, launch: { ...c.launch, branch: 'worktree' } } : c;
}

/** Is the new-card screen in its simple look right now? (Adding to a running card always uses the full screen.) */
export function simpleLook(): boolean {
  const s = get();
  return Boolean(s.composer && !s.composer.addTo) && (s.settings.newCardLook ?? 'simple') === 'simple';
}

/** Shift+L: the other look, remembered on the server like the other settings. */
export function switchLook(): void {
  const now = get().settings.newCardLook ?? 'simple';
  const next = now === 'simple' ? 'full' : 'simple';
  send({ type: 'settings.set', settings: { ...get().settings, newCardLook: next } });
  flash(next === 'simple' ? 'New card: the simple look (Shift+L for the full one)' : 'New card: the full look (Shift+L for the simple one)');
}

function focusField(id: string): void {
  setTimeout(() => document.getElementById(id)?.focus(), 0);
}

const started = () => new Set(get().cards.map((c) => c.key));

/** Open a picker: context (on the repos tab), or a ticket in place of this one. The search box takes focus. */
export function openPicker(kind: 'context' | 'replace', tab: SourceTab = 'repos'): void {
  updateComposer((x) => withSimple({ ...x, tab: kind === 'replace' ? 'tickets' : tab, q: '' }, { adding: kind, ai: 0 }));
  focusField('cp-q');
}

export function closePicker(): void {
  updateComposer((x) => withSimple({ ...x, q: '' }, { adding: null, ai: 0 }));
}

/** ← → (or Tab in the search box) in the context picker: Repos, Folders, Tickets. */
export function pickerTab(delta: number): void {
  updateComposer((x) => withSimple({ ...x, tab: nextTab(x.tab, delta), q: '' }, { ai: 0 }));
  focusField('cp-q');
}

export interface PickerRow { id: string; label: string; sub: string; /** Already in the card (Enter takes it out again). */ in?: boolean; /** A ticket row: its key, shown as a badge before the title. */ key?: string }

/** The picker chooses one ticket (in place of this card's, or a card with none yet) rather than ticking several. */
export function singlePick(c: Composer): boolean {
  const a = simpleOf(c).adding;
  return a === 'replace' || (a === 'ticket' && !c.ticket);
}

/** The rows the open picker lists, with what the card already has marked. */
export function pickerList(c: Composer): PickerRow[] {
  const s = get();
  const sp = simpleOf(c);
  if (!sp.adding) return [];
  const tab: SourceTab = sp.adding === 'context' ? c.tab : 'tickets';
  if (tab === 'repos') {
    return sources(c, s.library.repos).map((r) => {
      const where = repoOrigin(c, r.path);
      const on = where === 'workspace' ? c.packet.workspace.find((x) => x.id === r.path)?.on !== false : where === 'card';
      return { id: r.path, label: r.name, sub: where === 'workspace' ? (on ? 'workspace' : 'lane · left out') : where === 'card' ? 'added' : r.branch ?? '', in: Boolean(on) };
    });
  }
  if (tab === 'folders') {
    // Folders browsed in from disk (a repo belongs on the Repos tab), then the way to add another. A folder left out stays listed, unticked.
    return cardFolders(c, s.library.repos).map((i) => ({ id: i.id, label: i.label, sub: i.on ? i.id : `left out · ${i.id}`, in: i.on }));
  }
  const one = singlePick(c);
  return ticketSources(c, s.tickets, started(), foundFor(s, c.q))
    .filter((t) => !(one && c.ticket?.key === t.key)) // choosing another: this card's own is not a choice
    .map((t) => {
      const own = c.ticket?.key === t.key;
      const related = c.packet.card.some((x) => x.id === `ticket:${t.key}`);
      return { id: t.key, key: t.key, label: t.title, sub: own ? 'this card’s' : related ? 'related' : t.found ? 'found in Jira' : t.status, in: !one && (own || related) };
    });
}

/** The Folders tab's box: the path typed or pasted there joins the card once the server confirms the folder exists. */
export function addTypedFolder(): void {
  const c = get().composer;
  if (!c) return;
  const path = c.q.trim().replace(/^"(.*)"$/, '$1').replace(/[\\/]+$/, '');
  if (!path) { flash('Type or paste a folder path first, or browse for one.'); return; }
  listFolder(path).then(
    (l) => {
      if (!l.path) { flash(`Not a folder on this machine: ${path}`); return; }
      updateComposer((x) => { const r = addFolder(x, l.path!); return typeof r === 'string' ? r : withSimple({ ...r, q: '' }, { ai: pickerList(r).length - 1 }); });
    },
    (e: Error) => flash(e.message),
  );
}

let browsing = false;

/** Browse for a folder: the machine's own dialog opens (the server runs here); the folder chosen joins the card. */
export function browseFolder(): void {
  if (browsing) { flash('The folder dialog is already open: it may be behind this window.'); return; }
  browsing = true;
  flash('Pick the folder in the Windows dialog (it may open behind this window)');
  pickFolderOnDisk().then(
    (path) => {
      browsing = false;
      if (!path) return;
      updateComposer((x) => { const r = addFolder(x, path); return typeof r === 'string' ? r : r; });
      const c = get().composer;
      if (c && simpleOf(c).adding === 'context') updateComposer((x) => withSimple(x, { ai: pickerList(x).length - 1 }));
    },
    (e: Error) => { browsing = false; flash(e.message); },
  );
}

/**
 * Enter or Space on a picker row. Context: a repo is added or taken out again, a folder row opens
 * the folder picker (or takes the folder out), a ticket becomes related (the picker stays open for
 * more; Esc closes it). Replacing: the ticket becomes the card's.
 */
export function pickAt(c: Composer, at: number, remove = false): void {
  const s = get();
  const sp = simpleOf(c);
  const tab: SourceTab = sp.adding === 'context' ? c.tab : 'tickets';
  if (tab === 'repos') {
    const r = sources(c, s.library.repos)[at];
    if (!r) { if (!s.library.repos.length) flash('The repo library is empty. On the board, F picks the folders it scans.'); return; }
    updateComposer((x) => toggleSource(x, r.path));
    return;
  }
  if (tab === 'folders') {
    const f = cardFolders(c, s.library.repos)[at];
    if (f) updateComposer((x) => togglePacketRow(x, packetRows(x).findIndex((r) => r.layer === 'card' && r.item.id === f.id), remove));
    else if (c.q.trim()) addTypedFolder();
    return;
  }
  const t = ticketSources(c, s.tickets, started(), foundFor(s, c.q))[at];
  if (!t) { if (!s.tickets.length) flash('No tickets yet. Shift+T on the board connects them, or shows demo tickets.'); return; }
  updateComposer((x) => {
    if (sp.adding === 'context' && x.packet.card.some((i) => i.id === `ticket:${t.key}`)) {
      // Already related: Enter takes it out again.
      const row = x.packet.card.findIndex((i) => i.id === `ticket:${t.key}`);
      return { ...x, packet: { ...x.packet, card: x.packet.card.filter((_, i) => i !== row) } };
    }
    const base = sp.adding === 'replace' ? dropTicket(x, s.nextKey) : x;
    const r = pickTicket(base, t, s.workspaces, started(), s.recipes);
    if (typeof r === 'string') return r;
    // A card with no ticket takes the first as its own and the search closes; otherwise the picker stays for more.
    const closes = sp.adding !== 'context' || !x.ticket;
    return closes ? withSimple({ ...r, q: '' }, { adding: null, ai: 0, block: sp.adding === 'replace' ? 'ticket' : 'context' }) : r;
  });
}

/** Enter or Space on a chip: the add chip opens the context picker; a workspace item is included or left out; the card's own is toggled too (x removes it). */
function actChip(c: Composer, remove = false): void {
  const s = get();
  const list = chips(c, s.library.repos);
  const chip = list[Math.min(simpleOf(c).ci, list.length - 1)];
  if (!chip) return;
  if (chip.kind === 'add') { if (!remove) openPicker('context'); return; }
  updateComposer((x) => {
    const r = togglePacketRow(x, chip.row, remove && chip.own);
    if (typeof r === 'string') return r;
    const n = chips(r, s.library.repos).length;
    return withSimple(r, { ci: Math.min(simpleOf(r).ci, Math.max(0, n - 1)) });
  });
}

/** A text field on the simple screen has focus. */
function simpleTyping(e: KeyboardEvent, c: Composer): boolean {
  const el = e.target as HTMLElement;
  const sp = simpleOf(c);
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { el.blur(); startWork(); return true; }
  if (e.key === 'Escape') { el.blur(); return true; }
  if (e.key === 'Tab') {
    el.blur();
    if (sp.adding === 'context') pickerTab(e.shiftKey ? -1 : 1);
    else if (!sp.adding) updateComposer((x) => stepBlock(x, e.shiftKey ? -1 : 1));
    return true;
  }
  if (el.id === 'cp-q') {
    // The Folders tab's box is a path: Enter adds it. Elsewhere Enter picks the highlighted row.
    if (e.key === 'Enter' && sp.adding === 'context' && c.tab === 'folders') { addTypedFolder(); return true; }
    if (e.key === 'Enter') { pickAt(c, sp.ai); return true; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const n = pickerList(c).length;
      updateComposer((x) => withSimple(x, { ai: Math.max(0, Math.min(n - 1, simpleOf(x).ai + (e.key === 'ArrowDown' ? 1 : -1))) }));
      return true;
    }
    return false;
  }
  if (e.key === 'Enter' && el.tagName === 'INPUT') { el.blur(); return true; }
  return false;
}

export function simpleKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  const c = s.composer!;
  const sp = simpleOf(c);
  if (typing) return simpleTyping(e, c);
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { startWork(); return true; }
  if (e.key === 'L' && e.shiftKey && !e.ctrlKey && !e.altKey) { switchLook(); return true; }
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  if (e.key === 'Escape') {
    if (sp.adding) closePicker();
    else if (c.preview) updateComposer((x) => ({ ...x, preview: false }));
    else if (sp.more) updateComposer((x) => withSimple(x, { more: false }));
    else leaveComposer();
    return true;
  }
  if (e.key === 'p') { updateComposer((x) => ({ ...x, preview: !x.preview })); return true; }
  if (e.key === 'k') { updateComposer((x) => develop(cycleKind(x, composerKey(x, s.nextKey), s.workspaces, s.recipes))); return true; }
  if (e.key === 'm') { updateComposer(cycleModel); return true; }
  const up = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey);
  const down = e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey);
  const step = up ? -1 : down ? 1 : 0;
  // A picker is open: it takes the keys.
  if (sp.adding) {
    const n = pickerList(c).length;
    if (step) { updateComposer((x) => withSimple(x, { ai: Math.max(0, Math.min(n - 1, simpleOf(x).ai + step)) })); return true; }
    if (sp.adding === 'context' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { pickerTab(e.key === 'ArrowRight' ? 1 : -1); return true; }
    if (e.key === '/') { focusField('cp-q'); return true; }
    if (e.key === 'Enter' || e.key === ' ') { pickAt(c, sp.ai); return true; }
    if ((e.key === 'x' || e.key === 'Delete') && c.tab === 'folders') { pickAt(c, sp.ai, true); return true; }
    if (e.key === 'b' && sp.adding === 'context' && c.tab === 'folders') { browseFolder(); return true; }
    return false;
  }
  if (c.preview) return false;
  const key = composerKey(c, s.nextKey);
  // How it starts, opened: ↑ ↓ walk its rows and leave at the ends; ← → change the option.
  if (sp.block === 'how' && sp.more) {
    const rows = howRows(c, s.workspaces, key, { pinned: s.cardModel, user: s.userModel });
    const gi = Math.min(c.gi, rows.length - 1);
    if (step) {
      const next = gi + step;
      if (next < 0) updateComposer((x) => withSimple(x, { block: 'note' }));
      else if (next >= rows.length) updateComposer((x) => withSimple(x, { block: 'start' }));
      else updateComposer((x) => ({ ...x, gi: next }));
      return true;
    }
    const row = rows[gi];
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { updateComposer((x) => stepOption(x, row, e.key === 'ArrowRight' ? 1 : -1, s.workspaces, key, s.recipes)); return true; }
    if (e.key === 'Enter' && row?.id === 'msg') { focusField('cp-msg'); return true; }
    if (e.key === 'Enter') { updateComposer((x) => withSimple(x, { more: false })); return true; }
    return false;
  }
  if (step) {
    // Into the opened options from above: start on their first row.
    updateComposer((x) => { const n = stepBlock(x, step); return simpleOf(n).block === 'how' && simpleOf(n).more ? { ...n, gi: step > 0 ? 0 : howRows(n, s.workspaces, key).length - 1 } : n; });
    return true;
  }
  switch (sp.block) {
    case 'ticket':
      if (e.key === 'Enter' || e.key === ' ') { if (c.ticket) openPicker('replace'); else focusField('cp-q'); return true; }
      if ((e.key === 'x' || e.key === 'Delete') && c.ticket) { updateComposer((x) => dropTicket(x, s.nextKey)); return true; }
      if (e.key === '/') { if (!c.ticket) focusField('cp-q'); else openPicker('replace'); return true; }
      return false;
    case 'context': {
      const n = chips(c, s.library.repos).length;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { updateComposer((x) => withSimple(x, { ci: Math.max(0, Math.min(n - 1, simpleOf(x).ci + (e.key === 'ArrowRight' ? 1 : -1))) })); return true; }
      if (e.key === 'Enter' || e.key === ' ') { actChip(c); return true; }
      if (e.key === '+' || e.key === 'a') { openPicker('context'); return true; }
      if (e.key === 'x' || e.key === 'Delete') { actChip(c, true); return true; }
      if (e.key === 'w') { const chip = chips(c, s.library.repos)[sp.ci]; if (chip?.own && chip.kind === 'repo') keepRepo(chip.row); else flash('Only a repo you added to this card can be kept for the lane.'); return true; }
      return false;
    }
    case 'note':
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'e') { focusField('cp-note'); return true; }
      return false;
    case 'how':
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { updateComposer((x) => withSimple({ ...x, gi: 0 }, { more: true })); return true; }
      return false;
    case 'start':
      if (e.key === 'Enter' || e.key === ' ') { startWork(); return true; }
      return false;
  }
  return false;
}
