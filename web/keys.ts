// One keydown handler routes every key by modal → screen → focus (home column or session zone),
// so behaviour is deterministic. keymap() is the single source for the `?` overlay and legend.ts
// for the bar at the bottom; add a row to both whenever you add a key. Global shortcuts come
// from bindings.ts so they can be rebound.

import type { PermissionDecision } from '../shared/protocol.ts';
import { workspacesFor } from '../shared/workspaces.ts';
import { ACTIONS, actionFor, bindingsFor, comboOf, displayCombo, type ActionId, type Bindings } from './bindings.ts';
import { cycleGroup, exportPack, exportWorkspace, fireSlot, importPack, importWorkspace } from './commands.ts';
import { sessionsIn } from './home-model.ts';
import { nextTheme, applyTheme, THEME_LABEL } from './theme.ts';
import { cancelVoice, isListening, startVoice, stopVoice } from './voice.ts';
import {
  attention, currentGroup, currentWorkspace, flash, get, HOME_COLS, markRead, pendingFor, sameScope, scopes, sessionById, set, setScope,
  toggleSound, visibleSessions, type HomeCol,
} from './store.ts';
import { lastPermissionAt, send } from './ws.ts';

/** Keys pressed this soon after an approval card appears were aimed at something else. */
const APPROVAL_GRACE_MS = 400;

const FIXED_SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Home',
    keys: [
      ['← →', 'Move between columns: workspaces, sessions, preview'],
      ['↑ ↓  Home End', 'Choose in the current column'],
      ['1–9  /  0', 'Jump to workspace 1–9 / everything outside your workspaces'],
      ['Enter', 'Open the session (in the workspace column: go to its sessions)'],
      ['N', 'New session in this workspace'],
      ['W', 'New workspace'],
      ['E / Delete (workspace column)', 'Edit / delete the workspace'],
      ['Shift+E / Shift+I (workspace column)', 'Export the workspace to share it / import one'],
      ['+', 'Add a repo to this workspace'],
      ['Tab', 'Go to the repo library (Enter adds the repo here, N starts a session in it, F picks the folders it lists)'],
      ['/', 'Filter sessions'],
      ['Y / A / N (preview column)', 'Answer the selected session’s approval without opening it'],
      ['R / X', 'Rename / end the selected session'],
    ],
  },
  {
    title: 'Session',
    keys: [
      ['Enter / Shift+Enter', 'Send / new line (message box)'],
      ['Esc', 'While Claude is working: stop it. Otherwise step out: message box → number pad → home'],
      ['Numpad 0', 'Back to home, even while Claude is working'],
      ['Tab (message box)', 'Go to the number pad or the approval card without stopping Claude'],
      ['i', 'Back to the message box'],
      ['+', 'Give this session another repo to work in'],
      ['PgUp PgDn  Home End', 'Scroll the conversation'],
      ['T', 'Show or hide every step’s details'],
      ['R / X', 'Rename / end the session'],
    ],
  },
  {
    title: 'Approvals',
    keys: [
      ['Y', 'Allow once'],
      ['A', 'Always allow (the card says exactly what)'],
      ['N', 'Don’t allow; Claude tries another way'],
      ['D', 'Show or hide the raw details'],
    ],
  },
  {
    title: 'Number pad (workflows)',
    keys: [
      ['Numpad 1–9', 'Run workflow N (from the message box only while it is empty)'],
      ['Alt+1–9', 'Run workflow N, always'],
      ['Numpad + / −  or  ] / [', 'Next / previous group'],
      ['Numpad /', 'Type a message'],
      ['Numpad *', 'Search everything'],
      ['↑ ↓ ← →  then Enter', 'Move on the pad and run the focused key'],
      ['E', 'Edit the focused key (on a skill: save your own copy)'],
      ['Delete', 'Remove the focused workflow'],
      ['Ctrl+↑ ↓ ← →', 'Move the focused workflow to the neighbouring key'],
      ['Shift+E / Shift+I', 'Export / import your own workflows as JSON'],
    ],
  },
  {
    title: 'Voice (Chrome / Edge)',
    keys: [
      ['Esc (while holding)', 'Cancel without sending'],
      ['Say a workflow’s name', 'Runs it instead of sending the words, e.g. “run the tests”; “slot 3” runs key 3'],
    ],
  },
];

