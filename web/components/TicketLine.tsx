// The Ticket Line (PLAN §27, spec: docs/futures/path-line.html), the home page: work as cards
// moving left to right through the loop, one card full screen when you open it (PLAN §41), and the
// new-card screen over the whole board. Cards run in terminal tabs
// and follow their session through its hooks (server/card-events.ts).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { askOf, cardRepos, fmtK, itemTokens, kindName, memoryPct, modelName, packetText, tokens, waiting, type Card, type PacketItem } from '../../shared/cards.ts';
import { homeRepo, repoName, samePath } from '../../shared/workspaces.ts';
import { bindingsFor, displayCombo } from '../bindings.ts';
import { importWorkspace } from '../commands.ts';
import { openSession } from '../keys.ts';
import { INBOX_VIEWS, inView, qaLine, SOURCE_NAME, type Ticket } from '../../shared/tickets.ts';
import { age } from '../home-model.ts';
import { booting, cardActivity, elapsed, needsYou, progress, shortPath, stepCard, ticketFocus } from '../line-model.ts';
import { answerAsk, boardOf, editRecipe, goToTab, openAddComposer, openChanges, openApp, openCard, openComposer, openNeighbour, saySubmit, shipKey, switchInbox, tryIt, workspaceKey } from '../line-keys.ts';
import { cardRecipe, specsOf, type CardRun, type RunStep } from '../../shared/recipes.ts';
import { prLine } from '../../shared/ship.ts';
import { currentWorkspace, get, NO_BINDINGS, set, setFilter, useStore } from '../store.ts';
import { send } from '../ws.ts';
import { useNow } from './ActivityBar.tsx';
import { NewCard } from './NewCard.tsx';
import { Transcript } from './Transcript.tsx';
import { Icon, Key, Pill, SWATCH, TicketKey, WsBadge } from './ui.tsx';

/** The expand key's current binding, as a keycap label. */
function useExpandKey(): string {
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  return displayCombo(bindingsFor('expand', bindings)[0] ?? '');
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function TicketLine() {
  const composer = useStore((s) => Boolean(s.composer));
  const drawer = useStore((s) => s.line.drawer);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <LineBar />
      <WorkspaceBar />
      <div className="relative flex min-h-0 flex-1">
        <Board />
        {drawer && <CardView id={drawer} />}
        {composer && <NewCard />}
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
      <button className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-dashed border-line px-2 py-1 text-[13.5px] text-faint hover:text-ink" onClick={() => set({ modal: { kind: 'workspace', id: null } })} title="New workspace">
        <Icon name="plus" size={14} />Workspace<Key k="W" size="sm" />
      </button>
      <SearchBox />
      <span className="grow" />
      <span className="whitespace-nowrap text-[13.5px] text-sub"><b className="text-ink tabular-nums">{inFlight}</b> in flight</span>
      <span className={`whitespace-nowrap text-[13.5px] ${needs ? 'text-attn' : 'text-sub'}`}><b className={`tabular-nums ${needs ? '' : 'text-ink'}`}>{needs}</b> need{needs === 1 ? 's' : ''} you</span>
      {starting > 0 && <span className="whitespace-nowrap text-[13.5px] text-busy"><b className="tabular-nums">{starting}</b> starting</span>}
      <button className="btn whitespace-nowrap py-1" onClick={() => set({ modal: { kind: 'tickets' } })} title="Demo tickets, Jira and Trello, and which workspace each project goes to"><Key k="⇧T" size="sm" />Tickets</button>
      <button className="btn whitespace-nowrap py-1" onClick={() => openComposer()}><Key k="c" size="sm" />New card</button>
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
    <label className={`flex items-center gap-2 rounded-lg border bg-surface py-1 pl-2 pr-1.5 ${open ? 'border-ring' : 'border-line text-faint'}`} onClick={() => ref.current?.focus()}>
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
          <span className="whitespace-nowrap text-faint" title="Every card in this workspace can read and change all of these repos">{ws.name} repos</span>
          {ws.repos.length
            ? ws.repos.map((r) => (
              <span key={r} title={r} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-line bg-raise px-1.5 font-mono text-[12px] text-sub">
                {home && samePath(r, home) && <Icon name="home" size={11} className="text-acc" />}{repoName(r)}
              </span>
            ))
            : <span className="whitespace-nowrap text-faint">none yet: + adds one from the library</span>}
          <span className="mx-1 h-4 w-px bg-line" />
          {act('Add', '+', () => workspaceKey('addRepo'), 'Add a repo from the library to this workspace')}
          {ws.repos.length > 0 && act('Remove', '−', () => workspaceKey('removeRepo'))}
          {act('Edit', 'E', () => workspaceKey('edit'))}
          {act('Share', '⇧E', () => workspaceKey('share'), 'Save this workspace as a file to share')}
        </>
      ) : count ? null : (
        <span className="whitespace-nowrap text-faint">No workspaces yet. A workspace groups the repos you work on together: W makes one.</span>
      )}
      <span className="grow" />
      {act('Import', '⇧I', importWorkspace, 'Import a workspace someone shared')}
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
          {l.stage === 'inbox'
            ? <div className="flex min-h-[30px] flex-wrap items-center gap-1 border-b border-line px-2.5 pb-2 text-xs">
              {INBOX_VIEWS.map((v) => (
                <button key={v.id} onClick={() => { if (v.id !== view) switchInbox(); }}
                  className={`rounded-md border px-1.5 py-0.5 ${v.id === view ? 'border-line bg-surface font-semibold text-ink' : 'border-transparent text-faint hover:text-ink'}`}>{v.name}</button>
              ))}
              <Key k="v" size="sm" />
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
        <span>{ws?.name ?? `${t.projectName} · no workspace`}</span><span>·</span><span>{t.status}</span>{t.assignee && !inView(t, 'mine') && <><span>·</span><span title="Assigned to">{t.assignee}</span></>}
        {inView(t, 'qa') && qaLine(t) && <><span>·</span><span className={t.qaReviewer ? 'font-semibold text-sub' : 'italic'} title="QA reviewer">{qaLine(t)}</span></>}<span>·</span><span>{age(t.updatedAt)}</span>
      </span>
    </button>
  );
}

