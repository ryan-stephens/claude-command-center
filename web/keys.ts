// One keydown handler routes every key by modal → screen → focus zone, so behaviour is deterministic.
// keymap() is the single source for the `?` overlay; add a row whenever you add a key. Global shortcuts
// come from bindings.ts so they can be rebound.

import type { PermissionDecision } from '../shared/protocol.ts';
import { ACTIONS, actionFor, bindingsFor, comboOf, displayCombo, type ActionId, type Bindings } from './bindings.ts';
import { cycleGroup, exportPack, fireSlot, importPack } from './commands.ts';
import { cancelVoice, isListening, startVoice, stopVoice } from './voice.ts';
import { attention, currentGroup, flash, get, markRead, pendingFor, sessionById, set, TABS, toggleSound, visibleSessions } from './store.ts';
import { lastPermissionAt, send } from './ws.ts';

/** Keys pressed this soon after an approval card appears were aimed at something else. */
const APPROVAL_GRACE_MS = 400;

const FIXED_SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Session list',
    keys: [
      ['↑ ↓  Home End', 'Move selection'],
      ['Enter', 'Open session'],
      ['/', 'Filter by title, repo, branch or status'],
      ['Esc', 'Clear the filter'],
      ['Tab', 'Cycle Inbox / Live / History'],
      ['Y / A / N', 'Inbox: answer the selected approval without opening it'],
      ['N', 'New session (outside the Inbox)'],
      ['R', 'Rename session'],
      ['X', 'Stop a live session'],
    ],
  },
  {
    title: 'Session view',
    keys: [
      ['Enter / Shift+Enter', 'Send / newline (composer)'],
      ['Esc or Numpad 0', 'Step out: composer → board → list'],
      ['i', 'Focus the composer'],
      ['PgUp PgDn  Home End', 'Scroll the transcript'],
      ['T', 'Expand / collapse tool calls'],
      ['Y / A / N', 'Approval: yes once / always / no'],
      ['R / X', 'Rename / stop the session'],
    ],
  },
  {
    title: 'Command board',
    keys: [
      ['Numpad 1–9', 'Fire command N in the current group (from the composer only while it is empty)'],
      ['Alt+1–9', 'Fire command N, always'],
      ['Numpad + / −  or  ] / [', 'Next / previous group'],
      ['↑ ↓ ← →  then Enter', 'Move on the board (laid out like the numpad) and fire'],
      ['E', 'Edit the focused tile (on a slash command: copy it into your own group)'],
      ['Delete', 'Remove the focused command'],
      ['Ctrl+↑ ↓ ← →', 'Move the focused command to the neighbouring slot'],
      ['Shift+E / Shift+I', 'Export / import your global commands as JSON'],
    ],
  },
  {
    title: 'Voice (Chrome / Edge)',
    keys: [
      ['Esc (while holding)', 'Cancel without sending'],
      ['Say a command label', 'Fires it instead of sending text, e.g. "code review"; "slot 3" fires slot 3'],
    ],
  },
];

const ACTION_HELP: Partial<Record<ActionId, string>> = {
  nextAttention: 'Jump to the next session that needs you (approvals first, then finished)',
  sound: 'Sound on / off (outside text fields)',
  pushToTalk: 'Push-to-talk: hold, speak, release to send (not while you are mid-message)',
};

/** Help sections with the current bindings filled in. */
export function keymap(overrides: Bindings): { title: string; keys: [string, string][] }[] {
  const row = (id: ActionId): [string, string] => [
    bindingsFor(id, overrides).map(displayCombo).join(' / '),
    ACTION_HELP[id] ?? ACTIONS.find((a) => a.id === id)!.label,
  ];
  const global = ACTIONS.filter((a) => a.id !== 'pushToTalk').map((a) => row(a.id));
  global.push(['B (in this overlay)', 'Change these shortcuts']);
  const sections = [{ title: 'Global', keys: global }, ...FIXED_SECTIONS];
  const voice = sections.find((x) => x.title.startsWith('Voice'))!;
  voice.keys = [row('pushToTalk'), ...voice.keys];
  return sections;
}

function isTextTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}

export function openSession(id: string): void {
  markRead(id);
  set({ screen: 'session', openId: id, selectedId: id, zone: pendingFor(id) ? 'board' : 'composer', filterFocused: false, board: null });
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

function moveSelection(delta: number | 'first' | 'last'): void {
  const list = visibleSessions(get());
  if (!list.length) return;
  const i = list.findIndex((s) => s.id === get().selectedId);
  const next = delta === 'first' ? 0 : delta === 'last' ? list.length - 1 : Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta));
  set({ selectedId: list[next].id });
  document.getElementById(`row-${list[next].id}`)?.scrollIntoView({ block: 'nearest' });
}

function hop(delta: number): void {
  const s = get();
  const list = visibleSessions(s);
  if (!list.length) return;
  const current = s.screen === 'session' ? s.openId : s.selectedId;
  const i = list.findIndex((x) => x.id === current);
  // Not in this list (e.g. read and gone from the Inbox): start from the matching end.
  const from = i < 0 ? (delta > 0 ? -1 : list.length) : i;
  const next = list[(from + delta + list.length) % list.length];
  if (s.screen === 'session') openSession(next.id);
  else moveSelection(delta);
}

