import { useEffect } from 'react';
import { Dialogs } from './components/Dialogs.tsx';
import { SessionList } from './components/SessionList.tsx';
import { SessionView } from './components/SessionView.tsx';
import { armOnFirstGesture, setNotificationHandler } from './attention.ts';
import { bindingsFor, displayCombo, type ActionId } from './bindings.ts';
import { onKeyDown, onKeyUp, openSession } from './keys.ts';
import { stopVoice } from './voice.ts';
import { maybeShowWelcome } from './components/Welcome.tsx';
import { attention, NO_BINDINGS, set, toggleSound, useStore } from './store.ts';

/** Context-sensitive key hints, so the current keys are always on screen. */
function HintBar() {
  const screen = useStore((s) => s.screen);
  const zone = useStore((s) => s.zone);
  const tab = useStore((s) => s.tab);
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  const busy = useStore((s) => {
    const status = s.sessions.find((x) => x.id === s.openId)?.status;
    return status === 'running' || status === 'requires_action';
  });
  // Rebindable keys show their current binding (first one if several).
  const k = (id: ActionId) => displayCombo(bindingsFor(id, bindings)[0] ?? '');
  const talk = `Hold ${k('pushToTalk')}`;
  const hints: [string, string][] =
    screen === 'list'
      ? tab === 'inbox'
        ? [['↑↓', 'move'], ['Y/A/N', 'approve'], ['Enter', 'open'], [k('nextAttention'), 'next'], ['Tab', 'tabs'], [k('newSession'), 'new']]
        : [['↑↓', 'move'], ['Enter', 'open'], ['/', 'filter'], ['Tab', 'tabs'], [k('nextAttention'), 'needs you'], ['N', 'new'], ['R', 'rename'], ['X', 'stop']]
      : zone === 'composer'
        ? [['Enter', 'send'], busy ? ['Esc', 'stop Claude'] : ['Esc', 'board'], ['Tab', 'board'], [talk, 'talk (while empty)'], ['Numpad 1–9', 'fire (while empty)'], ['Alt+1–9', 'fire']]
        : [busy ? ['Esc', 'stop Claude'] : ['Esc', 'list'], [talk, 'talk'], ['Numpad 1–9', 'fire'], ['Numpad ±', 'group'], ['←↑↓→ Enter', 'pick'], ['E', 'edit'], ['i', 'compose'], ['Y/A/N', 'approve'], ['PgUp/Dn', 'scroll']];
  return (
    <footer className="hidden flex-wrap gap-x-4 gap-y-1 border-t border-zinc-800 px-4 py-1.5 text-xs text-zinc-500 md:flex">
      {hints.map(([key, d]) => <span key={key}><kbd>{key}</kbd> {d}</span>)}
      <span className="ml-auto"><kbd>{k('palette')}</kbd> palette · <kbd>{k('help')}</kbd> all keys</span>
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
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  const keyFor = (id: ActionId) => displayCombo(bindingsFor(id, bindings)[0] ?? '');

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // Losing focus mid-hold means the keyup never arrives: treat it as a release.
    window.addEventListener('blur', stopVoice);
    armOnFirstGesture();
    maybeShowWelcome();
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
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 md:gap-3 md:px-4">
        <span className="whitespace-nowrap font-semibold tracking-tight text-zinc-100">cc-control</span>
        {needYou > 0 && (
          <button onClick={() => set({ screen: 'list', openId: null, tab: 'inbox' })} className="whitespace-nowrap rounded bg-amber-900 px-2 py-0.5 text-xs text-amber-200">
            {waiting > 0 ? `${waiting} waiting on you` : `${needYou} finished`}
            <span className="hidden md:inline"> · <kbd>{keyFor('nextAttention')}</kbd></span>
          </button>
        )}
        {flash && <span className="truncate text-xs text-sky-300">{flash}</span>}
        {lastError && (
          <button onClick={() => set({ lastError: null })} className="truncate text-xs text-red-400" title="Dismiss">⚠ {lastError}</button>
        )}
        <button onClick={toggleSound} className="ml-auto whitespace-nowrap text-xs text-zinc-500 hover:text-zinc-300" title={`Sound (${keyFor('sound')})`}>
          ♪<span className="hidden md:inline"> {sound ? 'sound' : 'muted'} <kbd>{keyFor('sound')}</kbd></span>
          {!sound && <span className="md:hidden"> off</span>}
        </button>
        <span className={`whitespace-nowrap text-xs ${connected ? 'text-emerald-500' : 'text-red-400'}`} title={connected ? 'Connected' : 'Reconnecting…'}>
          {connected ? '●' : '○'}<span className="hidden md:inline">{connected ? ' connected' : ' reconnecting…'}</span>
        </span>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{screen === 'list' ? <SessionList /> : <SessionView />}</main>
      <HintBar />
      <Dialogs />
    </div>
  );
}
