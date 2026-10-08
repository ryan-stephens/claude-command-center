// The Ticket Line (PLAN §27, spec: docs/futures/path-line.html), the home page: work as cards
// moving left to right through the loop, one card full screen when you open it (CardView.tsx, §81), and the
// new-card screen over the whole board. Cards run in terminal tabs
// and follow their session through its hooks (server/card-events.ts).

import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { cardRepos, kindName, waiting, type Card } from '../../shared/cards.ts';
import { homeRepo, repoName, samePath } from '../../shared/workspaces.ts';
import { bindingsFor, displayCombo } from '../bindings.ts';
import { importWorkspace } from '../commands.ts';
import { INBOX_VIEWS, inView, qaLine, SOURCE_NAME, type Ticket } from '../../shared/tickets.ts';
import { age } from '../home-model.ts';
import { booting, cardActivity, elapsed, needsYou, progress, ticketFocus } from '../line-model.ts';
import { anyLive, cardRecipe, mainRun, type CardRun } from '../../shared/recipes.ts';
import { boardOf, openApp, openCard, openComposer, restartApp, switchInbox, tryIt, workspaceKey } from '../line-keys.ts';
import { allMerged, prsLine, prsOf } from '../../shared/ship.ts';
import { currentWorkspace, get, NO_BINDINGS, set, setFilter, useStore } from '../store.ts';
import { CardView } from './CardView.tsx';
import { useNow } from './ActivityBar.tsx';
import { NewCard } from './NewCard.tsx';
import { NewCardSimple } from './NewCardSimple.tsx';
import { SLIM } from '../slim.ts';
import { Icon, Key, Pill, SWATCH, TicketKey, WsBadge } from './ui.tsx';

/** The expand key's current binding, as a keycap label. */
export function useExpandKey(): string {
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  return displayCombo(bindingsFor('expand', bindings)[0] ?? '');
}

export function TicketLine() {
  const composer = useStore((s) => Boolean(s.composer));
  // The simple look (§59) makes cards and, on an open card, is the + Context popup over the chat (§88); the full look keeps its screens for both.
  const simple = useStore((s) => Boolean(s.composer && (s.settings.newCardLook ?? 'simple') === 'simple'));
  const drawer = useStore((s) => s.line.drawer);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <LineBar />
      {!SLIM.workspaceBar && <WorkspaceBar />}
      <div className="relative flex min-h-0 flex-1">
        <Board />
        {drawer && <CardView id={drawer} />}
        {composer && (simple ? <NewCardSimple /> : <NewCard />)}
      </div>
    </div>
  );
}

function LineBar() {
  const workspaces = useStore((s) => s.workspaces);
  const filter = useStore((s) => s.line.filter);
  const cards = useStore((s) => s.cards);
  const inFlight = cards.filter((c) => c.stage !== 'inbox' && c.stage !== 'done').length;
  const starting = cards.filter(booting).length;
  const needs = cards.filter(needsYou).length;
  const chip = (on: boolean) => `flex items-center gap-2 whitespace-nowrap rounded-lg border px-2 py-1 text-[13.5px] ${on ? 'border-ring bg-surface shadow-[0_0_0_2px_color-mix(in_srgb,var(--c-ring)_25%,transparent)]' : 'border-line bg-surface hover:bg-raise'}`;
  return (
    <div className="flex items-center gap-3 overflow-x-auto border-b border-line bg-col px-4 py-2">
      <button className={chip(filter === 'all')} onClick={() => setFilter('all')}><Key k="0" size="sm" />All</button>
      {workspaces.slice(0, 9).map((w, i) => (
        <button key={w.id} className={chip(filter === w.id)} onClick={() => setFilter(w.id)} onDoubleClick={() => set({ modal: { kind: 'workspace', id: w.id } })} title={`${w.name} (${i + 1}) · double-click or E to edit`}>
          <Key k={String(i + 1)} size="sm" /><WsBadge ws={w} size={20} />{w.name}
        </button>
      ))}
      <button className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-dashed border-line px-2 py-1 text-[13.5px] text-faint hover:text-ink" onClick={() => set({ modal: { kind: 'workspace', id: null } })} title="New lane">
        <Icon name="plus" size={14} />Lane<Key k="W" size="sm" />
      </button>
      {!SLIM.filter && <SearchBox />}
      <span className="grow" />
      <span className="whitespace-nowrap text-[13.5px] text-sub"><b className="text-ink tabular-nums">{inFlight}</b> in flight</span>
      <span className={`whitespace-nowrap text-[13.5px] ${needs ? 'text-attn' : 'text-sub'}`}><b className={`tabular-nums ${needs ? '' : 'text-ink'}`}>{needs}</b> need{needs === 1 ? 's' : ''} you</span>
      {starting > 0 && <span className="whitespace-nowrap text-[13.5px] text-busy"><b className="tabular-nums">{starting}</b> starting</span>}
      {!SLIM.lineButtons && <>
        <button className="btn whitespace-nowrap py-1" onClick={() => set({ modal: { kind: 'tickets' } })} title="Demo tickets, Jira and Trello, and which lane each project goes to"><Key k="⇧T" size="sm" />Tickets</button>
        <button className="btn whitespace-nowrap py-1" onClick={() => openComposer()}><Key k="c" size="sm" />New card</button>
      </>}
    </div>
  );
}