/** What moves a card on from each column: the key to press, or where to look. */
const GATE: Record<Card['stage'], string> = {
  inbox: 'n starts work on a ticket',
  plan: 'Claude plans; approve it in its tab',
  build: 'Watch it work',
  needs: 'Answer in its terminal tab',
  try: 't tries it · s ships it',
  ship: 's merges the PR · o opens it',
  done: 'Merged',
};
const EMPTY: Record<Card['stage'], ReactNode> = {
  inbox: <>No tickets here. <Key k="⇧T" size="sm" inline /> connects Jira or Trello (or shows demo tickets); <Key k="c" size="sm" inline /> starts a card without one.</>,
  plan: 'Empty', build: 'Empty', needs: 'Nothing waiting on you', try: 'Empty', ship: 'Empty', done: 'Merged PRs land here',
};

/** On a tile: the card's app, while it runs or when it failed. */
function RunLine({ id }: { id: string }) {
  const run = useStore((s) => s.runs[id]);
  if (!run || run.state === 'stopped' || run.state === 'done') return null;
  const tone = run.state === 'failed' ? 'text-bad' : run.state === 'up' ? 'text-ok' : 'text-busy';
  return (
    <span className={`flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold ${tone}`}>
      {run.state === 'running' ? <span className="spinner" /> : <span className={`h-2 w-2 shrink-0 rounded-full ${run.state === 'up' ? 'bg-ok' : 'bg-bad'}`} />}
      <span className="truncate">{run.state === 'up' ? `App at ${(run.url ?? 'running').replace(/^https?:\/\//, '')}` : run.state === 'failed' ? `Try it failed · exit ${run.steps.find((s) => s.state === 'bad')?.code ?? '?'}` : 'Starting the app'}</span>
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
    <button
      id={`card-${card.id}`}
      onClick={() => openCard(card.id)}
      className={`flex flex-col gap-1.5 rounded-xl border border-l-4 px-2.5 py-2 text-left text-[13px] ${needs ? 'bg-attn-bg' : 'bg-surface'} ${focused ? 'is-focus' : `${needs ? 'border-attn/45' : 'border-line'} hover:bg-raise`}`}
      style={{ borderLeftColor: color }}
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
      {card.ship?.pr && (
        <span className={`flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold ${card.ship.pr.state === 'MERGED' ? 'text-ok' : card.ship.pr.checks === 'fail' ? 'text-bad' : 'text-busy'}`}>
          <span className="rounded border border-current px-1 font-mono text-[10px]">PR</span><span className="truncate">{prLine(card.ship.pr)}</span>
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
  );
}

/** QA or Code review, on a card's tile and in its drawer. */
function KindPill({ card }: { card: Card }) {
  return <span className="whitespace-nowrap rounded-full border border-acc/50 bg-acc-soft px-2 text-[11px] font-semibold text-acc" title={kindName(card.kind)}>{card.kind === 'review' ? 'Review' : kindName(card.kind)}</span>;
}

const TABS = [['over', 'Overview'], ['ctx', 'Context'], ['tx', 'Transcript']] as const;

/** Wide enough for the card view's two columns (Tailwind's lg): the transcript then sits beside Overview / Context. */
function useWide(): boolean {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/**
 * One card, full screen: opening a card is giving it your attention, so it takes the whole line
 * (the board stays underneath, and Esc goes back to it). Wide screens show Overview or Context on
 * the left and the live transcript on the right; narrow ones show the three as tabs.
 */
function CardView({ id }: { id: string }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id));
  const tab = useStore((s) => s.line.tab);
  const ws = useStore((s) => s.workspaces.find((w) => w.id === card?.workspaceId) ?? null);
  const wide = useWide();
  // Where it sits among the cards the board shows, for ← →.
  useStore((s) => s.line.filter);
  useStore((s) => s.line.q);
  useStore((s) => s.cards);
  const place = stepCard(boardOf(get()), id, 0);
  if (!card) return null;
  const stage = { inbox: 'Inbox', plan: 'Plan', build: 'Build', needs: 'Needs you', try: 'Try it', ship: 'Ship', done: 'Done' }[card.stage];
  const left = tab === 'tx' && wide ? 'over' : tab;
  const tabs = wide ? TABS.filter(([t]) => t !== 'tx') : TABS;
  return (
    <section className="absolute inset-0 z-20 flex flex-col bg-bg" aria-label={`${card.key} ${card.title}`}>
      <div className="flex items-center gap-4 border-b border-line bg-surface px-4 py-3">
        <WsBadge ws={ws} size={30} />
        <div className="flex min-w-0 grow flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <TicketKey k={card.key} source={card.ticket?.source} />
            <Pill tone={needsYou(card) ? 'amber' : 'grey'}>{stage}</Pill>
            {card.kind && card.kind !== 'build' && <KindPill card={card} />}
            <Pill tone="grey">terminal · tab {card.key}</Pill>
            <span className="text-faint">{ws?.name ?? 'No workspace'}</span>
          </div>
          <h2 className="truncate text-[19px] font-bold leading-snug tracking-tight">{card.title}</h2>
        </div>
        {place.at >= 0 && place.total > 1 && (
          <div className="flex shrink-0 items-center gap-1.5 text-sm text-faint">
            <button className="hover:text-ink disabled:opacity-40" disabled={place.at === 0} onClick={() => openNeighbour(id, -1)} title="The previous card on the board" aria-label="The previous card"><span className="flex items-center gap-1"><Icon name="back" size={15} /><Key k="←" size="sm" /></span></button>
            <span className="tabular-nums">Card {place.at + 1} of {place.total}</span>
            <button className="hover:text-ink disabled:opacity-40" disabled={place.at === place.total - 1} onClick={() => openNeighbour(id, 1)} title="The next card on the board" aria-label="The next card"><span className="flex items-center gap-1"><Key k="→" size="sm" /><Icon name="right" size={15} /></span></button>
          </div>
        )}
        <button className="flex shrink-0 items-center gap-1.5 text-sm text-faint hover:text-ink" onClick={() => set({ line: { ...get().line, drawer: null } })}>Back to the board <Key k="Esc" size="sm" /></button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col border-line bg-surface lg:border-r">
          <div className="flex items-center gap-1 border-b border-line px-4 pt-1.5">
            {tabs.map(([t, name]) => (
              <button key={t} onClick={() => set({ line: { ...get().line, tab: t } })}
                className={`border-b-2 px-3 py-1.5 text-sm font-semibold ${left === t ? 'border-acc text-ink' : 'border-transparent text-faint hover:text-sub'}`}>{name}</button>
            ))}
            <Key k="Tab" size="sm" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {left === 'ctx' ? <ContextTab card={card} wsName={ws?.name} /> : left === 'tx' ? <TranscriptTab card={card} /> : <Overview card={card} />}
          </div>
          {left === 'tx' && <Say card={card} />}
        </div>
        {wide && (
          <div className="flex min-h-0 flex-col bg-col">
            <div className="flex items-center gap-2 border-b border-line px-5 py-2.5">
              <h4 className="grow text-sm font-bold">Transcript</h4>
              <span className="text-xs text-faint">live from the terminal tab {card.key}</span>
            </div>
            <LiveTranscript card={card} />
            <Say card={card} />
          </div>
        )}
      </div>
      <DrawerActions card={card} />
    </section>
  );
}

/** The right-hand column: the session as it is written, kept at the newest unless you scrolled up to read. */
function LiveTranscript({ card }: { card: Card }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const count = useStore((s) => (card.sessionId ? s.transcripts[card.sessionId]?.length ?? 0 : 0));
  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [count]);
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      <TranscriptTab card={card} />
    </div>
  );
}

