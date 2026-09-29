import { useEffect } from 'react';
import { Dialogs } from './components/Dialogs.tsx';
import { SessionList } from './components/SessionList.tsx';
import { SessionView } from './components/SessionView.tsx';
import { onKeyDown } from './keys.ts';
import { set, useStore } from './store.ts';

/** Context-sensitive key hints, so the current keys are always on screen. */
function HintBar() {
  const screen = useStore((s) => s.screen);
  const zone = useStore((s) => s.zone);
  const hints: [string, string][] =
    screen === 'list'
      ? [['↑↓', 'move'], ['Enter', 'open'], ['/', 'filter'], ['Tab', 'live/history'], ['N', 'new'], ['R', 'rename'], ['X', 'stop']]
      : zone === 'composer'
        ? [['Enter', 'send'], ['Shift+Enter', 'newline'], ['Esc', 'transcript'], ['Ctrl+.', 'interrupt'], ['Alt+↑↓', 'hop']]
        : [['i', 'compose'], ['↑↓', 'scroll'], ['T', 'tools'], ['Y/A/N', 'approve'], ['Esc', 'list'], ['Alt+↑↓', 'hop']];
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
  const waiting = useStore((s) => s.sessions.filter((x) => x.status === 'requires_action').length);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    document.title = waiting ? `(${waiting}) cc-control` : 'cc-control';
  }, [waiting]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <span className="font-semibold tracking-tight text-zinc-100">cc-control</span>
        {waiting > 0 && <span className="rounded bg-amber-900 px-2 py-0.5 text-xs text-amber-200">{waiting} need you</span>}
        {lastError && (
          <button onClick={() => set({ lastError: null })} className="truncate text-xs text-red-400" title="Dismiss">⚠ {lastError}</button>
        )}
        <span className={`ml-auto text-xs ${connected ? 'text-emerald-500' : 'text-red-400'}`}>
          {connected ? '● connected' : '○ reconnecting…'}
        </span>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{screen === 'list' ? <SessionList /> : <SessionView />}</main>
      <HintBar />
      <Dialogs />
    </div>
  );
}
