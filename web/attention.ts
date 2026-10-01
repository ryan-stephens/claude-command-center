// Turns session status transitions into "you're needed" signals: unread marks, a chime and a
// browser notification. Signals are skipped for the session you're actively looking at.

import type { Card } from '../shared/cards.ts';
import type { SessionStatus, SessionSummary } from '../shared/protocol.ts';
import { activeSession, get, markRead, set } from './store.ts';

type Kind = 'needs' | 'done';

let audio: AudioContext | null = null;
let armed = false;

/** Browsers only allow audio and the notification prompt after a user gesture, so arm on the first key or click. */
export function armOnFirstGesture(): void {
  if (armed) return;
  armed = true;
  const arm = () => {
    audio ??= new AudioContext();
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
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume();
  // Two rising notes for "needs you", one soft note for "done".
  const notes = kind === 'needs' ? [660, 880] : [520];
  notes.forEach((freq, i) => {
    const t = audio!.currentTime + i * 0.12;
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(kind === 'needs' ? 0.2 : 0.1, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  });
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
 * Ticket Line cards: chime and notify when one starts needing you in its terminal tab (a plan to
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
    body: needs ? `${next.live?.text ?? ''}. Answer it in its terminal tab, ${next.key}.` : report ? 's shows it; Enter copies it.' : 'Its turn finished with changes.',
    tag: `${next.id}:${kind}`,
  });
  n.onclick = () => {
    window.focus();
    set({ screen: 'line', openId: null, composer: null, modal: null, line: { ...get().line, focus: next.id, drawer: next.id, tab: 'over' } });
    n.close();
  };
}
