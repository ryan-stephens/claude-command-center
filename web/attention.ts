// Turns session status transitions into "you're needed" signals: unread marks, a chime and a
// browser notification. Signals are skipped for the session you're actively looking at.

import type { Card } from '../shared/cards.ts';
import type { SessionStatus, SessionSummary } from '../shared/protocol.ts';
import { activeSession, closeComposer, get, markRead, set } from './store.ts';
import { chimeWav } from './chime.ts';

type Kind = 'needs' | 'done';

/** Each chime as a WAV clip, made the first time it plays. */
const clips: Partial<Record<Kind, string>> = {};
let armed = false;
/** The page has had a key or a click: audio may play from now on (the browser's autoplay rule). */
let gestured = false;

/**
 * Browsers only allow audio and the notification prompt after a user gesture, so arm on the first
 * key or click. The chimes are WAV clips an <audio> element plays (§96): making an AudioContext
 * blocked the page for ~200 ms on Windows, on the first key or the first chime.
 */
export function armOnFirstGesture(): void {
  if (armed) return;
  armed = true;
  const arm = () => {
    gestured = true;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
    window.removeEventListener('keydown', arm, true);
    window.removeEventListener('pointerdown', arm, true);
  };
  window.addEventListener('keydown', arm, true);
  window.addEventListener('pointerdown', arm, true);
  // Coming back to the tab counts as seeing the open session.
  window.addEventListener('focus', () => {
    const openId = activeSession(get());
    if (openId) markRead(openId);
  });
}

function isWatching(id: string): boolean {
  const s = get();
  return activeSession(s) === id && document.visibilityState === 'visible' && document.hasFocus();
}

/** Call on every session upsert with the status it had before. */
export function onStatusChange(prev: SessionStatus | undefined, next: SessionSummary): void {
  if (!next.live || prev === next.status) return;
  if (next.status === 'requires_action') signal('needs', next);
  else if (prev === 'running' && next.status === 'idle') {
    if (!isWatching(next.id)) set({ unread: { ...get().unread, [next.id]: Date.now() } });
    signal('done', next);
  }
}

function signal(kind: Kind, s: SessionSummary): void {
  if (isWatching(s.id)) return;
  if (get().sound) chime(kind);
  notify(kind, s);
}

function chime(kind: Kind): void {
  if (!gestured) return;
  // Two rising notes for "needs you", one soft note for "done".
  clips[kind] ??= URL.createObjectURL(new Blob([kind === 'needs' ? chimeWav([660, 880], 0.2) : chimeWav([520], 0.1)], { type: 'audio/wav' }));
  new Audio(clips[kind]).play().catch(() => { /* no sound device, or not allowed yet */ });
}

let openFromNotification: (id: string) => void = () => {};
export function setNotificationHandler(fn: (id: string) => void): void {
  openFromNotification = fn;
}

function notify(kind: Kind, s: SessionSummary): void {
  // Only notify when the page itself isn't in front of you; the chime and badges cover the rest.
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  const n = new Notification(kind === 'needs' ? `Needs you: ${s.title}` : `Done: ${s.title}`, {
    body: kind === 'needs' ? 'Waiting for an approval. Alt+N to jump there.' : 'Finished its turn.',
    tag: `${s.id}:${kind}`,
  });
  n.onclick = () => {
    window.focus();
    openFromNotification(s.id);
    n.close();
  };
}

/**
 * Ticket Line cards: chime and notify when one starts needing you (a plan to
 * approve, a tool to allow, a question) or is ready to try. Skipped while you are looking at that
 * card in the drawer.
 */
export function onCardChange(prev: Card | undefined, next: Card): void {
  if (!prev) return;
  const s = get();
  if (s.screen === 'line' && s.line.drawer === next.id && document.visibilityState === 'visible' && document.hasFocus()) return;
  const needs = next.live?.phase === 'needs' && prev.live?.phase !== 'needs';
  // A QA or review card is done when its report lands (it goes straight to Ship, never Try it).
  const report = Boolean(next.report) && !prev.report;
  const ready = (next.stage === 'try' && prev.stage !== 'try') || report;
  if (!needs && !ready) return;
  const kind: Kind = needs ? 'needs' : 'done';
  if (s.sound) chime(kind);
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  const n = new Notification(`${needs ? 'Needs you' : report ? 'Report ready' : 'Ready to try'}: ${next.key} ${next.title}`, {
    body: needs ? `${next.live?.text ?? ''}. ${next.runner === 'app' ? 'Open the card to answer it.' : `Answer it in its terminal tab, ${next.key}.`}` : report ? 's shows it; Enter copies it.' : 'Its turn finished with changes.',
    tag: `${next.id}:${kind}`,
  });
  n.onclick = () => {
    window.focus();
    closeComposer(); // a half-built card is kept for c
    set({ screen: 'line', openId: null, modal: null, line: { ...get().line, focus: next.id, drawer: next.id } });
    n.close();
  };
}