function DrawerActions({ card }: { card: Card }) {
  const expand = useExpandKey();
  const linked = useStore((s) => Boolean(card.sessionId && s.sessions.some((x) => x.id === card.sessionId)));
  return (
    <div className="flex flex-wrap gap-2 border-t border-line bg-surface px-4 py-3">
      {card.sessionId && (
        <button className="btn py-1" disabled={!linked} onClick={() => openSession(card.sessionId!)} title={linked ? 'Read along in the app (Esc comes back). Answer Claude in its terminal tab; sending from the app forks the session.' : 'The session hasn’t shown up in the session list yet'}>
          <Key k={expand} size="sm" />Its session
        </button>
      )}
      {card.cwd && <button className="btn py-1" onClick={() => goToTab(card.id)} title="Bring its Windows Terminal tab to the front"><Key k="g" size="sm" />Its tab</button>}
      <TryButtons card={card} />
      {(card.kind === 'qa' || card.kind === 'review') ? (card.report || card.live?.lastMessage) && (
        <button className={`btn py-1 ${card.report ? 'btn-primary' : ''}`} onClick={() => shipKey(card.id)}>
          <Key k="s" size="sm" tone={card.report ? 'ghost' : undefined} />{card.kind === 'qa' ? 'QA report' : 'Findings'}
        </button>
      ) : card.stage !== 'done' && (card.sessionId || card.ship?.pr) && (
        <button className={`btn py-1 ${card.stage === 'try' || card.ship?.pr ? 'btn-primary' : ''}`} onClick={() => shipKey(card.id)}>
          <Key k="s" size="sm" tone={card.stage === 'try' || card.ship?.pr ? 'ghost' : undefined} />{card.ship?.pr?.state === 'OPEN' ? `Merge #${card.ship.pr.number}` : 'Ship'}
        </button>
      )}
      {card.stage !== 'done' && <button className="btn py-1" onClick={() => openAddComposer(card.id)}><Key k="c" size="sm" />Add context</button>}
      <button className="btn py-1" onClick={() => set({ modal: { kind: 'deleteCard', id: card.id } })}><Key k="Delete" size="sm" />Remove card</button>
    </div>
  );
}