/** / filters the cards by words. Shown while typing or while it holds text. */
function SearchBox() {
  const q = useStore((s) => s.line.q);
  const searching = useStore((s) => s.line.searching);
  const ref = useRef<HTMLInputElement>(null);
  const open = searching || Boolean(q);
  return (
    <label className={`flex cursor-text items-center gap-2 rounded-lg border bg-surface py-1 pl-2 pr-1.5 ${open ? 'border-ring' : 'border-line text-faint'}`} onClick={() => ref.current?.focus()}>
      <Key k="/" size="sm" />
      <input
        id="line-q" ref={ref} type="text" autoComplete="off" value={q} placeholder="Filter"
        onChange={(e) => set({ line: { ...get().line, q: e.target.value } })}
        onFocus={() => set({ line: { ...get().line, searching: true } })}
        onBlur={() => set({ line: { ...get().line, searching: false } })}
        className={`bg-transparent text-[13.5px] outline-none placeholder:text-faint ${open ? 'w-44' : 'w-14'}`}
        aria-label="Filter cards"
      />
      {q && <button className="text-faint hover:text-ink" onClick={() => set({ line: { ...get().line, q: '' } })} aria-label="Clear the filter"><Icon name="x" size={13} /></button>}
    </label>
  );
}

/**
 * The workspace shown: its repos, which every card and session in it can use, and the keys that
 * change them. With All showing, the same keys ask which workspace.
 */
function WorkspaceBar() {
  const ws = useStore((s) => currentWorkspace(s));
  const count = useStore((s) => s.workspaces.length);
  const sources = useStore((s) => s.library.sources.length);
  const act = (label: string, k: string, onClick: () => void, title?: string) => (
    <button className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-faint hover:text-ink" onClick={onClick} title={title}>{label}<Key k={k} size="sm" /></button>
  );
  const home = ws ? homeRepo(ws) : undefined;
  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-line bg-col px-4 py-1.5 text-[13px]">
      {ws ? (
        <>
          <span className="whitespace-nowrap text-faint" title="Every card in this lane can read and change all of these repos">{ws.name} repos</span>
          {ws.repos.length
            ? ws.repos.map((r) => (
              <span key={r} title={r} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-line bg-raise px-1.5 font-mono text-[12px] text-sub">
                {home && samePath(r, home) && <Icon name="home" size={11} className="text-acc" />}{repoName(r)}
              </span>
            ))
            : <span className="whitespace-nowrap text-faint">none yet: + adds one from the library</span>}
          <span className="mx-1 h-4 w-px bg-line" />
          {act('Add', '+', () => workspaceKey('addRepo'), 'Add a repo from the library to this lane')}
          {ws.repos.length > 0 && act('Remove', '−', () => workspaceKey('removeRepo'))}
          {act('Edit', 'E', () => workspaceKey('edit'))}
          {act('Share', '⇧E', () => workspaceKey('share'), 'Save this lane as a file to share')}
        </>
      ) : count ? null : (
        <span className="whitespace-nowrap text-faint">No lanes yet. A lane groups the repos you work on together: W makes one.</span>
      )}
      <span className="grow" />
      {act('Import', '⇧I', importWorkspace, 'Import a lane someone shared')}
      {act(sources ? 'Library folders' : 'Pick repo folders', 'F', () => set({ modal: { kind: 'sources' } }), 'Choose the folders the repo library lists')}
    </div>
  );
}