const ACTION_HELP: Partial<Record<ActionId, string>> = {
  nextAttention: 'Jump to the next session that needs you (approvals first, then finished)',
  sound: 'Sound on / off (outside text fields)',
  pushToTalk: 'Push-to-talk: hold, speak, release to send (not while you are mid-message)',
  theme: 'Theme: match Windows → light → dark',
};

/** Help sections with the current bindings filled in. */
export function keymap(overrides: Bindings): { title: string; keys: [string, string][] }[] {
  const row = (id: ActionId): [string, string] => [
    bindingsFor(id, overrides).map(displayCombo).join(' / '),
    ACTION_HELP[id] ?? ACTIONS.find((a) => a.id === id)!.label,
  ];
  const global = ACTIONS.filter((a) => a.id !== 'pushToTalk').map((a) => row(a.id));
  global.push(['B (in this overlay)', 'Change these shortcuts']);
  const sections = [{ title: 'Anywhere', keys: global }, ...FIXED_SECTIONS.map((s) => ({ ...s, keys: [...s.keys] }))];
  const voice = sections.find((x) => x.title.startsWith('Voice'))!;
  voice.keys = [row('pushToTalk'), ...voice.keys];
  return sections;
}

function isTextTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}

// ---- Shared actions -------------------------------------------------------------------

export function openSession(id: string): void {
  const s = get();
  markRead(id);
  // Keep home in step: coming back should show this session in its workspace.
  const session = sessionById(id);
  if (session && !sessionsIn(s.scope, [session], s.workspaces).length) {
    const ws = workspacesFor(session.cwd, s.workspaces)[0];
    setScope(ws ? { kind: 'workspace', id: ws.id } : { kind: 'rest' });
  }
  set({ screen: 'session', openId: id, selectedId: id, zone: pendingFor(id) ? 'board' : 'composer', filterFocused: false, board: null, homeCol: 'sessions' });
  send({ type: 'session.open', id });
  send({ type: 'board.get', sessionId: id });
}

export function backToList(): void {
  set({ screen: 'list', openId: null });
}

export function respondPermission(decision: PermissionDecision, sessionId = get().openId): boolean {
  const req = pendingFor(sessionId);
  if (!req) return false;
  if (performance.now() - lastPermissionAt < APPROVAL_GRACE_MS) return true; // swallow, don't answer
  send({ type: 'permission.respond', reqId: req.reqId, decision });
  return true;
}

/** Claude is mid-turn (including waiting on an approval): Esc stops it, like in Claude Code. */
function isBusy(id: string | null): boolean {
  const status = sessionById(id)?.status;
  return status === 'running' || status === 'requires_action';
}

export function interrupt(id: string | null): void {
  if (!id || !isBusy(id)) return;
  send({ type: 'session.interrupt', id });
  flash('Stopped');
}

export function askStop(id: string | null): void {
  if (sessionById(id)?.live) set({ modal: { kind: 'stop', id: id! } });
}

export function newSession(repo?: string): void {
  const ws = currentWorkspace(get());
  set({ modal: { kind: 'new', workspaceId: ws?.id ?? null, repo } });
}

export function cycleTheme(): void {
  const theme = nextTheme(get().theme);
  applyTheme(theme);
  set({ theme });
  flash(THEME_LABEL[theme]);
}

/** Alt+N: open the next session that needs you, cycling past the one already open. */
export function jumpToAttention(): void {
  const s = get();
  const list = attention(s);
  if (!list.length) { flash('Nothing needs you'); return; }
  const i = list.findIndex((x) => x.id === s.openId);
  openSession(list[(i + 1) % list.length].id);
}

