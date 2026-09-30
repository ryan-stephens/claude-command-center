// The Ticket Line (PLAN §27, spec: docs/futures/path-line.html): work as cards moving left to right
// through the loop, a drawer for one card, and the new-card screen over the whole board.
// This first milestone runs cards in terminal tabs; stage tracking, tickets and the gates come next.

import { useEffect, type ReactNode } from 'react';
import { fmtK, includedRepos, memoryPct, packetText, tokens, type Card, type PacketItem } from '../../shared/cards.ts';
import { repoName } from '../../shared/workspaces.ts';
import { booting, cardActivity, lanes } from '../line-model.ts';
import { openCard, openComposer } from '../line-keys.ts';
import { get, set, useStore } from '../store.ts';
import { send } from '../ws.ts';
import { NewCard } from './NewCard.tsx';
import { Transcript } from './Transcript.tsx';
import { Key, Pill, SWATCH, WsBadge } from './ui.tsx';

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function TicketLine() {
  const composer = useStore((s) => Boolean(s.composer));
  const drawer = useStore((s) => s.line.drawer);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <LineBar />
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
  const chip = (on: boolean) => `flex items-center gap-2 whitespace-nowrap rounded-lg border px-2 py-1 text-[13.5px] ${on ? 'border-ring bg-surface shadow-[0_0_0_2px_color-mix(in_srgb,var(--c-ring)_25%,transparent)]' : 'border-line bg-surface hover:bg-raise'}`;
  const pick = (f: string) => set({ line: { ...get().line, filter: f } });
  return (
    <div className="flex items-center gap-3 overflow-x-auto border-b border-line bg-col px-4 py-2">
      <button className={chip(filter === 'all')} onClick={() => pick('all')}><Key k="0" size="sm" />All</button>
      {workspaces.slice(0, 9).map((w, i) => (
        <button key={w.id} className={chip(filter === w.id)} onClick={() => pick(w.id)}>
          <Key k={String(i + 1)} size="sm" /><WsBadge ws={w} size={20} />{w.name}
        </button>
      ))}
      <span className="grow" />
      <span className="whitespace-nowrap text-[13.5px] text-sub"><b className="text-ink tabular-nums">{inFlight}</b> in flight</span>
      {starting > 0 && <span className="whitespace-nowrap text-[13.5px] text-busy"><b className="tabular-nums">{starting}</b> starting</span>}
      <button className="btn whitespace-nowrap py-1" onClick={openComposer}><Key k="c" size="sm" />New card</button>
    </div>
  );
}

