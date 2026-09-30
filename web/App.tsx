import { useEffect } from 'react';
import { Dialogs } from './components/Dialogs.tsx';
import { SessionView } from './components/SessionView.tsx';
import { Icon, Key, KeyHint, WsBadge } from './components/ui.tsx';
import { armOnFirstGesture, setNotificationHandler } from './attention.ts';
import { bindingsFor, displayCombo, type ActionId } from './bindings.ts';
import { backToLine, cycleTheme, jumpToAttention, onKeyDown, onKeyUp, openSession } from './keys.ts';
import { legendFor, lineLegendFor } from './legend.ts';
import { packetRows } from './line-model.ts';
import { openLine } from './line-keys.ts';
import { TicketLine } from './components/TicketLine.tsx';
import { stopVoice } from './voice.ts';
import { maybeShowWelcome } from './components/Welcome.tsx';
import { activeSession, attention, currentWorkspace, NO_BINDINGS, set, toggleSound, useStore } from './store.ts';

/** The keys that matter right now, as big keycaps. Changes with the view, the panel or the zone. */
function Legend() {
  const screen = useStore((s) => s.screen);
  const zone = useStore((s) => s.zone);
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  const focusId = useStore((s) => activeSession(s));
  const pending = useStore((s) => Object.values(s.permissions).some((p) => p.sessionId === focusId));
  const pendingKind = useStore((s) => {
    const p = Object.values(s.permissions).find((x) => x.sessionId === focusId);
    return p?.questions?.length ? 'question' : p?.plan !== undefined ? 'plan' : 'tool';
  });
  const busy = useStore((s) => {
    const status = s.sessions.find((x) => x.id === s.openId)?.status;
    return Boolean(activeSession(s)) && (status === 'running' || status === 'requires_action');
  });
  const drafting = useStore((s) => Boolean(s.openId && s.drafts[s.openId]));
  const modal = useStore((s) => s.modal);
  const lineView = useStore((s) => (s.composer ? 'composer' : s.line.drawer ? 'drawer' : 'board'));
  const pane = useStore((s) => s.composer?.pane);
  const preview = useStore((s) => s.composer?.preview);
  const cardRepo = useStore((s) => {
    const row = s.composer ? packetRows(s.composer)[s.composer.pi] : undefined;
    return row?.layer === 'card' && row.item.kind === 'repo';
  });
  const lineFocus = useStore((s) => Boolean(s.line.focus && s.cards.some((c) => c.id === s.line.focus)));
  const hasSession = useStore((s) => Boolean(s.cards.find((c) => c.id === (s.line.drawer ?? s.line.focus))?.sessionId));
  const filtered = useStore((s) => Boolean(s.line.q.trim()));
  if (modal) return null;
  const items = screen === 'line'
    ? lineLegendFor({ view: lineView, hasFocus: lineFocus, hasSession, filtered, pane, preview, cardRepo, bindings })
    : legendFor({ zone, pending, pendingKind, busy, drafting, bindings });
  const k = (id: ActionId) => displayCombo(bindingsFor(id, bindings)[0] ?? '');
  return (
    <footer className="hidden items-center gap-x-6 gap-y-2 border-t border-line bg-col px-4 py-2.5 text-[13.5px] text-sub md:flex md:flex-wrap" aria-label="Keys you can press now">
      {items.map((it) => <KeyHint key={it.label} k={it.keys} tone={it.tone}>{it.label}</KeyHint>)}
      <span className="ml-auto flex items-center gap-5">
        <KeyHint k={k('nextAttention')}>Next that needs you</KeyHint>
        <KeyHint k={k('help')}>Every key</KeyHint>
      </span>
    </footer>
  );
}