function Board() {
  // Re-rendered when any of these change; boardOf reads them from the store.
  useStore((s) => s.cards);
  useStore((s) => s.tickets);
  useStore((s) => s.line.filter);
  useStore((s) => s.line.q);
  const view = useStore((s) => s.line.view);
  const focus = useStore((s) => s.line.focus);
  const workspaces = useStore((s) => s.workspaces);
  const cols = boardOf(get());
  const color = (id: string | null | undefined) => SWATCH[workspaces.find((w) => w.id === id)?.color ?? ''] ?? 'var(--c-line)';
  useEffect(() => {
    if (focus) document.getElementById(`card-${focus}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focus]);
  return (
    <div className="grid min-h-0 flex-1 auto-cols-[minmax(190px,1fr)] grid-flow-col gap-2.5 overflow-x-auto p-3.5">
      {cols.map((l) => (
        <section key={l.stage} aria-label={l.name} className="flex min-h-0 flex-col rounded-xl border border-line bg-col">
          <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
            <h4 className={`text-[13px] font-bold ${l.stage === 'needs' && l.cards.length ? 'text-attn' : ''}`}>{l.name}</h4>
            <span className="font-mono text-xs font-bold text-faint">{l.cards.length + l.tickets.length}</span>
          </div>
          {/* The Inbox's note reads like the other columns': which tickets it shows, and the other view as a quiet link (v). */}
          {l.stage === 'inbox'
            ? <div className="min-h-[30px] border-b border-line px-3 pb-2 text-xs text-faint">
              {view === 'mine' ? 'Your tickets' : 'Ready for QA in your projects'}
              <span> · </span>
              <button onClick={switchInbox} className="underline decoration-dotted underline-offset-2 hover:text-ink" title="v switches">{INBOX_VIEWS.find((v) => v.id !== view)?.name}</button>
              <Key k="v" size="sm" className="ml-1" />
            </div>
            : <div className="min-h-[30px] border-b border-line px-3 pb-2 text-xs text-faint">{GATE[l.stage]}</div>}
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
            {l.tickets.map((tk) => <TicketTile key={tk.key} t={tk} focused={ticketFocus(tk.key) === focus} color={color(tk.workspaceId)} />)}
            {l.cards.length || l.tickets.length
              ? l.cards.map((c) => <CardTile key={c.id} card={c} focused={c.id === focus} color={color(c.workspaceId)} />)
              : <div className="rounded-xl border border-dashed border-line px-1.5 py-3 text-center text-[12.5px] text-faint">{l.stage === 'inbox' && view === 'qa' ? <>Nothing Ready for QA in your projects. <Key k="c" size="sm" inline /> then <Key k="/" size="sm" inline /> searches Jira for any ticket.</> : EMPTY[l.stage]}</div>}
          </div>
        </section>
      ))}
    </div>
  );
}

/** A ticket waiting in the Inbox: n (or Enter, or a click) starts work on it. */
function TicketTile({ t, focused, color }: { t: Ticket; focused: boolean; color: string }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === t.workspaceId));
  return (
    <button
      id={`card-${ticketFocus(t.key)}`}
      onClick={() => openComposer(t)}
      title={`${t.key} ${t.title}\n${SOURCE_NAME[t.source]} · ${t.projectName} · ${t.status}${t.demo ? '\nA demo ticket' : ''}\nn starts work on it`}
      className={`flex flex-col gap-1.5 rounded-xl border border-l-4 bg-surface px-2.5 py-2 text-left text-[13px] ${focused ? 'is-focus' : 'border-line hover:bg-raise'}`}
      style={{ borderLeftColor: color }}
    >
      <span className="flex items-center gap-1.5">
        <TicketKey k={t.key} source={t.source} />
        <span className="grow" />
        <span className="text-[11.5px] text-faint">{t.demo ? 'demo · ' : ''}{SOURCE_NAME[t.source]}</span>
      </span>
      <span className="text-[14px] font-semibold leading-snug">{t.title}</span>
      <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-faint">
        <span>{ws?.name ?? `${t.projectName} · no lane`}</span><span>·</span><span>{t.status}</span>{t.assignee && !inView(t, 'mine') && <><span>·</span><span title="Assigned to">{t.assignee}</span></>}
        {inView(t, 'qa') && qaLine(t) && <><span>·</span><span className={t.qaReviewer ? 'font-semibold text-sub' : 'italic'} title="QA reviewer">{qaLine(t)}</span></>}<span>·</span><span>{age(t.updatedAt)}</span>
      </span>
    </button>
  );
}

/** What moves a card on from each column: the key to press, or where to look. */
const GATE: Record<Card['stage'], string> = {
  inbox: 'n starts work on a ticket',
  plan: 'Claude plans; y on the card approves it',
  build: 'Watch it work',
  needs: 'Open the card to answer',
  try: 't tries it · s ships it',
  ship: 's merges the PR · o opens it',
  done: 'Merged, or its ticket is past the work',
};
const EMPTY: Record<Card['stage'], ReactNode> = {
  inbox: <>No tickets here. <Key k="⇧T" size="sm" inline /> connects Jira or Trello (or shows demo tickets); <Key k="c" size="sm" inline /> starts a card without one.</>,
  plan: 'Empty', build: 'Empty', needs: 'Nothing waiting on you', try: 'Empty', ship: 'Empty', done: 'Merged PRs land here',
};

/** Where the app is: behind a front door (§123), the door's address, which shows it or another card's. */
function appAt(run: CardRun): string {
  if (run.door) return run.door.shown ? `App on localhost:${run.door.port}` : `App behind :${run.door.port}`;
  return `App at ${(run.url ?? 'running').replace(/^https?:\/\//, '')}`;
}

/** On a tile: the card's app, while it runs or when it failed. */
function RunLine({ id }: { id: string }) {
  const run = useStore((s) => mainRun(s.runs, id));
  if (!run || run.state === 'stopped' || run.state === 'done') return null;
  const tone = run.state === 'failed' ? 'text-bad' : run.state === 'up' ? 'text-ok' : 'text-busy';
  return (
    <span className={`flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold ${tone}`}>
      {run.state === 'running' ? <span className="spinner" /> : <span className={`h-2 w-2 shrink-0 rounded-full ${run.state === 'up' ? 'bg-ok' : 'bg-bad'}`} />}
      <span className="truncate" title={run.door ? `This card’s UI runs on ${run.url?.replace(/^https?:\/\//, '') ?? 'a port of its own'}, behind localhost:${run.door.port}, the port its sign-in takes. ${run.door.shown ? 'localhost:' + run.door.port + ' shows it now.' : 'o shows it there.'}` : undefined}>{run.state === 'up' ? appAt(run) : run.state === 'failed' ? `Try it failed · exit ${run.steps.find((s) => s.state === 'bad')?.code ?? '?'}` : 'Starting the app'}</span>
    </span>
  );
}

/** The live line: a spinner while working, amber while it needs you, green while it waits, grey once ended. */
function ActLine({ card }: { card: Card }) {
  const act = cardActivity(card);
  return (
    <span className={`flex min-w-0 items-center gap-1.5 text-[12.5px] ${act.state === 'bad' ? 'font-semibold text-attn' : 'text-sub'}`}>
      {act.state === 'go' ? <span className="spinner text-busy" /> : <span className={`h-2 w-2 shrink-0 rounded-full ${act.state === 'bad' ? 'bg-attn' : act.state === 'off' ? 'bg-faint' : 'bg-ok'}`} />}
      <span className="truncate">{act.text}</span>
    </span>
  );
}

function CardTile({ card, focused, color }: { card: Card; focused: boolean; color: string }) {
  const needs = needsYou(card);
  const prog = progress(card);
  const now = useNow(true);
  return (
    <div
      className={`flex flex-col rounded-xl border border-l-4 text-[13px] ${needs ? 'bg-attn-bg' : 'bg-surface'} ${focused ? 'is-focus' : `${needs ? 'border-attn/45' : 'border-line'} hover:bg-raise`}`}
      style={{ borderLeftColor: color }}
    >
      <button
        id={`card-${card.id}`}
        onClick={() => openCard(card.id)}
        className="flex flex-col gap-1.5 rounded-xl px-2.5 py-2 text-left"
      >
        <span className="flex items-center gap-1.5">
          <TicketKey k={card.key} source={card.ticket?.source} />
          {card.kind && card.kind !== 'build' && <KindPill card={card} />}
          <span className="grow" />
          <Pill tone="grey">terminal</Pill>
        </span>
        <span className="text-[14px] font-semibold leading-snug">{card.title}</span>
        <ActLine card={card} />
        {card.report && (
          <span className={`flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold ${/fail|change|block/i.test(card.report.result ?? '') ? 'text-bad' : 'text-ok'}`}>
            <span className="rounded border border-current px-1 font-mono text-[10px]">{card.kind === 'qa' ? 'QA' : 'CR'}</span><span className="truncate">{card.kind === 'qa' ? 'Report' : 'Findings'}{card.report.result ? `: ${card.report.result}` : ' ready'}</span>
          </span>
        )}
        <RunLine id={card.id} />
        {prsOf(card.ship).length > 0 && (
          <span className={`flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold ${allMerged(prsOf(card.ship)) ? 'text-ok' : prsOf(card.ship).some((p) => p.checks === 'fail') ? 'text-bad' : 'text-busy'}`}>
            <span className="rounded border border-current px-1 font-mono text-[10px]">PR</span><span className="truncate">{prsLine(prsOf(card.ship))}</span>
          </span>
        )}
        {prog && (
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold tabular-nums text-faint">
            <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-raise"><i className="block h-full bg-ok transition-[width]" style={{ width: `${(100 * prog.done) / prog.total}%` }} /></span>
            {prog.done}/{prog.total}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-x-2 text-xs tabular-nums text-faint">
          <span>{card.files?.length ?? 0} files</span><span>·</span><span>{elapsed(card.createdAt, now)}</span>
          {(card.round ?? 1) > 1 && <><span>·</span><span>round {card.round}</span></>}
          {waiting(card).length > 0 && <><span>·</span><span className="font-semibold text-attn">{waiting(card).length} waiting for your next message</span></>}
        </span>
        <span className="flex flex-wrap gap-1">
          {cardRepos(card).map((r) => <span key={r} className="rounded-md border border-line bg-raise px-1.5 font-mono text-[11.5px] text-sub">{repoName(r)}</span>)}
        </span>
      </button>
      <TryButtons card={card} focused={focused} />
    </div>
  );
}

/**
 * Try it from the board (§104): Start, or Stop, Restart and Open, under a tile. Shown where it is
 * wanted without opening the card: cards in Try it or Ship, the chosen card, and any card whose app
 * runs or failed; only on cards that can run (a recipe, or a lane that has or can have a stack).
 */
function TryButtons({ card, focused }: { card: Card; focused: boolean }) {
  const run = useStore((s) => mainRun(s.runs, card.id));
  const live = useStore((s) => anyLive(s.runs, card.id));
  const canTry = useStore((s) => Boolean(cardRecipe(s.recipes, card.workspaceId, cardRepos(card)[0]) || card.workspaceId));
  const shown = live || run?.state === 'failed' || ((card.stage === 'try' || card.stage === 'ship' || focused) && card.stage !== 'done');
  if (!canTry || !shown) return null;
  const up = run?.state === 'up' && Boolean(run.url);
  // The tile's own button opens the card: these act and leave the board as it is.
  const act = (e: MouseEvent, f: (id: string, stay: boolean) => void) => { e.stopPropagation(); set({ line: { ...get().line, focus: card.id } }); f(card.id, true); };
  const btn = 'flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[12px] font-semibold hover:bg-surface disabled:opacity-50';
  return (
    <div role="group" aria-label={`${card.key}’s app`} className="flex items-center gap-0.5 border-t border-line/70 px-1.5 py-1">
      {live ? (
        <>
          <button className={`${btn} text-acc`} disabled={!up} onClick={(e) => act(e, (id) => openApp(id))} title={up ? `Open ${run?.door?.url ?? run?.url} in a new tab` : 'The app is still starting'}><Icon name="popout" size={13} />Open<Key k="o" size="sm" /></button>
          <span className="grow" />
          <button className={`${btn} text-sub hover:text-ink`} aria-label="Stop" onClick={(e) => act(e, tryIt)} title="Stop the app (every service of the stack)"><Icon name="stop" size={13} /><Key k="t" size="sm" /></button>
          <button className={`${btn} text-sub hover:text-ink`} aria-label="Restart" onClick={(e) => act(e, restartApp)} title="Restart: stop it and start it again"><Icon name="restart" size={13} /><Key k="⇧R" size="sm" /></button>
        </>
      ) : (
        <button className={`${btn} text-acc`} onClick={(e) => act(e, tryIt)} title="Start the app the way the card’s repo or lane says"><Icon name="play" size={13} />{run?.state === 'failed' ? 'Start again' : 'Start'}<Key k="t" size="sm" /></button>
      )}
    </div>
  );
}

/** §123: the card whose UI the front door shows, marked where its Open is. */
export function DoorChip({ run }: { run?: CardRun }) {
  if (!run?.door?.shown) return null;
  return <span className="shrink-0 rounded bg-ok-bg px-1 font-mono text-[11px] font-semibold text-ok" title={`localhost:${run.door.port} shows this card’s UI (the port its sign-in takes). o on another card shows that one there.`}>on :{run.door.port}</span>;
}

/** QA or Code review, on a card's tile and in its drawer. */
export function KindPill({ card }: { card: Card }) {
  return <span className="whitespace-nowrap rounded-full border border-acc/50 bg-acc-soft px-2 text-[11px] font-semibold text-acc" title={kindName(card.kind)}>{card.kind === 'review' ? 'Review' : kindName(card.kind)}</span>;
}