function Board() {
  const cards = useStore((s) => s.cards);
  const filter = useStore((s) => s.line.filter);
  const focus = useStore((s) => s.line.focus);
  const workspaces = useStore((s) => s.workspaces);
  const cols = lanes(cards, filter);
  useEffect(() => {
    if (focus) document.getElementById(`card-${focus}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focus]);
  return (
    <div className="grid min-h-0 flex-1 auto-cols-[minmax(190px,1fr)] grid-flow-col gap-2.5 overflow-x-auto p-3.5">
      {cols.map((l) => (
        <section key={l.stage} aria-label={l.name} className="flex min-h-0 flex-col rounded-xl border border-line bg-col">
          <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
            <h4 className={`text-[13px] font-bold ${l.stage === 'needs' && l.cards.length ? 'text-attn' : ''}`}>{l.name}</h4>
            <span className="font-mono text-xs font-bold text-faint">{l.cards.length}</span>
          </div>
          <div className="min-h-[30px] border-b border-line px-3 pb-2 text-xs text-faint">{GATE[l.stage]}</div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
            {l.cards.length
              ? l.cards.map((c) => <CardTile key={c.id} card={c} focused={c.id === focus} color={SWATCH[workspaces.find((w) => w.id === c.workspaceId)?.color ?? ''] ?? 'var(--c-line)'} />)
              : <div className="rounded-xl border border-dashed border-line px-1.5 py-3 text-center text-[12.5px] text-faint">{EMPTY[l.stage]}</div>}
          </div>
        </section>
      ))}
    </div>
  );
}

/** What moves a card on from each column. Only Start work exists yet; the rest arrive with their milestones. */
const GATE: Record<Card['stage'], string> = {
  inbox: 'Tickets from Jira and Trello land here',
  plan: 'Claude writes a plan first',
  build: 'Watch it work',
  needs: 'Claude is waiting on you',
  try: 'Run it and try the change',
  ship: 'Commit, PR, review',
  done: 'Merged',
};
const EMPTY: Record<Card['stage'], ReactNode> = {
  inbox: <>Ticket import comes next. <Key k="c" size="sm" /> starts a card without one.</>,
  plan: 'Empty', build: 'Empty', needs: 'Nothing waiting on you', try: 'Empty', ship: 'Empty', done: 'Merged PRs land here',
};

function CardTile({ card, focused, color }: { card: Card; focused: boolean; color: string }) {
  const act = cardActivity(card);
  return (
    <button
      id={`card-${card.id}`}
      onClick={() => openCard(card.id)}
      className={`flex flex-col gap-1.5 rounded-xl border border-l-4 bg-surface px-2.5 py-2 text-left text-[13px] ${focused ? 'is-focus' : 'border-line hover:bg-raise'}`}
      style={{ borderLeftColor: color }}
    >
      <span className="flex items-center gap-1.5">
        <span className="rounded-md bg-raise px-1.5 font-mono text-[11.5px] font-bold text-sub">{card.key}</span>
        <span className="grow" />
        <Pill tone="grey">terminal</Pill>
      </span>
      <span className="text-[14px] font-semibold leading-snug">{card.title}</span>
      <span className={`flex min-w-0 items-center gap-1.5 text-[12.5px] ${act.state === 'bad' ? 'font-semibold text-attn' : 'text-sub'}`}>
        {act.state === 'go' ? <span className="spinner text-busy" /> : <span className={`h-2 w-2 shrink-0 rounded-full ${act.state === 'bad' ? 'bg-attn' : 'bg-ok'}`} />}
        <span className="truncate">{act.text}</span>
      </span>
      <span className="flex flex-wrap gap-1">
        {includedRepos(card.packet).map((r) => <span key={r} className="rounded-md border border-line bg-raise px-1.5 font-mono text-[11.5px] text-sub">{repoName(r)}</span>)}
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
              <span className="rounded-md bg-raise px-1.5 font-mono text-[11.5px] font-bold text-sub">{card.key}</span>
              <Pill tone="grey">{stage}</Pill>
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
      <div className="flex flex-wrap gap-2 border-t border-line bg-col px-5 py-3">
        <button className="btn py-1" onClick={() => set({ modal: { kind: 'deleteCard', id: card.id } })}><Key k="Delete" size="sm" />Remove card</button>
      </div>
    </aside>
  );
}

function Sec({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2.5 border-b border-line px-5 py-3.5">
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
      <Sec title="Where it runs">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-faint">Terminal tab</dt><dd>Titled <b>{card.key}</b> in Windows Terminal. Type to Claude there.</dd>
          <dt className="text-faint">Folder</dt><dd className="break-all font-mono text-[12.5px]">{card.cwd}</dd>
          {card.branchName && <><dt className="text-faint">Branch</dt><dd className="font-mono text-[12.5px]">{card.branchName}</dd></>}
          <dt className="text-faint">Session</dt><dd className="font-mono text-[12.5px]">{card.sessionId ?? 'not linked yet'}</dd>
          <dt className="text-faint">Started</dt><dd>{new Date(card.createdAt).toLocaleString()}</dd>
        </dl>
      </Sec>
      <Sec>
        <div className="flex items-center gap-2 text-sm">
          <h4 className="grow font-bold">Context</h4>
          <span className="text-faint">{fmtK(size)} · {includedRepos(card.packet).length} repos · <Key k="Tab" size="sm" /> for all of it</span>
        </div>
      </Sec>
    </>
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
        <div className="grid gap-1.5"><div className="flex gap-2 text-[13px]"><b>Ticket</b><span className="text-faint">no ticket</span></div></div>
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
    </>
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