/** Alt+↑ / Alt+↓: previous / next session in the sessions column. */
export function hop(delta: number): void {
  const s = get();
  const list = visibleSessions(s);
  if (!list.length) return;
  const current = s.screen === 'session' ? s.openId : s.selectedId;
  const i = list.findIndex((x) => x.id === current);
  // Not in this list (e.g. filtered out): start from the matching end.
  const from = i < 0 ? (delta > 0 ? -1 : list.length) : i;
  const next = list[(from + delta + list.length) % list.length];
  if (s.screen === 'session') openSession(next.id);
  else selectSession(next.id);
}

function selectSession(id: string): void {
  set({ selectedId: id });
  document.getElementById(`row-${id}`)?.scrollIntoView({ block: 'nearest' });
}

function moveSelection(delta: number | 'first' | 'last'): void {
  const list = visibleSessions(get());
  if (!list.length) return;
  const i = list.findIndex((s) => s.id === get().selectedId);
  const next = delta === 'first' ? 0 : delta === 'last' ? list.length - 1 : Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta));
  selectSession(list[next].id);
}

function moveScope(delta: number): void {
  const s = get();
  const list = scopes(s);
  const i = Math.max(0, list.findIndex((x) => sameScope(x, s.scope)));
  setScope(list[Math.min(list.length - 1, Math.max(0, i + delta))]);
}

/** 1–9 pick workspace N, 0 picks "everything else". */
function scopeByDigit(n: number): void {
  const s = get();
  if (n === 0) { setScope({ kind: 'rest' }); return; }
  const w = s.workspaces[n - 1];
  if (w) setScope({ kind: 'workspace', id: w.id });
  else flash(s.workspaces.length ? `There is no workspace ${n}` : 'No workspaces yet. Press W to make one.');
}

/** The selected session, but only if the column actually shows it. Keys must never act on a hidden row. */
function visibleSelection(): string | null {
  const s = get();
  return visibleSessions(s).some((x) => x.id === s.selectedId) ? s.selectedId : null;
}

function addRepoToWorkspace(): void {
  const ws = currentWorkspace(get());
  if (ws) set({ modal: { kind: 'repoPicker', target: { kind: 'workspace', id: ws.id } } });
  else set({ modal: { kind: 'workspace', id: null } });
}

// ---- Home -------------------------------------------------------------------------------

function moveCol(delta: number): void {
  const col = get().homeCol;
  const i = HOME_COLS.indexOf(col === 'library' ? 'sessions' : col);
  set({ homeCol: HOME_COLS[Math.min(HOME_COLS.length - 1, Math.max(0, i + delta))] });
}

function libraryKeys(e: KeyboardEvent): boolean {
  const s = get();
  const repos = s.library.repos;
  const repo = repos[Math.min(s.libIndex, repos.length - 1)];
  switch (e.key) {
    case 'ArrowLeft': set({ libIndex: Math.max(0, s.libIndex - 1) }); return true;
    case 'ArrowRight': set({ libIndex: Math.min(repos.length - 1, s.libIndex + 1) }); return true;
    case 'ArrowUp': case 'Escape': set({ homeCol: 'sessions' }); return true;
    case 'Home': set({ libIndex: 0 }); return true;
    case 'End': set({ libIndex: Math.max(0, repos.length - 1) }); return true;
    case 'Enter': case '+': case '=': {
      if (!repo) { set({ modal: { kind: 'sources' } }); return true; }
      const ws = currentWorkspace(s);
      if (!ws) { flash('Pick a workspace first (1–9), or press W to make one'); return true; }
      send({ type: 'workspace.addRepo', id: ws.id, path: repo.path });
      flash(`Added ${repo.name} to ${ws.name}`);
      return true;
    }
  }
  switch (e.key.toLowerCase()) {
    case 'n': if (repo) newSession(repo.path); return true;
    case 'f': set({ modal: { kind: 'sources' } }); return true;
  }
  return false;
}

function homeKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  const selected = visibleSelection();
  if (typing) {
    // The filter box: arrows and Enter still drive the list.
    switch (e.key) {
      case 'ArrowUp': moveSelection(-1); return true;
      case 'ArrowDown': moveSelection(1); return true;
      case 'Enter': if (selected) openSession(selected); return true;
      case 'Escape': set({ filter: '', filterFocused: false }); return true;
    }
    return false;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  if (e.key === 'Tab') { set({ homeCol: s.homeCol === 'library' ? 'sessions' : 'library' }); return true; }
  if (s.homeCol === 'library') return libraryKeys(e);

  const digit = /^(Digit|Numpad)(\d)$/.exec(e.code);
  if (digit && !e.shiftKey) { scopeByDigit(Number(digit[2])); return true; }

  const col: HomeCol = s.homeCol;
  switch (e.key) {
    case 'ArrowLeft': moveCol(-1); return true;
    case 'ArrowRight': moveCol(1); return true;
    case 'ArrowUp': if (col === 'workspaces') moveScope(-1); else moveSelection(-1); return true;
    case 'ArrowDown': if (col === 'workspaces') moveScope(1); else moveSelection(1); return true;
    case 'Home': if (col === 'workspaces') moveScope(-99); else moveSelection('first'); return true;
    case 'End': if (col === 'workspaces') moveScope(99); else moveSelection('last'); return true;
    case 'Enter':
      if (col === 'workspaces') set({ homeCol: 'sessions' });
      else if (selected) openSession(selected);
      return true;
    case 'Escape':
      if (s.filter) set({ filter: '' });
      else if (col !== 'sessions') set({ homeCol: 'sessions' });
      return true;
    case '/': set({ filterFocused: true, homeCol: 'sessions' }); return true;
    case '+': case '=': addRepoToWorkspace(); return true;
    case 'Delete':
      if (col === 'workspaces' && s.scope.kind === 'workspace') set({ modal: { kind: 'deleteWorkspace', id: s.scope.id } });
      return true;
  }
  // The preview answers the selected session's approval without opening it.
  if (col === 'preview' && selected && pendingFor(selected)) {
    const decision = ({ y: 'allow', a: 'always', n: 'deny' } as const)[e.key.toLowerCase() as 'y' | 'a' | 'n'];
    if (decision) return respondPermission(decision, selected);
  }
  if (col === 'workspaces' && e.shiftKey) {
    if (e.key === 'E' && s.scope.kind === 'workspace') { exportWorkspace(s.scope.id); return true; }
    if (e.key === 'I') { importWorkspace(); return true; }
  }
  switch (e.key.toLowerCase()) {
    case 'n': newSession(); return true;
    case 'w': set({ modal: { kind: 'workspace', id: null } }); return true;
    case 'e':
      if (col === 'workspaces' && s.scope.kind === 'workspace') set({ modal: { kind: 'workspace', id: s.scope.id } });
      return true;
    case 'r': if (selected) set({ modal: { kind: 'rename', id: selected } }); return true;
    case 'x': askStop(selected); return true;
  }
  return false;
}

// ---- Session: number pad ------------------------------------------------------------------

// The pad is laid out like a numpad: 7 8 9 / 4 5 6 / 1 2 3.
const GRID = [[7, 8, 9], [4, 5, 6], [1, 2, 3]];
const ARROWS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

function neighbour(slot: number, key: string): number {
  const row = GRID.findIndex((r) => r.includes(slot));
  const col = GRID[row].indexOf(slot);
  const [dr, dc] = ARROWS[key];
  return GRID[Math.min(2, Math.max(0, row + dr))][Math.min(2, Math.max(0, col + dc))];
}

function focusedTile() {
  const s = get();
  const { group } = currentGroup(s);
  const command = group?.commands.find((c) => c.slot === s.boardSlot);
  return { s, group, command, editable: group && group.scope !== 'auto' ? group : null };
}

