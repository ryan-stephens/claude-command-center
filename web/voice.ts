// Push-to-talk over the browser's Web Speech API (Chrome/Edge; they send audio to Google's service).
// Hold the key: listen and show the live transcript. Release: stop, then on the recogniser's final
// `end` either fire a matching command or send the text. Esc while holding cancels.

import { fireCommand } from './commands.ts';
import { currentGroup, flash, get, set } from './store.ts';
import { matchUtterance } from './voice-match.ts';
import { send } from './ws.ts';

interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

let rec: Recognition | null = null;
let sessionId: string | null = null;
let holding = false;
let cancelled = false;
let finalText = '';
let interimText = '';

function ctor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function voiceSupported(): boolean {
  return Boolean(ctor());
}

function show(): void {
  set({ voice: { sessionId: sessionId!, state: holding ? 'listening' : 'finishing', text: `${finalText}${interimText}` } });
}

export function startVoice(id: string): void {
  if (holding) return;
  const Ctor = ctor();
  if (!Ctor) {
    flash('Voice needs Chrome or Edge (Web Speech API)');
    return;
  }
  rec?.abort(); // a previous utterance still finishing gives way to the new one
  sessionId = id;
  holding = true;
  cancelled = false;
  finalText = interimText = '';
  const r = new Ctor();
  rec = r;
  r.continuous = true;
  r.interimResults = true;
  r.lang = navigator.language || 'en-US';
  r.onresult = (e) => {
    if (r !== rec) return;
    interimText = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interimText += res[0].transcript;
    }
    show();
  };
  r.onerror = (e) => {
    if (r !== rec || e.error === 'aborted') return;
    // These won't fix themselves; stop, rather than restart from onend while the key is held.
    if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network'].includes(e.error)) holding = false;
    const hint = e.error === 'not-allowed' ? 'Microphone blocked: allow it for this site in the address bar.' : e.error === 'no-speech' ? 'No speech heard.' : `Voice error: ${e.error}`;
    set({ lastError: hint });
  };
  r.onend = () => {
    if (r !== rec) return;
    // Chrome can end a session on its own during a pause; keep listening while the key is held.
    if (holding && !cancelled) {
      try { r.start(); return; } catch { /* fall through and finish */ }
    }
    finish();
  };
  try {
    r.start();
  } catch (e) {
    holding = false;
    set({ lastError: `Voice failed to start: ${(e as Error).message}` });
    return;
  }
  show();
}

export function stopVoice(): void {
  if (!holding) return;
  holding = false;
  show();
  rec?.stop(); // results flush, then onend → finish()
}

export function cancelVoice(): void {
  if (!rec) return;
  cancelled = true;
  holding = false;
  rec.abort();
  finish();
  flash('Voice cancelled');
}

export function isListening(): boolean {
  return holding;
}

function finish(): void {
  const id = sessionId;
  const text = `${finalText}${interimText}`.trim();
  rec = null;
  sessionId = null;
  finalText = interimText = '';
  set({ voice: null });
  if (cancelled || !id || !text) return;
  deliver(id, text);
}

/** Auto-send on release, unless the whole utterance names a command on the board. */
function deliver(id: string, text: string): void {
  const s = get();
  const board = s.board?.sessionId === id ? s.board.groups : [];
  const match = matchUtterance(text, board, currentGroup(s).group);
  if (match.kind === 'command' && match.confident) {
    fireCommand(id, match.command);
  } else if (match.kind === 'command') {
    set({ modal: { kind: 'voiceMatch', sessionId: id, text, command: match.command } });
  } else {
    send({ type: 'session.send', id, text });
    flash('Sent (voice)');
  }
}
