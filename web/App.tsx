import { useEffect } from 'react';
import { askOf, cardRepos, ownFolders, waiting } from '../shared/cards.ts';
import { anyLive, cardRecipe, mainRun } from '../shared/recipes.ts';
import { openPrs, prsOf, shipMode } from '../shared/ship.ts';
import { Dialogs } from './components/Dialogs.tsx';
import { SessionView } from './components/SessionView.tsx';
import { Icon, Key, KeyHint, TicketKey } from './components/ui.tsx';
import { armOnFirstGesture, setNotificationHandler } from './attention.ts';
import { bindingsFor, displayCombo, type ActionId } from './bindings.ts';
import { cycleTheme, jumpToAttention, onKeyDown, onKeyUp, openSession } from './keys.ts';
import { applyHints, trimLegend } from './hints.ts';
import { legendFor, lineLegendFor } from './legend.ts';
import { packetRows } from './line-model.ts';
import { goHome } from './line-keys.ts';
import { pickerList } from './simple-keys.ts';
import { chips, simpleOf } from './simple-model.ts';
import { SLIM } from './slim.ts';
import { TicketLine } from './components/TicketLine.tsx';
import { stopVoice } from './voice.ts';
import { maybeShowWelcome } from './components/Welcome.tsx';
import { activeSession, attention, NO_BINDINGS, set, toggleSound, useStore } from './store.ts';

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
  const onTicket = useStore((s) => Boolean(s.line.focus?.startsWith('t:')));
  // Only once the session is in the list: before that, the key would open a session the page doesn't have.
  const hasSession = useStore((s) => { const id = s.cards.find((c) => c.id === (s.line.drawer ?? s.line.focus))?.sessionId; return Boolean(id && s.sessions.some((x) => x.id === id)); });
  const filtered = useStore((s) => Boolean(s.line.q.trim()));
  const addingTo = useStore((s) => s.composer?.addTo?.key);
  const drawerCard = useStore((s) => s.cards.find((c) => c.id === s.line.drawer));
  const canAdd = Boolean(drawerCard && drawerCard.stage !== 'done');
  const shown = useStore((s) => s.cards.find((c) => c.id === (s.line.drawer ?? s.line.focus)));
  // A workspace card with no recipe can still try: t shows what its repos say the stack is.
  const canTry = useStore((s) => Boolean(shown && (cardRecipe(s.recipes, shown.workspaceId, cardRepos(shown)[0]) || shown.workspaceId)));
  const run = useStore((s) => (shown ? mainRun(s.runs, shown.id) : undefined));
  const appRunning = useStore((s) => Boolean(shown && anyLive(s.runs, shown.id)));
  const appUp = run?.state === 'up' && Boolean(run.url);
  const prs = shown ? prsOf(shown.ship) : [];
  const pr = openPrs(prs)[0] ?? prs[0];
  const testing = shown?.kind === 'qa' || shown?.kind === 'review';
  const ship = testing ? (shown.report || shown.live?.lastMessage ? 'report' as const : undefined)
    : shown && shown.stage !== 'done' && (shown.sessionId || pr) ? shipMode(shown.ship) : undefined;
  const canDone = shown?.stage === 'ship';
  const canSay = Boolean(drawerCard?.channel);
  const asking = Boolean(drawerCard && askOf(drawerCard)?.requestId);
  const hasTab = Boolean(shown?.cwd);
  // Waiting on you in the tab, and the page can't answer it: g is the way.
  const needsTab = Boolean(shown?.live?.phase === 'needs' && !asking);
  const hasChanges = Boolean(shown?.cwd && (shown.files?.length || shown.ship));
  const hasDraft = useStore((s) => Boolean(s.draft));
  const hasPr = Boolean(pr ?? shown?.pr);
  const tab = useStore((s) => s.composer?.tab);
  const hasWaiting = Boolean(drawerCard && waiting(drawerCard).length);
  const panel = useStore((s) => s.line.panel);
  const hasStack = useStore((s) => Boolean(shown && cardRecipe(s.recipes, shown.workspaceId, cardRepos(shown)[0])?.stack));
  const hasWorktrees = Boolean(shown && ownFolders(shown).length);
  const hints = useStore((s) => s.settings.keyHints ?? 'always');
  const isSimple = useStore((s) => Boolean(s.composer && !s.composer.addTo && (s.settings.newCardLook ?? 'simple') === 'simple'));
  const spBlock = useStore((s) => (s.composer ? simpleOf(s.composer).block : 'ticket'));
  const spAdding = useStore((s) => Boolean(s.composer && simpleOf(s.composer).adding));
  const spContext = useStore((s) => Boolean(s.composer && simpleOf(s.composer).adding === 'context'));
  const spFolders = useStore((s) => Boolean(s.composer && simpleOf(s.composer).adding === 'context' && s.composer.tab === 'folders'));
  const spRepos = useStore((s) => Boolean(s.composer && simpleOf(s.composer).adding === 'context' && s.composer.tab === 'repos'));
  const spOnSource = useStore((s) => Boolean(s.composer && simpleOf(s.composer).adding === 'context' && s.composer.tab === 'repos' && pickerList(s.composer)[simpleOf(s.composer).ai]?.role === 'source'));
  const spPrompt = useStore((s) => Boolean(s.composer && simpleOf(s.composer).adding === 'prompt'));
  const spMore = useStore((s) => Boolean(s.composer && simpleOf(s.composer).more));
  const spTicket = useStore((s) => Boolean(s.composer?.ticket));
  const spDetails = useStore((s) => Boolean(s.composer && simpleOf(s.composer).details));
  const spTicketLink = useStore((s) => Boolean(s.composer?.ticket?.url));
  const spOwn = useStore((s) => Boolean(s.composer && chips(s.composer, s.library.repos)[simpleOf(s.composer).ci]?.own));
  const simple = isSimple ? { block: spBlock, adding: spAdding, context: spContext, folders: spFolders, repos: spRepos, onSource: spOnSource, prompt: spPrompt, more: spMore, hasTicket: spTicket, details: spDetails, ticketLink: spTicketLink, ownChip: spOwn } : undefined;
  if (modal) return null;
  const items = trimLegend(screen === 'line'
    ? lineLegendFor({ view: lineView, hasFocus: lineFocus, onTicket, hasSession, filtered, pane, preview, cardRepo, addingTo, canAdd, hasWaiting, canTry, appRunning, appUp, ship, canDone, hasPr, hasWorktrees, canSay, asking, hasTab, needsTab, hasChanges, hasDraft, tab, simple, panel, hasStack, bindings })
    : legendFor({ zone, pending, pendingKind, busy, drafting, bindings }), hints);
  if (!items) return null;
  const k = (id: ActionId) => displayCombo(bindingsFor(id, bindings)[0] ?? '');
  return (
    <footer className="kc-keep hidden items-center gap-x-6 gap-y-2 border-t border-line bg-col px-4 py-2.5 text-[13.5px] text-sub md:flex md:flex-wrap" aria-label="Keys you can press now">
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
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  const openCard = useStore((s) => (s.screen === 'line' && s.line.drawer ? s.cards.find((c) => c.id === s.line.drawer) : undefined));
  const openSessionName = useStore((s) => (s.screen === 'session' ? s.sessions.find((x) => x.id === s.openId)?.title ?? s.cards.find((c) => c.sessionId === s.openId)?.title : undefined));
  const k = (id: ActionId) => displayCombo(bindingsFor(id, bindings)[0] ?? '');
  return (
    <header className="flex items-center gap-3 border-b border-line bg-col px-3 py-2 md:px-4">
      <button onClick={goHome} className="-ml-1.5 flex items-center gap-2 whitespace-nowrap rounded-lg px-1.5 py-1 font-semibold tracking-tight hover:bg-raise" title={`Home: your sessions (${k('ticketLine')})`} aria-label="Home: your sessions">
        <Icon name="grid" size={17} className="text-acc" />Command Center
        <Key k={k('ticketLine')} size="sm" className="hidden md:inline-flex" />
      </button>
      {/* The breadcrumb says where you are: Sessions, then the card or session that is open, with Sessions the way back (§63). */}
      <span className="hidden min-w-0 items-center gap-2 text-sub md:flex">
        <span className="text-faint">/</span>
        {screen === 'session' || openCard
          ? <>
              <button className="flex items-center gap-1.5 hover:text-ink" onClick={goHome} title="Back to the board (Esc)">Sessions</button>
              <span className="text-faint">/</span>
              <span className="flex min-w-0 items-center gap-1.5 font-semibold text-ink">
                {openCard ? <><TicketKey k={openCard.key} source={openCard.ticket?.source} /><span className="truncate">{openCard.title}</span></> : <span className="truncate">{openSessionName ?? 'Session'}</span>}
              </span>
            </>
          : <span className="font-semibold text-ink">Sessions</span>}
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
      {!SLIM.search && <button onClick={() => set({ modal: { kind: 'palette' } })} className="btn-ghost btn hidden md:inline-flex" title="Search sessions, workflows and actions">
        <Icon name="search" size={16} />Search<Key k={k('palette')} size="sm" />
      </button>}
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
        ? <span><strong>The cc-control server is out of date.</strong> It started before the last update, so lanes and the repo library can’t save. Restart it: stop it and run <code className="font-mono">pnpm start</code>.</span>
        : <span><strong>This page is older than the cc-control server.</strong> Reload it (<Key k="F5" size="sm" inline />).</span>}
    </div>
  );
}

export function App() {
  const screen = useStore((s) => s.screen);
  const needYou = useStore((s) => attention(s).length);
  const hints = useStore((s) => s.settings.keyHints ?? 'always');
  useEffect(() => applyHints(hints), [hints]);

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
      {!SLIM.legend && <Legend />}
      <Dialogs />
    </div>
  );
}

