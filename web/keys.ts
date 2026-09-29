// One keydown handler routes every key by modal → screen → focus zone, so behaviour is deterministic.
// KEYMAP is the single source for the `?` overlay and the hint bar; add a row whenever you add a key.

import type { PermissionDecision } from '../shared/protocol.ts';
import { attention, flash, get, markRead, pendingFor, sessionById, set, TABS, toggleSound, visibleSessions } from './store.ts';
import { send } from './ws.ts';

export const KEYMAP: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Global',
    keys: [
      ['?', 'Keyboard help'],
      ['Alt+N', 'Jump to the next session that needs you (approvals first, then finished)'],
      ['Alt+↑ / Alt+↓', 'Previous / next session, from anywhere'],
      ['Alt+Shift+N', 'New session'],
      ['Ctrl+.', 'Interrupt the open session'],
      ['M', 'Sound on / off (outside text fields)'],
    ],
  },
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
      ['Esc', 'Step out: composer → transcript → list'],
      ['i or Enter', 'Focus the composer (transcript)'],
      ['↑ ↓  PgUp PgDn  Home End', 'Scroll the transcript'],
      ['T', 'Expand / collapse tool calls'],
      ['Y / A / N', 'Approval: yes once / always / no'],
      ['R / X', 'Rename / stop (transcript)'],
    ],
  },
];

function isTextTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}

export function openSession(id: string): void {
  markRead(id);
  set({ screen: 'session', openId: id, selectedId: id, zone: pendingFor(id) ? 'transcript' : 'composer', filterFocused: false });
  send({ type: 'session.open', id });
}

export function backToList(): void {
  set({ screen: 'list', openId: null });
}

export function respondPermission(decision: PermissionDecision, sessionId = get().openId): boolean {
  const req = pendingFor(sessionId);
  if (!req) return false;
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
  const next = list[(i + delta + list.length) % list.length];
  if (s.screen === 'session') openSession(next.id);
  else moveSelection(delta);
}

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
    case 'm': toggleSound(); return true;
    case 'n': if (s.tab !== 'inbox') set({ modal: { kind: 'new' } }); return true;
    case 'r': if (selected) set({ modal: { kind: 'rename', id: selected } }); return true;
    case 'x': askStop(selected); return true;
  }
  return false;
}

function sessionKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  if (s.zone === 'composer') {
    if (e.key === 'Escape') { set({ zone: 'transcript' }); return true; }
    return false; // Enter/Shift+Enter live on the composer itself
  }
  if (typing) return false;
  switch (e.key) {
    case 'Escape': backToList(); return true;
    case 'Enter': set({ zone: 'composer' }); return true;
    case 'ArrowUp': scrollTranscript(-80); return true;
    case 'ArrowDown': scrollTranscript(80); return true;
    case 'PageUp': scrollTranscript(-window.innerHeight * 0.8); return true;
    case 'PageDown': scrollTranscript(window.innerHeight * 0.8); return true;
    case 'Home': scrollTranscript('top'); return true;
    case 'End': scrollTranscript('bottom'); return true;
  }
  switch (e.key.toLowerCase()) {
    case 'i': set({ zone: 'composer' }); return true;
    case 't': set({ expandTools: !s.expandTools }); return true;
    case 'm': toggleSound(); return true;
    case 'y': return respondPermission('allow');
    case 'a': return respondPermission('always');
    case 'n': return respondPermission('deny');
    case 'r': if (s.openId) set({ modal: { kind: 'rename', id: s.openId } }); return true;
    case 'x': askStop(s.openId); return true;
  }
  return false;
}

export function onKeyDown(e: KeyboardEvent): void {
  if (e.isComposing) return;
  const s = get();
  if (s.modal) {
    // Dialogs own their keys; help closes on Esc or ?.
    if (s.modal.kind === 'help' && (e.key === 'Escape' || e.key === '?')) { set({ modal: null }); e.preventDefault(); }
    return;
  }
  const typing = isTextTarget(e.target);
  let handled = false;
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { hop(e.key === 'ArrowUp' ? -1 : 1); handled = true; }
  else if (e.altKey && !e.shiftKey && e.code === 'KeyN') { jumpToAttention(); handled = true; }
  else if (e.altKey && e.shiftKey && e.code === 'KeyN') { set({ modal: { kind: 'new' } }); handled = true; }
  else if (e.ctrlKey && e.key === '.') { if (s.openId) send({ type: 'session.interrupt', id: s.openId }); handled = true; }
  else if (!typing && e.key === '?') { set({ modal: { kind: 'help' } }); handled = true; }
  else if (e.ctrlKey || e.metaKey || e.altKey) return;
  else handled = s.screen === 'list' ? listKeys(e, typing) : sessionKeys(e, typing);
  if (handled) e.preventDefault();
}
