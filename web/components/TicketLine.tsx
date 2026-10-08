// The Ticket Line, the home page: the bar (lanes, counts), Your Move's three bands (YourMove.tsx,
// §126: by whose turn it is, never by stage), one card full screen when you open it (CardView.tsx,
// §81), and the new-card screen over the whole page. Cards follow their session through its hooks
// (server/card-events.ts).

import { useRef, type MouseEvent } from 'react';
import { cardRepos, kindName, type Card } from '../../shared/cards.ts';
import { homeRepo, repoName, samePath } from '../../shared/workspaces.ts';
import { bindingsFor, displayCombo } from '../bindings.ts';
import { importWorkspace } from '../commands.ts';
import { cardActivity } from '../line-model.ts';
import { anyLive, cardRecipe, mainRun, type CardRun } from '../../shared/recipes.ts';
import { canTryCard, openApp, openComposer, restartApp, tryIt, workspaceKey } from '../line-keys.ts';
import { currentWorkspace, get, NO_BINDINGS, set, setFilter, useStore } from '../store.ts';
import { CardView } from './CardView.tsx';
import { YourMove } from './YourMove.tsx';
import { homeOf } from '../your-move.ts';
import { NewCard } from './NewCard.tsx';
import { NewCardSimple } from './NewCardSimple.tsx';
import { SLIM } from '../slim.ts';
import { Icon, Key, WsBadge } from './ui.tsx';

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
        <YourMove />
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
  // §126: the bands' counts, for every lane (the chips narrow the page, not these).
  useStore((s) => s.seen);
  useStore((s) => s.runs);
  useStore((s) => s.tried);
  useStore((s) => s.recipes);
  const now = get();
  const home = homeOf(cards, now.runs, now.seen ?? {}, 'all', '', { tried: now.tried, canTry: (c) => canTryCard(now, c) });
  const working = home.claude.length;
  const needs = home.you.length;
  const parked = home.parked.length;
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
      {!SLIM.filter && <SearchBox />}
      <span className="grow" />
      <span className={`whitespace-nowrap text-[13.5px] ${needs ? 'text-attn' : 'text-sub'}`} title="a goes to the next one"><b className={`tabular-nums ${needs ? '' : 'text-ink'}`}>{needs}</b> your move</span>
      <span className={`whitespace-nowrap text-[13.5px] ${working ? 'text-busy' : 'text-sub'}`}><b className={`tabular-nums ${working ? '' : 'text-ink'}`}>{working}</b> Claude working</span>
      <span className="whitespace-nowrap text-[13.5px] text-sub"><b className="tabular-nums text-ink">{parked}</b> parked</span>
      {!SLIM.lineButtons && <>
        <button className="btn whitespace-nowrap py-1" onClick={() => set({ modal: { kind: 'tickets' } })} title="Demo tickets, Jira and Trello, and which workspace each project goes to"><Key k="⇧T" size="sm" />Tickets</button>
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

/** Where the app is: behind a front door (§123), the door's address, which shows it or another card's. */
export function appAt(run: CardRun): string {
  if (run.door) return run.door.shown ? `App on localhost:${run.door.port}` : `App behind :${run.door.port}`;
  return `App at ${(run.url ?? 'running').replace(/^https?:\/\//, '')}`;
}

/** On a tile: the card's app, while it runs or when it failed. */
export function RunLine({ id }: { id: string }) {
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
export function ActLine({ card }: { card: Card }) {
  const act = cardActivity(card);
  return (
    <span className={`flex min-w-0 items-center gap-1.5 text-[12.5px] ${act.state === 'bad' ? 'font-semibold text-attn' : 'text-sub'}`}>
      {act.state === 'go' ? <span className="spinner text-busy" /> : <span className={`h-2 w-2 shrink-0 rounded-full ${act.state === 'bad' ? 'bg-attn' : act.state === 'off' ? 'bg-faint' : 'bg-ok'}`} />}
      <span className="truncate">{act.text}</span>
    </span>
  );
}

/**
 * Try it from the board (§104): Start, or Stop, Restart and Open, under a tile. Shown where it is
 * wanted without opening the card: cards in Try it or Ship, the chosen card, and any card whose app
 * runs or failed; only on cards that can run (a recipe, or a lane that has or can have a stack).
 */
export function TryButtons({ card, focused, compact }: { card: Card; focused: boolean; /** Inside a parked card's chip (§126): one row, no rule above. */ compact?: boolean }) {
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
    <div role="group" aria-label={`${card.key}’s app`} className={compact ? 'flex shrink-0 items-center gap-0.5 pr-1.5' : 'flex items-center gap-0.5 border-t border-line/70 px-1.5 py-1'}>
      {live ? (
        <>
          <button className={`${btn} text-acc`} disabled={!up} onClick={(e) => act(e, (id) => openApp(id))} title={up ? `Open ${run?.door?.url ?? run?.url} in a new tab` : 'The app is still starting'}><Icon name="popout" size={13} />Open<Key k="o" size="sm" /></button>
          {!compact && <span className="grow" />}
          <button className={`${btn} text-sub hover:text-ink`} aria-label="Stop" onClick={(e) => act(e, tryIt)} title="Stop the app (every service of the stack)"><Icon name="stop" size={13} /><Key k="t" size="sm" /></button>
          <button className={`${btn} text-sub hover:text-ink`} aria-label="Restart" onClick={(e) => act(e, restartApp)} title="Restart: stop it and start it again"><Icon name="restart" size={13} /><Key k="⇧R" size="sm" /></button>
        </>
      ) : (
        <button className={`${btn} text-acc`} onClick={(e) => act(e, tryIt)} title="Start the app the way the card’s repo or workspace says"><Icon name="play" size={13} />{run?.state === 'failed' ? 'Start again' : 'Start'}<Key k="t" size="sm" /></button>
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