/** The drawer's t / o buttons. */
function TryButtons({ card }: { card: Card }) {
  const has = useStore((s) => Boolean(cardRecipe(s.recipes, card.workspaceId, cardRepos(card)[0])));
  const run = useStore((s) => s.runs[card.id]);
  const live = run?.state === 'running' || run?.state === 'up';
  if (!has && !live) return null;
  return (
    <>
      <button className={`btn py-1 ${!live && card.stage === 'try' ? 'btn-primary' : ''}`} onClick={() => tryIt(card.id)}><Key k="t" size="sm" tone={!live && card.stage === 'try' ? 'ghost' : undefined} />{live ? 'Stop the app' : 'Try it'}</button>
      {run?.state === 'up' && run.url && <button className="btn py-1" onClick={() => openApp(card.id)}><Key k="o" size="sm" />Open the app</button>}
    </>
  );
}

function Sec({ id, title, right, children }: { id?: string; title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="grid gap-2.5 border-b border-line px-5 py-3.5">
      {(title || right) && <div className="flex items-center gap-2">{title && <h4 className="grow text-sm font-bold">{title}</h4>}{right}</div>}
      {children}
    </section>
  );
}

function Overview({ card }: { card: Card }) {
  const act = cardActivity(card);
  const size = tokens(packetText(card, card.key, card.branchName));
  return (
    <>
      {booting(card) && (
        <Sec>
          <div className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold ${act.state === 'bad' ? 'bg-attn-bg text-attn' : 'bg-busy-bg text-busy'}`}>
            {act.state === 'go' && <span className="spinner" />}
            <span className="grow">{act.text}</span>
            <span className="font-medium">see <Key k="Tab" size="sm" inline /> Context</span>
          </div>
        </Sec>
      )}
      {!booting(card) && <LiveNow card={card} />}
      {card.todos?.length ? (
        <Sec title="Steps" right={<span className="text-sm text-faint">{progress(card)!.done}/{card.todos.length}, from Claude’s to-do list</span>}>
          <ol className="grid gap-1.5">
            {card.todos.map((t) => (
              <li key={t.id} className={`flex items-center gap-2.5 text-sm ${t.status === 'pending' ? 'text-sub' : ''}`}>
                <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full font-mono text-[11px] font-bold ${t.status === 'completed' ? 'bg-ok-bg text-ok' : t.status === 'in_progress' ? 'text-busy' : 'border-2 border-line'}`}>
                  {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? <span className="spinner" /> : ''}
                </span>
                <span>{t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}</span>
              </li>
            ))}
          </ol>
        </Sec>
      ) : null}
      {card.files?.length ? (
        <Sec title="What changed" right={<button className="flex items-center gap-1.5 text-sm text-faint hover:text-ink" onClick={() => openChanges(card.id)} title="The diffs, file by file">{card.files.length} file{card.files.length === 1 ? '' : 's'} written or edited · diffs <Key k="⇧D" size="sm" /></button>}>
          <ul className="grid gap-1 font-mono text-[12.5px]">
            {card.files.map((f) => <li key={f} className="truncate" title={f}>{shortPath(f, card.cwd)}</li>)}
          </ul>
        </Sec>
      ) : null}
      {card.report && (
        <Sec title={card.kind === 'qa' ? 'QA report' : 'Review findings'} right={<button className="flex items-center gap-1.5 text-sm text-faint hover:text-ink" onClick={() => shipKey(card.id)}>copy <Key k="s" size="sm" /></button>}>
          <div className="md max-h-80 overflow-y-auto text-sm"><Markdown remarkPlugins={[remarkGfm]}>{card.report.text}</Markdown></div>
        </Sec>
      )}
      {card.pr && (
        <Sec title="Pull request">
          <p className="text-sm"><a className="underline hover:text-acc" href={card.pr.url} target="_blank" rel="noreferrer">PR #{card.pr.number} {card.pr.title}</a> · <span className="font-mono text-[12.5px]">{card.pr.source} → {card.pr.target}</span></p>
        </Sec>
      )}
      {card.live?.lastMessage && card.live.phase !== 'working' && !card.live.ask && !(card.report && card.live.lastMessage.includes(card.report.text.slice(0, 200))) && (
        <Sec title="Claude said">
          <div className="md max-h-64 overflow-y-auto text-sm"><Markdown remarkPlugins={[remarkGfm]}>{card.live.lastMessage}</Markdown></div>
        </Sec>
      )}
      {card.ship && <Shipped card={card} />}
      {!booting(card) && <TryIt card={card} />}
      <Sec title="Where it runs">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          {card.ticket && <><dt className="text-faint">Ticket</dt><dd>{card.ticket.url ? <a className="underline hover:text-acc" href={card.ticket.url} target="_blank" rel="noreferrer">{card.ticket.key} in {SOURCE_NAME[card.ticket.source]}</a> : `${card.ticket.key}${card.ticket.demo ? ' (a demo ticket)' : ''}`} · {card.ticket.status}</dd></>}
          <dt className="text-faint">Terminal tab</dt><dd>Titled <b>{card.key}</b> in Windows Terminal. Type to Claude there.</dd>
          <dt className="text-faint">Folder</dt><dd className="break-all font-mono text-[12.5px]">{card.cwd}</dd>
          {card.branchName && <><dt className="text-faint">Branch</dt><dd className="font-mono text-[12.5px]">{card.branchName}</dd></>}
          <dt className="text-faint">Model</dt><dd>{modelName(card.model ?? card.launch.model)}{!card.launch.model && card.model ? <span className="text-faint"> (the default)</span> : null}</dd>
          <dt className="text-faint">Session</dt><dd className="font-mono text-[12.5px]">{card.sessionId ?? 'not linked yet'}</dd>
          <dt className="text-faint">Started</dt><dd>{new Date(card.createdAt).toLocaleString()}</dd>
        </dl>
      </Sec>
      <Sec>
        <div className="flex items-center gap-2 text-sm">
          <h4 className="grow font-bold">Context</h4>
          <span className="text-faint">{fmtK(size)} · {cardRepos(card).length} repos · {card.later?.length ?? 0} added since · <Key k="Tab" size="sm" inline /> for all of it</span>
        </div>
      </Sec>
    </>
  );
}