function boardKeys(e: KeyboardEvent): boolean {
  const { s, group, command, editable } = focusedTile();
  if (e.key in ARROWS && !e.altKey && !e.metaKey) {
    const target = neighbour(s.boardSlot, e.key);
    if (e.ctrlKey) {
      if (!editable || !command || target === s.boardSlot) return true;
      const scope = editable.scope as 'workspace' | 'global' | 'repo';
      send({ type: 'command.swap', ref: { scope, cwd: sessionById(s.openId)?.cwd, workspaceId: editable.workspaceId, group: editable.name, slot: s.boardSlot }, otherSlot: target });
    }
    set({ boardSlot: target });
    return true;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  switch (e.key) {
    case 'Enter': fireSlot(s.boardSlot); return true;
    case '[': cycleGroup(-1); return true;
    case ']': cycleGroup(1); return true;
    case 'E': exportPack(); return true;
    case 'I': importPack(); return true;
    case 'e': set({ modal: { kind: 'edit', group, slot: s.boardSlot } }); return true;
    case 'Delete':
    case 'Backspace':
      if (editable && command) set({ modal: { kind: 'delete', group: editable, slot: s.boardSlot } });
      return true;
  }
  return false;
}

/** Approval details (raw command) toggle, read by the card. */
export const approvalDetails = { open: false, listeners: new Set<() => void>() };
function toggleDetails(): void {
  approvalDetails.open = !approvalDetails.open;
  approvalDetails.listeners.forEach((l) => l());
}

function sessionKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  if (s.zone === 'composer') {
    if (e.key === 'Escape') {
      if (isBusy(s.openId)) interrupt(s.openId);
      else set({ zone: 'board' });
      return true;
    }
    // Tab reaches the number pad and any approval card without stopping Claude.
    if (e.key === 'Tab' && !e.shiftKey) { set({ zone: 'board' }); return true; }
    return false; // Enter/Shift+Enter live on the composer itself
  }
  if (typing) return false;
  if (boardKeys(e)) return true;
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  switch (e.key) {
    case 'Escape':
      if (isBusy(s.openId)) interrupt(s.openId);
      else backToList();
      return true;
    case 'PageUp': scrollTranscript(-window.innerHeight * 0.8); return true;
    case 'PageDown': scrollTranscript(window.innerHeight * 0.8); return true;
    case 'Home': scrollTranscript('top'); return true;
    case 'End': scrollTranscript('bottom'); return true;
    case '+': case '=': if (s.openId) set({ modal: { kind: 'repoPicker', target: { kind: 'session', id: s.openId } } }); return true;
  }
  switch (e.key.toLowerCase()) {
    case 'i': set({ zone: 'composer' }); return true;
    case 't': set({ expandTools: !s.expandTools }); return true;
    case 'y': return respondPermission('allow');
    case 'a': return respondPermission('always');
    case 'n': return respondPermission('deny');
    case 'd': if (pendingFor(s.openId)) { toggleDetails(); return true; } return false;
    case 'r': if (s.openId) set({ modal: { kind: 'rename', id: s.openId } }); return true;
    case 'x': askStop(s.openId); return true;
  }
  return false;
}

function scrollTranscript(by: number | 'top' | 'bottom'): void {
  const el = document.getElementById('transcript');
  if (!el) return;
  if (by === 'top') el.scrollTop = 0;
  else if (by === 'bottom') el.scrollTop = el.scrollHeight;
  else el.scrollBy({ top: by });
}

// ---- Voice, numpad, global ----------------------------------------------------------------

const isPushToTalk = (e: KeyboardEvent) => {
  const combo = comboOf(e);
  return combo !== null && actionFor(combo, get().settings.bindings ?? {}) === 'pushToTalk';
};
/** Physical key that started push-to-talk; its keyup ends it even if modifiers were released first. */
let pttCode: string | null = null;

/** Push-to-talk keydown. Same rule as the numpad: voice keys type normally once you've started a message. */
function voiceKeys(e: KeyboardEvent): boolean {
  if (isListening()) {
    if (e.key === 'Escape') { cancelVoice(); return true; }
    return isPushToTalk(e); // swallow auto-repeat of the held key
  }
  const s = get();
  if (!isPushToTalk(e) || s.screen !== 'session' || !s.openId || e.repeat) return false;
  if (s.zone === 'composer' && (s.drafts[s.openId] ?? '').length > 0) return false;
  pttCode = e.code;
  startVoice(s.openId);
  return true;
}