function Header() {
  const screen = useStore((s) => s.screen);
  const connected = useStore((s) => s.connected);
  const lastError = useStore((s) => s.lastError);
  const flash = useStore((s) => s.flash);
  const sound = useStore((s) => s.sound);
  const theme = useStore((s) => s.theme);
  const needYou = useStore((s) => attention(s).length);
  const waiting = useStore((s) => Object.keys(s.permissions).length);
  const ws = useStore((s) => currentWorkspace(s));
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  const k = (id: ActionId) => displayCombo(bindingsFor(id, bindings)[0] ?? '');
  return (
    <header className="flex items-center gap-3 border-b border-line bg-col px-3 py-2 md:px-4">
      <button onClick={() => (screen === 'session' ? backToLine() : openLine())} className="whitespace-nowrap font-semibold tracking-tight" title="The Ticket Line">
        Command Center
      </button>
      <span className="hidden min-w-0 items-center gap-2 text-sub md:flex">
        <span className="text-faint">/</span>
        {screen === 'session'
          ? <button className="flex items-center gap-1.5 hover:text-ink" onClick={backToLine} title="Back to the Ticket Line">Ticket Line<Key k={k('ticketLine')} size="sm" /></button>
          : <><span className="font-semibold text-ink">Ticket Line</span>{ws && <><span className="text-faint">·</span><WsBadge ws={ws} size={20} /><span className="truncate">{ws.name}</span></>}</>}
      </span>
      {flash && <span className="truncate text-sm text-busy" role="status">{flash}</span>}
      {lastError && (
        <button onClick={() => set({ lastError: null })} className="flex min-w-0 items-center gap-1.5 rounded-lg bg-bad-bg px-2 py-1 text-sm text-bad" title="Dismiss">
          <Icon name="warn" size={15} /><span className="truncate">{lastError}</span><Icon name="x" size={14} />
        </button>
      )}
      <span className="ml-auto" />
      {needYou > 0 && (
        <button onClick={jumpToAttention} className="flex items-center gap-2 whitespace-nowrap rounded-lg bg-attn-bg py-1 pl-3 pr-1.5 text-sm font-semibold text-attn">
          {waiting > 0 ? `${needYou} need${needYou === 1 ? 's' : ''} you` : `${needYou} finished`}
          <Key k={k('nextAttention')} size="sm" tone="attn" className="hidden md:inline-flex" />
        </button>
      )}
      <button onClick={() => set({ modal: { kind: 'palette' } })} className="btn-ghost btn hidden md:inline-flex" title="Search sessions, workflows and actions">
        <Icon name="search" size={16} />Search<Key k={k('palette')} size="sm" />
      </button>
      <button onClick={() => set({ modal: { kind: 'help' } })} className="btn-ghost btn hidden md:inline-flex" title="Every key">
        <Icon name="keyboard" size={16} /><Key k={k('help')} size="sm" />
      </button>
      <button onClick={cycleTheme} className="btn-ghost btn px-2" title={`Theme: ${theme === 'system' ? 'match Windows' : theme} (${k('theme')})`} aria-label="Switch theme">
        <Icon name={theme === 'system' ? 'auto' : theme === 'light' ? 'sun' : 'moon'} size={17} />
      </button>
      <button onClick={toggleSound} className="btn-ghost btn px-2" title={`Sound ${sound ? 'on' : 'off'} (${k('sound')})`} aria-label={sound ? 'Mute sounds' : 'Turn sounds on'}>
        <Icon name={sound ? 'bell' : 'bellOff'} size={17} />
      </button>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${connected ? 'bg-ok' : 'pulse bg-bad'}`} title={connected ? 'Connected' : 'Reconnecting…'} role="status" aria-label={connected ? 'Connected' : 'Reconnecting'} />
    </header>
  );
}

/** The page and the server are from different versions: say how to fix it, because nothing else will. */
function OutdatedBanner() {
  const outdated = useStore((s) => s.outdated);
  if (!outdated) return null;
  return (
    <div className="flex items-center gap-2.5 border-b border-line bg-bad-bg px-4 py-2 text-sm text-bad" role="alert">
      <Icon name="warn" size={16} />
      {outdated === 'server'
        ? <span><strong>The cc-control server is out of date.</strong> It started before the last update, so workspaces and the repo library can’t save. Restart it: stop it and run <code className="font-mono">pnpm start</code>.</span>
        : <span><strong>This page is older than the cc-control server.</strong> Reload it (<Key k="F5" size="sm" />).</span>}
    </div>
  );
}

export function App() {
  const screen = useStore((s) => s.screen);
  const needYou = useStore((s) => attention(s).length);

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
    document.title = needYou ? `(${needYou}) Command Center` : 'Command Center';
  }, [needYou]);

  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <Header />
      <OutdatedBanner />
      <main className="flex min-h-0 flex-1 flex-col">{screen === 'session' ? <SessionView /> : <TicketLine />}</main>
      <Legend />
      <Dialogs />
    </div>
  );
}

