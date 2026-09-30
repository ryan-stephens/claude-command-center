// The Ticket Line (PLAN §27, spec: docs/futures/path-line.html), the home page: work as cards
// moving left to right through the loop, a drawer for one card, and the new-card screen over the
// whole board. Cards run in terminal tabs
// and follow their session through its hooks (server/card-events.ts).

import { useEffect, useRef, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cardRepos, fmtK, itemTokens, memoryPct, modelName, packetText, tokens, waiting, type Card, type PacketItem } from '../../shared/cards.ts';
import { homeRepo, repoName, samePath } from '../../shared/workspaces.ts';
import { bindingsFor, displayCombo } from '../bindings.ts';
import { importWorkspace } from '../commands.ts';
import { openSession } from '../keys.ts';
import { SOURCE_NAME, type Ticket } from '../../shared/tickets.ts';
import { age } from '../home-model.ts';
import { booting, cardActivity, elapsed, needsYou, progress, shortPath, ticketFocus } from '../line-model.ts';
import { boardOf, openAddComposer, openCard, openComposer, workspaceKey } from '../line-keys.ts';
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
        {drawer && <Drawer id={drawer} />}
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
      ) : (
        <span className="whitespace-nowrap text-faint">{count ? `All ${count} workspaces. Pick one (1–9) to see its repos; + and − ask which.` : 'No workspaces yet. A workspace groups the repos you work on together: W makes one.'}</span>
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
          <div className="min-h-[30px] border-b border-line px-3 pb-2 text-xs text-faint">{GATE[l.stage]}</div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
            {l.tickets.map((tk) => <TicketTile key={tk.key} t={tk} focused={ticketFocus(tk.key) === focus} color={color(tk.workspaceId)} />)}
            {l.cards.length || l.tickets.length
              ? l.cards.map((c) => <CardTile key={c.id} card={c} focused={c.id === focus} color={color(c.workspaceId)} />)
              : <div className="rounded-xl border border-dashed border-line px-1.5 py-3 text-center text-[12.5px] text-faint">{EMPTY[l.stage]}</div>}
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
        <span>{ws?.name ?? `${t.projectName} · no workspace`}</span><span>·</span><span>{t.status}</span><span>·</span><span>{age(t.updatedAt)}</span>
      </span>
    </button>
  );
}

/** What moves a card on from each column. Only Start work exists yet; the rest arrive with their milestones. */
const GATE: Record<Card['stage'], string> = {
  inbox: 'n starts work on a ticket',
  plan: 'Claude plans; approve it in its tab',
  build: 'Watch it work',
  needs: 'Answer in its terminal tab',
  try: 'Its turn ended with changes',
  ship: 'Commit, PR, review',
  done: 'Merged',
};
const EMPTY: Record<Card['stage'], ReactNode> = {
  inbox: <>No tickets here. <Key k="⇧T" size="sm" /> connects Jira or Trello (or shows demo tickets); <Key k="c" size="sm" /> starts a card without one.</>,
  plan: 'Empty', build: 'Empty', needs: 'Nothing waiting on you', try: 'Empty', ship: 'Empty', done: 'Merged PRs land here',
};

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
        <span className="grow" />
        <Pill tone="grey">terminal</Pill>
      </span>
      <span className="text-[14px] font-semibold leading-snug">{card.title}</span>
      <ActLine card={card} />
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

const TABS = [['over', 'Overview'], ['ctx', 'Context'], ['tx', 'Transcript']] as const;

function Drawer({ id }: { id: string }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id));
  const tab = useStore((s) => s.line.tab);
  const ws = useStore((s) => s.workspaces.find((w) => w.id === card?.workspaceId) ?? null);
  if (!card) return null;
  const stage = { inbox: 'Inbox', plan: 'Plan', build: 'Build', needs: 'Needs you', try: 'Try it', ship: 'Ship', done: 'Done' }[card.stage];
  return (
    <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-[620px] flex-col border-l border-line bg-surface shadow-[-24px_0_40px_-24px_rgb(0_0_0/0.45)]" aria-label={`${card.key} ${card.title}`}>
      <div className="grid gap-2.5 border-b border-line px-5 pt-4">
        <div className="flex items-start gap-3">
          <WsBadge ws={ws} size={28} />
          <div className="flex min-w-0 grow flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <TicketKey k={card.key} source={card.ticket?.source} />
              <Pill tone={needsYou(card) ? 'amber' : 'grey'}>{stage}</Pill>
              <Pill tone="grey">terminal · tab {card.key}</Pill>
              <span className="text-faint">{ws?.name ?? 'No workspace'}</span>
            </div>
            <h2 className="text-[19px] font-bold leading-snug tracking-tight">{card.title}</h2>
          </div>
          <button className="flex shrink-0 items-center gap-1.5 text-sm text-faint hover:text-ink" onClick={() => set({ line: { ...get().line, drawer: null } })}>Close <Key k="Esc" size="sm" /></button>
        </div>
        <div className="flex items-center gap-1">
          {TABS.map(([t, name]) => (
            <button key={t} onClick={() => set({ line: { ...get().line, tab: t } })}
              className={`border-b-2 px-3 py-1.5 text-sm font-semibold ${tab === t ? 'border-acc text-ink' : 'border-transparent text-faint hover:text-sub'}`}>{name}</button>
          ))}
          <Key k="Tab" size="sm" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'ctx' ? <ContextTab card={card} wsName={ws?.name} /> : tab === 'tx' ? <TranscriptTab card={card} /> : <Overview card={card} />}
      </div>
      <DrawerActions card={card} />
    </aside>
  );
}