export function onKeyUp(e: KeyboardEvent): void {
  if (isListening() && e.code === pttCode) {
    pttCode = null;
    stopVoice();
    e.preventDefault();
  }
}

/**
 * Numpad and Alt+digit workflow keys in the session view. The numpad acts on the pad
 * unless you're mid-message in the composer, so digits can still be typed there.
 */
function commandKeys(e: KeyboardEvent): boolean {
  const s = get();
  if (s.screen !== 'session' || !s.openId) return false;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (e.altKey && !e.ctrlKey && !e.shiftKey && digit) {
    set({ boardSlot: Number(digit[1]) });
    fireSlot(Number(digit[1]));
    return true;
  }
  if (!e.code.startsWith('Numpad') || e.ctrlKey || e.altKey || e.metaKey) return false;
  if (s.zone === 'composer' && (s.drafts[s.openId] ?? '').length > 0) return false;
  const pad = /^Numpad([1-9])$/.exec(e.code);
  if (pad) {
    set({ boardSlot: Number(pad[1]) });
    fireSlot(Number(pad[1]));
    return true;
  }
  switch (e.code) {
    case 'Numpad0': backToList(); return true;
    case 'NumpadAdd': cycleGroup(1); return true;
    case 'NumpadSubtract': cycleGroup(-1); return true;
    case 'NumpadDivide': set({ zone: 'composer' }); return true;
    case 'NumpadMultiply': set({ modal: { kind: 'palette' } }); return true;
  }
  return false;
}

/** Rebindable shortcuts (see bindings.ts). Actions without a modifier don't fire inside text fields. */
function globalAction(e: KeyboardEvent, typing: boolean): boolean {
  const combo = comboOf(e);
  const id = combo ? actionFor(combo, get().settings.bindings ?? {}) : null;
  if (!id || id === 'pushToTalk') return false;
  if (typing && !ACTIONS.find((a) => a.id === id)!.inText) return false;
  const { openId } = get();
  switch (id) {
    case 'palette': set({ modal: { kind: 'palette' } }); break;
    case 'help': set({ modal: { kind: 'help' } }); break;
    case 'nextAttention': jumpToAttention(); break;
    case 'prevSession': hop(-1); break;
    case 'nextSession': hop(1); break;
    case 'newSession': newSession(); break;
    case 'interrupt': interrupt(openId); break;
    case 'background': if (openId) send({ type: 'session.background', id: openId }); break;
    case 'sound': toggleSound(); break;
    case 'theme': cycleTheme(); break;
  }
  return true;
}

export function onKeyDown(e: KeyboardEvent): void {
  if (e.isComposing) return;
  // A dialog that handles a key may close itself before the event bubbles here; never let that
  // same keypress act on the screen underneath (Enter would fire a key, Esc would leave the session).
  if (e.target instanceof Element && e.target.closest('[role=dialog]')) return;
  const s = get();
  if (s.modal) {
    // Dialogs own their keys; help closes on Esc or ?.
    if (s.modal.kind === 'help') {
      const combo = comboOf(e);
      if (e.key === 'Escape' || (combo && actionFor(combo, s.settings.bindings ?? {}) === 'help')) set({ modal: null });
      else if (e.code === 'KeyB' && !e.ctrlKey && !e.altKey) set({ modal: { kind: 'bindings' } });
      else return;
      e.preventDefault();
    }
    return;
  }
  const typing = isTextTarget(e.target);
  let handled = false;
  if (voiceKeys(e)) handled = true;
  else if (globalAction(e, typing)) handled = true;
  else if (commandKeys(e)) handled = true;
  else if (s.screen === 'session') handled = sessionKeys(e, typing);
  else handled = homeKeys(e, typing);
  if (handled) e.preventDefault();
}