/** The card's pull request and how shipping went. */
function Shipped({ card }: { card: Card }) {
  const pr = card.ship!.pr;
  return (
    <Sec title="Ship" right={pr && <span className="text-sm text-faint">{pr.checkedAt ? `looked at ${clock(pr.checkedAt)}` : ''}</span>}>
      {pr && (
        <div className="flex items-center gap-2.5 rounded-lg bg-busy-bg px-3 py-2 text-sm font-semibold text-busy">
          <a className="grow underline" href={pr.url} target="_blank" rel="noreferrer">{prLine(pr)}</a>
          {pr.state === 'OPEN' && <button className="flex items-center gap-1.5" onClick={() => shipKey(card.id)}><Key k="s" size="sm" />merge</button>}
        </div>
      )}
      <ol className="grid gap-1 text-[13px]">
        {card.ship!.steps.map((st, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <time className="w-[68px] shrink-0 font-mono text-xs tabular-nums text-faint">{clock(st.at)}</time>
            <span className={`w-4 shrink-0 text-center font-mono text-xs font-bold ${st.state === 'ok' ? 'text-ok' : st.state === 'bad' ? 'text-bad' : 'text-busy'}`}>{st.state === 'go' ? <span className="spinner inline-block" /> : st.state === 'ok' ? '✓' : '✗'}</span>
            <span className={st.state === 'bad' ? 'text-bad' : ''}>{st.text}</span>
          </li>
        ))}
      </ol>
    </Sec>
  );
}

/** A step's mark: $ waiting, a spinner, ✓, ● serving, ✗, – stopped, ☐ by hand. */
function StepMark({ s }: { s: RunStep['state'] }) {
  if (s === 'go') return <span className="spinner inline-block text-busy" />;
  const marks: Record<Exclude<RunStep['state'], 'go'>, [string, string]> = { wait: ['$', 'text-faint'], ok: ['✓', 'text-ok'], up: ['●', 'text-ok'], bad: ['✗', 'text-bad'], off: ['–', 'text-faint'], note: ['☐', 'text-attn'] };
  const [mark, tone] = marks[s];
  return <span className={`font-bold ${tone}`}>{mark}</span>;
}

/** One step of a recipe: its mark, the repo it runs in, the variables it sets (names only), the command or what to do by hand. */
function StepRow({ s }: { s: RunStep }) {
  return (
    <li className={`flex min-w-0 items-center gap-2.5 ${s.state === 'wait' || s.state === 'off' ? 'text-sub' : ''}`}>
      <span className="w-4 shrink-0 text-center"><StepMark s={s.state} /></span>
      {s.state === 'note'
        ? <><span className="shrink-0 rounded bg-attn-bg px-1 font-sans text-[10.5px] font-bold uppercase text-attn">by hand</span><span className="min-w-0 grow truncate font-sans">{s.cmd}</span></>
        : <>
          {s.repo && <span className="shrink-0 rounded border border-line bg-raise px-1 text-[11px] text-sub">{s.repo}</span>}
          {s.env?.length ? <span className="shrink-0 text-[11px] text-faint" title="Variables this step sets (values hidden)">{s.env.join(' ')}</span> : null}
          <span className="min-w-0 grow truncate" title={s.cmd}>{s.cmd}</span>
          {s.waitFor && s.state === 'go' && <span className="shrink-0 font-sans text-[11px] text-busy">waiting for {s.waitFor}{s.waitNote ? ` · ${s.waitNote}` : ''}</span>}
        </>}
      {s.state === 'bad' && <span className="shrink-0 text-bad">{s.waitNote ?? (s.code === undefined ? 'can’t run' : `exit ${s.code}`)}</span>}
      {s.state === 'up' && <span className="shrink-0 text-ok">serving</span>}
    </li>
  );
}

