import { useEffect } from 'react';
import { Dialogs } from './components/Dialogs.tsx';
import { SessionList } from './components/SessionList.tsx';
import { SessionView } from './components/SessionView.tsx';
import { armOnFirstGesture, setNotificationHandler } from './attention.ts';
import { onKeyDown, onKeyUp, openSession } from './keys.ts';
import { stopVoice } from './voice.ts';
import { attention, set, toggleSound, useStore } from './store.ts';

/** Context-sensitive key hints, so the current keys are always on screen. */
function HintBar() {
  const screen = useStore((s) => s.screen);
  const zone = useStore((s) => s.zone);
  const tab = useStore((s) => s.tab);
  const hints: [string, string][] =
    screen === 'list'
      ? tab === 'inbox'
        ? [['↑↓', 'move'], ['Y/A/N', 'approve'], ['Enter', 'open'], ['Alt+N', 'next'], ['Tab', 'tabs'], ['Alt+Shift+N', 'new']]
        : [['↑↓', 'move'], ['Enter', 'open'], ['/', 'filter'], ['Tab', 'tabs'], ['Alt+N', 'needs you'], ['N', 'new'], ['R', 'rename'], ['X', 'stop']]
      : zone === 'composer'
        ? [['Enter', 'send'], ['Hold `', 'talk (while empty)'], ['Numpad 1–9', 'fire (while empty)'], ['Alt+1–9', 'fire'], ['Esc', 'board'], ['Ctrl+.', 'interrupt']]
        : [['Hold `', 'talk'], ['Numpad 1–9', 'fire'], ['Numpad ±', 'group'], ['←↑↓→ Enter', 'pick'], ['E', 'edit'], ['i', 'compose'], ['Y/A/N', 'approve'], ['PgUp/Dn', 'scroll'], ['Esc', 'list']];
  return (
    <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-800 px-4 py-1.5 text-xs text-zinc-500">
      {hints.map(([k, d]) => <span key={k}><kbd>{k}</kbd> {d}</span>)}
      <span className="ml-auto"><kbd>?</kbd> all keys</span>
    </footer>
  );
}

export function App() {
  const screen = useStore((s) => s.screen);
  const connected = useStore((s) => s.connected);
  const lastError = useStore((s) => s.lastError);
  const flash = useStore((s) => s.flash);
  const sound = useStore((s) => s.sound);
  const waiting = useStore((s) => Object.keys(s.permissions).length);
  const needYou = useStore((s) => attention(s).length);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // Losing focus mid-hold means the keyup never arrives: treat it as a release.
    window.addEventListener('blur', stopVoice);
    armOnFirstGesture();
    setNotificationHandler(openSession);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', stopVoice);
    };
  }, []);

  useEffect(() => {
    document.title = needYou ? `(${needYou}) cc-control` : 'cc-control';
  }, [needYou]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <span className="font-semibold tracking-tight text-zinc-100">cc-control</span>
        {needYou > 0 && (
          <button onClick={() => set({ screen: 'list', openId: null, tab: 'inbox' })} className="rounded bg-amber-900 px-2 py-0.5 text-xs text-amber-200">
            {waiting > 0 ? `${waiting} waiting on you` : `${needYou} finished`} · <kbd>Alt+N</kbd>
          </button>
        )}
        {flash && <span className="text-xs text-sky-300">{flash}</span>}
        {lastError && (
          <button onClick={() => set({ lastError: null })} className="truncate text-xs text-red-400" title="Dismiss">⚠ {lastError}</button>
        )}
        <button onClick={toggleSound} className="ml-auto text-xs text-zinc-500 hover:text-zinc-300" title="Sound (M)">
          {sound ? '♪ sound' : '♪ muted'} <kbd>M</kbd>
        </button>
        <span className={`text-xs ${connected ? 'text-emerald-500' : 'text-red-400'}`}>
          {connected ? '● connected' : '○ reconnecting…'}
        </span>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{screen === 'list' ? <SessionList /> : <SessionView />}</main>
      <HintBar />
      <Dialogs />
    </div>
  );
}
