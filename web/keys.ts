// One keydown handler routes every key by modal → screen → focus zone, so behaviour is deterministic.
// KEYMAP is the single source for the `?` overlay and the hint bar; add a row whenever you add a key.

import type { PermissionDecision } from '../shared/protocol.ts';
import { get, pendingFor, sessionById, set, visibleSessions } from './store.ts';
import { send } from './ws.ts';

export const KEYMAP: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Global',
    keys: [
      ['?', 'Keyboard help'],
      ['Alt+↑ / Alt+↓', 'Previous / next session, from anywhere'],
      ['Alt+Shift+N', 'New session'],
      ['Ctrl+.', 'Interrupt the open session'],
    ],
  },
  {
    title: 'Session list',
    keys: [
      ['↑ ↓  Home End', 'Move selection'],
      ['Enter', 'Open session'],
      ['/', 'Filter by title, repo, branch or status'],
      ['Esc', 'Clear the filter'],
      ['Tab', 'Switch Live / History'],
      ['N', 'New session'],
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
  set({ screen: 'session', openId: id, selectedId: id, zone: pendingFor(id) ? 'transcript' : 'composer', filterFocused: false });
  send({ type: 'session.open', id });
}

export function backToList(): void {
  set({ screen: 'list', openId: null });
}

export function respondPermission(decision: PermissionDecision): boolean {
  const req = pendingFor(get().openId);
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

function listKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  switch (e.key) {
    case 'ArrowUp': moveSelection(-1); return true;
    case 'ArrowDown': moveSelection(1); return true;
    case 'Enter': if (s.selectedId) openSession(s.selectedId); return true;
    case 'Tab': set({ tab: s.tab === 'live' ? 'history' : 'live' }); queueMicrotask(() => moveSelection('first')); return true;
    case 'Escape': set({ filter: '', filterFocused: false }); return true;
  }
  if (typing) return false;
  switch (e.key) {
    case 'Home': moveSelection('first'); return true;
    case 'End': moveSelection('last'); return true;
    case '/': set({ filterFocused: true }); return true;
  }
  switch (e.key.toLowerCase()) {
    case 'n': set({ modal: { kind: 'new' } }); return true;
    case 'r': if (s.selectedId) set({ modal: { kind: 'rename', id: s.selectedId } }); return true;
    case 'x': askStop(s.selectedId); return true;
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
  else if (e.altKey && e.shiftKey && e.code === 'KeyN') { set({ modal: { kind: 'new' } }); handled = true; }
  else if (e.ctrlKey && e.key === '.') { if (s.openId) send({ type: 'session.interrupt', id: s.openId }); handled = true; }
  else if (!typing && e.key === '?') { set({ modal: { kind: 'help' } }); handled = true; }
  else if (e.ctrlKey || e.metaKey || e.altKey) return;
  else handled = s.screen === 'list' ? listKeys(e, typing) : sessionKeys(e, typing);
  if (handled) e.preventDefault();
}