/** Try it: the card's run recipe, each step as it runs, where the app is, and what a failing step said. */
function TryIt({ card }: { card: Card }) {
  const home = cardRepos(card)[0];
  const recipe = useStore((s) => cardRecipe(s.recipes, card.workspaceId, home));
  const wsName = useStore((s) => s.workspaces.find((w) => w.id === card.workspaceId)?.name);
  const last: CardRun | undefined = useStore((s) => s.runs[card.id]);
  const specs = recipe ? specsOf(recipe) : [];
  const stack = recipe?.stack;
  // A finished run is shown while it is still this recipe's; after an edit, the new steps are. A
  // stack's steps depend on what was picked, so its last run is shown.
  const live = last?.state === 'running' || last?.state === 'up';
  const run = last && (live || stack || (recipe && last.steps.map((s) => s.cmd).join('\n') === specs.map((s) => s.cmd).join('\n'))) ? last : undefined;
  const name = stack ? `${wsName ?? 'the workspace'} stack${run?.choice ? ` · ${run.choice}` : ''}` : recipe?.workspaceId ? `${wsName ?? 'the workspace'} workspace` : home ? repoName(home) : card.key;
  const all: RunStep[] = run?.steps ?? specs.map((s) => ({
    cmd: s.cmd, state: s.note ? 'note' as const : 'wait' as const, tail: [],
    ...(s.repo ? { repo: s.repo } : {}), ...(Object.keys(s.env).length ? { env: Object.keys(s.env) } : {}), ...(s.stop ? { stop: true } : {}),
  }));
  const steps = all.filter((s) => !s.stop);
  const stops = all.filter((s) => s.stop);
  const shown = run?.steps.find((s) => s.state === 'bad') ?? run?.steps.find((s) => s.state === 'go') ?? (run?.state === 'up' ? run.steps.find((s) => s.state === 'up') : undefined);
  return (
    <Sec id="try-it" title={`Try it · ${name}${stack ? '' : ' run recipe'}`} right={
      <button className="flex items-center gap-1.5 text-sm text-faint hover:text-ink" onClick={() => editRecipe(card.id)} title="Write or edit the run recipe">
        {recipe ? recipe.source : 'no recipe yet'} · edit <Key k="e" size="sm" />
      </button>}>
      {steps.length ? (
        <ol className="grid min-w-0 gap-1 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[12.5px]">
          {steps.map((s, i) => <StepRow key={i} s={s} />)}
          {stops.length > 0 && <li className="mt-1 font-sans text-[11px] font-bold uppercase tracking-wide text-faint">When stopped</li>}
          {stops.map((s, i) => <StepRow key={`stop${i}`} s={s} />)}
        </ol>
      ) : stack ? (
        <div className="grid gap-1 rounded-lg border border-line bg-bg px-3 py-2 text-[13px]">
          <div><span className="eyebrow mr-2">Asks</span>{Object.entries(stack.choose).map(([k, v]) => `${k}: ${v.join(' / ')}`).join(' · ') || 'nothing'}</div>
          <div><span className="eyebrow mr-2">APIs</span><span className="font-mono">{stack.apis.map((a) => a.repo).join(', ') || 'none set up'}</span></div>
          {stack.ui && <div><span className="eyebrow mr-2">Then</span><span className="font-mono">{stack.ui.repo}</span>{stack.ui.proxyFile ? <span className="text-faint">, its {stack.ui.proxyFile} pointed at the APIs you pick</span> : null}</div>}
        </div>
      ) : <p className="text-sm text-faint">No run recipe for {name}: nothing to go on in its package.json or compose file. Press <Key k="e" size="sm" inline /> to write one.</p>}
      {run?.state === 'up' && (
        <div className="flex items-center gap-2.5 rounded-lg bg-ok-bg px-3 py-2 text-sm font-semibold text-ok">
          <span className="h-2 w-2 rounded-full bg-ok" />
          <span className="grow">{run.text}</span>
          {run.url && <button className="flex items-center gap-1.5 font-semibold" onClick={() => openApp(card.id)}><Key k="o" size="sm" />open</button>}
        </div>
      )}
      {run && run.state !== 'up' && run.state !== 'running' && (
        <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${run.state === 'failed' ? 'bg-bad-bg text-bad' : 'bg-raise text-sub'}`}>{run.text}. <Key k="t" size="sm" inline /> runs it again.</div>
      )}
      {recipe?.source.startsWith('from the workspace file') && !run && <div className="rounded-lg bg-attn-bg px-3 py-2 text-sm text-attn">This recipe came with a workspace file someone shared. Read the commands before pressing <Key k="t" size="sm" inline />: they run on this machine.</div>}
      {shown && shown.tail.length > 0 && (
        <pre className="m-0 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[11.5px] leading-snug text-sub">{shown.tail.join('\n')}</pre>
      )}
      {!run && recipe && <p className="text-sm text-faint">{stack
        ? <>Press <Key k="t" size="sm" inline /> to pick the environment and the APIs to run, then start them and the UI.</>
        : <>Press <Key k="t" size="sm" inline /> to start the app in the card’s folder and try the change.</>}</p>}
    </Sec>
  );
}

/**
 * What the session is doing now. When it waits on you, what it asks, and where to answer: the
 * terminal tab. Answering from here needs the channel (a preview flag), which comes later.
 */
function LiveNow({ card }: { card: Card }) {
  const now = useNow(true);
  const live = card.live;
  if (!live) return null;
  const ask = askOf(card);
  if (ask) {
    return (
      <Sec>
        <div className="grid gap-2.5 rounded-xl border border-attn/45 bg-attn-bg px-3.5 py-3">
          <h4 className="text-sm font-bold text-attn">{ask.kind === 'plan' ? 'Plan ready for review' : ask.kind === 'question' ? 'Claude is asking' : 'Claude wants to go ahead'}</h4>
          {ask.kind === 'plan' && ask.plan
            ? <div className="md max-h-80 overflow-y-auto rounded-lg border border-line bg-surface px-3 py-2 text-sm"><Markdown remarkPlugins={[remarkGfm]}>{ask.plan}</Markdown></div>
            : <p className="text-[15px] font-semibold">{ask.kind === 'question' ? ask.detail : `Allow ${ask.detail ?? ask.tool}?`}</p>}
          <p className="text-sm text-sub">{ask.requestId ? <><Key k="y" size="sm" inline /> allows, <Key k="n" size="sm" inline /> denies, straight to its terminal.</> : card.channel && ask.kind === 'question' ? <>Answer in the message box (<Key k="Enter" size="sm" inline />): it goes into the session.</> : <>Answer it in the terminal tab <b>{card.key}</b>: <Key k="g" size="sm" inline /> brings it forward. Nothing changes until you do.</>}</p>
        </div>
      </Sec>
    );
  }
  const state = cardActivity(card).state;
  return (
    <Sec>
      <div className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold ${state === 'go' ? 'bg-busy-bg text-busy' : state === 'off' ? 'bg-raise text-sub' : 'bg-ok-bg text-ok'}`}>
        {state === 'go' ? <span className="spinner" /> : <span className={`h-2 w-2 rounded-full ${state === 'off' ? 'bg-faint' : 'bg-ok'}`} />}
        <span className="grow">{live.text}</span>
        {live.turnSince && <span className="font-mono text-xs font-medium tabular-nums">{elapsed(live.turnSince, now)}</span>}
      </div>
    </Sec>
  );
}

function Chips({ items }: { items: PacketItem[] }) {
  const on = items.filter((i) => i.on);
  if (!on.length) return <span className="text-sm text-faint">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {on.map((i) => <span key={i.kind + i.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raise px-2.5 py-0.5 text-[12.5px]">{i.kind === 'repo' ? `repo · ${i.label}` : i.label}</span>)}
    </div>
  );
}

function ContextTab({ card, wsName }: { card: Card; wsName?: string }) {
  const text = packetText(card, card.key, card.branchName);
  const size = tokens(text);
  return (
    <>
      <Sec title="How it started">
        <ol className="grid gap-1.5 text-[13.5px]">
          {card.boot.map((b, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <time className="w-[68px] shrink-0 pt-px font-mono text-xs tabular-nums text-faint">{clock(b.at)}</time>
              <span className={`w-4 shrink-0 text-center font-mono text-xs font-bold ${b.state === 'ok' ? 'text-ok' : b.state === 'bad' ? 'text-attn' : 'text-busy'}`}>
                {b.state === 'go' ? <span className="spinner inline-block" /> : b.state === 'ok' ? '✓' : '!'}
              </span>
              <span className={b.state === 'bad' ? 'text-attn' : ''}>{b.text}</span>
            </li>
          ))}
        </ol>
      </Sec>
      <Sec title="What Claude was given" right={<span className="text-sm text-faint">{fmtK(size)} · {memoryPct(size)}% of its memory</span>}>
        <div className="grid gap-1.5"><div className="flex gap-2 text-[13px]"><b>Workspace</b><span className="text-faint">{wsName ? `shared by every ${wsName} card` : 'no workspace'}</span></div><Chips items={card.packet.workspace} /></div>
        <div className="grid gap-1.5">
          <div className="flex gap-2 text-[13px]"><b>Ticket</b><span className="text-faint">{card.ticket ? `from ${SOURCE_NAME[card.ticket.source]} ${card.ticket.key}${card.ticket.demo ? ' (a demo ticket)' : ''}` : 'no ticket'}</span></div>
          {card.ticket && <Chips items={card.packet.ticket} />}
        </div>
        <div className="grid gap-1.5">
          <div className="flex gap-2 text-[13px]"><b>This card</b><span className="text-faint">added when it started</span></div>
          {card.packet.card.some((i) => i.on) || card.packet.note.trim()
            ? <div className="flex flex-wrap gap-1.5"><Chips items={card.packet.card} />{card.packet.note.trim() && <span className="rounded-full border border-line bg-raise px-2.5 py-0.5 text-[12.5px]">your note: “{card.packet.note.trim().slice(0, 40)}{card.packet.note.trim().length > 40 ? '…' : ''}”</span>}</div>
            : <span className="text-sm text-faint">Nothing extra</span>}
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-faint hover:text-ink">The exact text, as the SessionStart hook returned it</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-line bg-bg px-3.5 py-3 font-mono text-[12.5px] leading-relaxed">{text}</pre>
        </details>
      </Sec>
      <AddedSince card={card} />
    </>
  );
}

/** Context added since the card started: what waits for the next message in its tab, and what went in. */
function AddedSince({ card }: { card: Card }) {
  const later = card.later ?? [];
  const left = waiting(card);
  return (
    <Sec id="added-since" title="Added since it started" right={card.stage !== 'done' && <button className="btn py-0.5 text-[13px]" onClick={() => openAddComposer(card.id)}><Key k="c" size="sm" />Add context</button>}>
      {later.length ? (
        <ol className="grid min-w-0 gap-1.5 text-[13.5px]">
          {later.map((i) => (
            <li key={i.id} className="flex min-w-0 items-center gap-2.5">
              <time className="w-[68px] shrink-0 font-mono text-xs tabular-nums text-faint">{clock(i.sent ?? i.at)}</time>
              <span className="min-w-0 grow truncate" title={i.text ?? i.label}>{i.kind === 'repo' ? `Repo: ${i.label}` : i.label} <span className="font-mono text-[11.5px] text-faint">{fmtK(itemTokens(i))}</span></span>
              {i.sent
                ? <span className="whitespace-nowrap rounded-full bg-ok-bg px-2 text-[11px] font-semibold text-ok">delivered</span>
                : <span className="whitespace-nowrap rounded-full bg-attn-bg px-2 text-[11px] font-semibold text-attn">{card.sessionId ? 'goes with your next message' : 'goes in when it starts'}</span>}
            </li>
          ))}
        </ol>
      ) : <p className="text-sm text-faint">Nothing yet. Press <Key k="c" size="sm" inline /> to add a repo, a related ticket or a note.</p>}
      {left.length > 0 && <p className="text-sm text-faint"><Key k="x" size="sm" inline /> takes back the last one still waiting.</p>}
      <p className="text-sm text-faint">What you add goes in with your next message in its tab, {card.key}.</p>
    </Sec>
  );
}

function TranscriptTab({ card }: { card: Card }) {
  const items = useStore((s) => (card.sessionId ? s.transcripts[card.sessionId] : undefined));
  useEffect(() => {
    if (card.sessionId) send({ type: 'session.open', id: card.sessionId });
  }, [card.sessionId]);
  if (!card.sessionId) return <Sec><p className="text-sm text-faint">The transcript shows once the session has started and linked to this card.</p></Sec>;
  return (
    <Sec>
      <div className="grid gap-3">
        {items?.length ? <Transcript items={items} cwd={card.cwd} expand={false} /> : <p className="text-sm text-faint">Nothing written yet.</p>}
      </div>
      {!card.channel && <p className="text-sm text-faint">Read as it is written. To answer or type, switch to its terminal tab, {card.key}.</p>}
    </Sec>
  );
}

/**
 * The message box into the card's terminal session, through its channel: what you type here is
 * typed there. Without a channel (the card started before channels, or the tab is gone), it says so.
 */
function Say({ card }: { card: Card }) {
  if (!card.sessionId || card.live?.phase === 'ended') return null;
  if (!card.channel) {
    return <div className="border-t border-line px-5 py-2.5 text-[13px] text-faint">This card’s terminal can’t be reached from here (it started without a channel, or the tab closed): type in its tab, {card.key}.</div>;
  }
  const ask = askOf(card);
  const answerable = Boolean(ask?.requestId);
  return (
    <div className="grid gap-2 border-t border-line bg-surface px-4 py-3">
      {ask && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-attn-bg px-3 py-2 text-sm">
          <span className="grow font-semibold text-attn">{ask.kind === 'plan' ? 'Approve the plan?' : ask.kind === 'question' ? 'Claude is asking: answer below' : `Allow ${ask.detail ?? ask.tool}?`}</span>
          {answerable
            ? <><button className="btn py-0.5" onClick={() => answerAsk(card.id, 'allow')}><Key k="y" size="sm" />{ask.kind === 'plan' ? 'Approve' : 'Allow'}</button>
              <button className="btn py-0.5" onClick={() => answerAsk(card.id, 'deny')}><Key k="n" size="sm" />{ask.kind === 'plan' ? 'Not yet' : 'Deny'}</button></>
            : ask.kind !== 'question' && <span className="text-faint">answer in its tab</span>}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea id="card-say" rows={2} placeholder={`Type to ${card.key}’s terminal… Enter sends, Shift+Enter is a new line`} spellCheck={false}
          className="field grow resize-none text-[13.5px]" />
        <button className="btn btn-primary py-1.5" onClick={() => saySubmit(card.id)} title="Sends into the terminal session itself, not a copy"><Key k="Enter" size="sm" tone="ghost" />Send</button>
      </div>
    </div>
  );
}