function DrawerActions({ card }: { card: Card }) {
  const expand = useExpandKey();
  const linked = useStore((s) => Boolean(card.sessionId && s.sessions.some((x) => x.id === card.sessionId)));
  return (
    <div className="flex flex-wrap gap-2 border-t border-line bg-col px-5 py-3">
      {card.sessionId && (
        <button className="btn py-1" disabled={!linked} onClick={() => openSession(card.sessionId!)} title={linked ? 'Read and type in this session in the app (Esc comes back)' : 'The session hasn’t shown up in the session list yet'}>
          <Key k={expand} size="sm" />Full screen
        </button>
      )}
      {card.stage !== 'done' && <button className="btn py-1" onClick={() => openAddComposer(card.id)}><Key k="c" size="sm" />Add context</button>}
      <button className="btn py-1" onClick={() => set({ modal: { kind: 'deleteCard', id: card.id } })}><Key k="Delete" size="sm" />Remove card</button>
    </div>
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
            <span className="font-medium">see <Key k="Tab" size="sm" /> Context</span>
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
        <Sec title="What changed" right={<span className="text-sm text-faint">{card.files.length} file{card.files.length === 1 ? '' : 's'} written or edited</span>}>
          <ul className="grid gap-1 font-mono text-[12.5px]">
            {card.files.map((f) => <li key={f} className="truncate" title={f}>{shortPath(f, card.cwd)}</li>)}
          </ul>
        </Sec>
      ) : null}
      {card.live?.lastMessage && card.live.phase !== 'working' && !card.live.ask && (
        <Sec title="Claude said">
          <div className="md max-h-64 overflow-y-auto text-sm"><Markdown remarkPlugins={[remarkGfm]}>{card.live.lastMessage}</Markdown></div>
        </Sec>
      )}
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
          <span className="text-faint">{fmtK(size)} · {cardRepos(card).length} repos · {card.later?.length ?? 0} added since · <Key k="Tab" size="sm" /> for all of it</span>
        </div>
      </Sec>
    </>
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
  const ask = live.ask;
  if (ask) {
    return (
      <Sec>
        <div className="grid gap-2.5 rounded-xl border border-attn/45 bg-attn-bg px-3.5 py-3">
          <h4 className="text-sm font-bold text-attn">{ask.kind === 'plan' ? 'Plan ready for review' : ask.kind === 'question' ? 'Claude is asking' : 'Claude wants to go ahead'}</h4>
          {ask.kind === 'plan' && ask.plan
            ? <div className="md max-h-80 overflow-y-auto rounded-lg border border-line bg-surface px-3 py-2 text-sm"><Markdown remarkPlugins={[remarkGfm]}>{ask.plan}</Markdown></div>
            : <p className="text-[15px] font-semibold">{ask.kind === 'question' ? ask.detail : `Allow ${ask.detail ?? ask.tool}?`}</p>}
          <p className="text-sm text-sub">Answer it in the terminal tab <b>{card.key}</b>. Nothing changes until you do.</p>
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
      ) : <p className="text-sm text-faint">Nothing yet. Press <Key k="c" size="sm" /> to add a repo, a related ticket or a note.</p>}
      {left.length > 0 && <p className="text-sm text-faint"><Key k="x" size="sm" /> takes back the last one still waiting.</p>}
      <p className="text-sm text-faint">This session runs in a terminal. Things you add wait here and go in with your next message in its tab {card.key}, sent by a UserPromptSubmit hook. After /clear, they go in again with the rest of the context.</p>
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
      <p className="text-sm text-faint">Read through the SDK as it is written. To type into this session, switch to its terminal tab, {card.key}.</p>
    </Sec>
  );
}