export { jumpToAttention, hop, askStop };

/** Alt+N: open the next session that needs you, cycling past the one already open. */
function jumpToAttention(): void {
  const s = get();
  const list = attention(s);
  if (!list.length) { flash('Nothing needs you'); return; }
  const i = list.findIndex((x) => x.id === s.openId);
  openSession(list[(i + 1) % list.length].id);
}

function scrollTranscript(by: number | 'top' | 'bottom'): void {
  const el = document.getElementById('transcript');
  if (!el) return;
  if (by === 'top') el.scrollTop = 0;
  else if (by === 'bottom') el.scrollTop = el.scrollHeight;
  else el.scrollBy({ top: by });
}

function askStop(id: string | null): void {
  if (sessionById(id)?.live) set({ modal: { kind: 'stop', id: id! } });
}

/** The selected row, but only if the current tab and filter actually show it. Keys must never act on a hidden row. */
function visibleSelection(): string | null {
  const s = get();
  return visibleSessions(s).some((x) => x.id === s.selectedId) ? s.selectedId : null;
}

function listKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  const selected = visibleSelection();
  switch (e.key) {
    case 'ArrowUp': moveSelection(-1); return true;
    case 'ArrowDown': moveSelection(1); return true;
    case 'Enter': if (selected) openSession(selected); return true;
    case 'Tab': {
      const step = e.shiftKey ? TABS.length - 1 : 1;
      set({ tab: TABS[(TABS.indexOf(s.tab) + step) % TABS.length] });
      queueMicrotask(() => moveSelection('first'));
      return true;
    }
    case 'Escape': set({ filter: '', filterFocused: false }); return true;
  }
  if (typing) return false;
  switch (e.key) {
    case 'Home': moveSelection('first'); return true;
    case 'End': moveSelection('last'); return true;
    case '/': set({ filterFocused: true }); return true;
  }
  if (s.tab === 'inbox' && selected && pendingFor(selected)) {
    const decision = ({ y: 'allow', a: 'always', n: 'deny' } as const)[e.key.toLowerCase() as 'y' | 'a' | 'n'];
    if (decision) return respondPermission(decision, selected);
  }
  switch (e.key.toLowerCase()) {
    case 'n': if (s.tab !== 'inbox') set({ modal: { kind: 'new' } }); return true;
    case 'r': if (selected) set({ modal: { kind: 'rename', id: selected } }); return true;
    case 'x': askStop(selected); return true;
  }
  return false;
}

// The board is laid out like a numpad: 7 8 9 / 4 5 6 / 1 2 3.
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
      const scope = editable.scope as 'global' | 'repo';
      send({ type: 'command.swap', ref: { scope, cwd: sessionById(s.openId)?.cwd, group: editable.name, slot: s.boardSlot }, otherSlot: target });
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

function sessionKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  if (s.zone === 'composer') {
    if (e.key === 'Escape') { set({ zone: 'board' }); return true; }
    return false; // Enter/Shift+Enter live on the composer itself
  }
  if (typing) return false;
  if (boardKeys(e)) return true;
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  switch (e.key) {
    case 'Escape': backToList(); return true;
    case 'PageUp': scrollTranscript(-window.innerHeight * 0.8); return true;
    case 'PageDown': scrollTranscript(window.innerHeight * 0.8); return true;
    case 'Home': scrollTranscript('top'); return true;
    case 'End': scrollTranscript('bottom'); return true;
  }
  switch (e.key.toLowerCase()) {
    case 'i': set({ zone: 'composer' }); return true;
    case 't': set({ expandTools: !s.expandTools }); return true;
    case 'y': return respondPermission('allow');
    case 'a': return respondPermission('always');
    case 'n': return respondPermission('deny');
    case 'r': if (s.openId) set({ modal: { kind: 'rename', id: s.openId } }); return true;
    case 'x': askStop(s.openId); return true;
  }
  return false;
}

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
 * Numpad and Alt+digit command keys in the session view. The numpad acts on the board
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
    case 'Numpad0':
      if (s.zone === 'composer') set({ zone: 'board' });
      else backToList();
      return true;
    case 'NumpadAdd': cycleGroup(1); return true;
    case 'NumpadSubtract': cycleGroup(-1); return true;
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
    case 'newSession': set({ modal: { kind: 'new' } }); break;
    case 'interrupt': if (openId) send({ type: 'session.interrupt', id: openId }); break;
    case 'sound': toggleSound(); break;
  }
  return true;
}

export function onKeyDown(e: KeyboardEvent): void {
  if (e.isComposing) return;
  // A dialog that handles a key may close itself before the event bubbles here; never let that
  // same keypress act on the screen underneath (Enter would fire a tile, Esc would leave the session).
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
  else if (e.ctrlKey || e.metaKey || e.altKey) return;
  else handled = listKeys(e, typing);
  if (handled) e.preventDefault();
}
