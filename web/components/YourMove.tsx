// The home page as Your Move (PLAN §126, chosen from five layouts on 2026-10-08): every card in
// three bands by whose turn it is. Your move: what waits on you, the longest wait first, answered
// on the card itself (y / n, a digit) or opened with Enter. Claude's move: working on its own.
// Parked: nobody waits on it. Tickets to start sit in a strip above; Done folds away below.
// The bands come from your-move.ts; the keys from line-keys.ts (boardKeys).

import { useEffect, type ReactNode } from 'react';
import { askOf, cardRepos, type Card } from '../../shared/cards.ts';
import { mainRun } from '../../shared/recipes.ts';
import { allMerged, prsLine, prsOf } from '../../shared/ship.ts';
import { INBOX_VIEWS, SOURCE_NAME, type Ticket } from '../../shared/tickets.ts';
import { repoName } from '../../shared/workspaces.ts';
import { answerAsk, DONE_FOCUS, doneTicketsOf, goToTab, homeNow, inboxOf, openCard, openComposer, switchInbox } from '../line-keys.ts';
import { elapsed, matches, ticketFocus } from '../line-model.ts';
import { flash, get, markSeen, set, toggleTicketsFolded, useStore } from '../store.ts';
import { NEED_LABEL, type Need, type Waiting } from '../your-move.ts';
import { useNow } from './ActivityBar.tsx';
import { ActLine, appAt, KindPill, RunLine, TryButtons } from './TicketLine.tsx';
import { Key, SWATCH, TicketKey } from './ui.tsx';
import { answerQuestionCard } from '../ws.ts';

const STRIP: Card['stage'][] = ['plan', 'build', 'try', 'ship'];

/** Where it is in the loop, as a small marker: Plan · Build · Try · Ship, the current step lit. */
function Stage({ card }: { card: Card }) {
  const stage = card.stage === 'needs' ? 'build' : card.stage === 'inbox' ? 'plan' : card.stage;
  const at = STRIP.indexOf(stage);
  return (
    <span className="inline-flex shrink-0 items-center gap-[3px]" title={`Where it is: ${stage === 'try' ? 'Try it' : stage[0].toUpperCase() + stage.slice(1)}`}>
      {STRIP.map((s, i) => <i key={s} className={`h-[3px] w-2.5 rounded-full ${i <= at ? 'bg-ok' : 'bg-line'}`} />)}
    </span>
  );
}

function useWsColor(id: string | null | undefined): string {
  return useStore((s) => SWATCH[s.workspaces.find((w) => w.id === id)?.color ?? ''] ?? 'var(--c-line)');
}

export function YourMove() {
  // Re-rendered when any of these change; homeNow reads them from the store.
  useStore((s) => s.cards);
  useStore((s) => s.runs);
  useStore((s) => s.seen);
  useStore((s) => s.tickets);
  useStore((s) => s.line.filter);
  useStore((s) => s.line.q);
  const doneOpen = useStore((s) => s.line.doneOpen);
  const focus = useStore((s) => s.line.focus);
  const any = useStore((s) => s.cards.length > 0 || s.tickets.length > 0);
  const h = homeNow(get());
  useEffect(() => {
    if (focus) document.getElementById(`card-${focus}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focus]);
  const doneTickets = doneTicketsOf(get());
  if (!any) return <FirstTime />;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
      <TicketStrip />
      <section aria-label="Your move" className="mb-5">
        <BandHead name="Your move" n={h.you.length} tone="attn" note={<>The longest wait first. Answer on the card, or <Key k="Enter" size="sm" inline /> opens it. <Key k="a" size="sm" inline /> goes to the next one.</>} />
        {h.you.length
          ? <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-2.5">{h.you.map((w) => <YouTile key={w.card.id} w={w} focused={focus === w.card.id} />)}</div>
          : <p className="text-[13px] text-faint">Nothing is waiting on you.{h.claude.length ? ` Claude has ${h.claude.length} in hand.` : ''}</p>}
      </section>
      <section aria-label="Claude’s move" className="mb-5">
        <BandHead name="Claude’s move" n={h.claude.length} note="Working on its own. It comes back up when it needs you or its turn ends." />
        {h.claude.length
          ? <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">{h.claude.map((c) => <ClaudeTile key={c.id} card={c} focused={focus === c.id} />)}</div>
          : <p className="text-[13px] text-faint">Nothing is running. <Key k="c" size="sm" inline /> starts a card.</p>}
      </section>
      <section aria-label="Parked" className="mb-4">
        <BandHead name="Parked" n={h.parked.length} note="Nobody is waiting on these. Enter opens one to pick it up again." />
        {h.parked.length
          ? <div className="flex flex-wrap gap-1.5">{h.parked.map((c) => <ParkedChip key={c.id} card={c} focused={focus === c.id} />)}</div>
          : <p className="text-[13px] text-faint">Nothing parked.</p>}
      </section>
      {(h.done.length > 0 || doneTickets.length > 0) && (
        <section aria-label="Done">
          <button
            id={`card-${DONE_FOCUS}`}
            onClick={(e) => { e.currentTarget.blur(); set({ line: { ...get().line, focus: DONE_FOCUS, doneOpen: !doneOpen } }); }}
            className={`flex items-center gap-2 rounded-lg px-2 py-1 text-[13px] font-semibold text-sub hover:bg-col ${focus === DONE_FOCUS ? 'is-focus' : ''}`}
            aria-expanded={doneOpen}
          >
            <span className="w-3 text-faint">{doneOpen ? '▾' : '▸'}</span>Done<span className="font-mono text-xs text-faint">{h.done.length + doneTickets.length}</span>
            {focus === DONE_FOCUS && <Key k="Enter" size="sm" />}
          </button>
          {doneOpen && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {h.done.map((c) => <ParkedChip key={c.id} card={c} focused={focus === c.id} />)}
              {doneTickets.map((t) => <span key={t.key} className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-2.5 py-0.5 text-[12px] text-faint" title={`${t.key} ${t.title} · ${t.status} in ${SOURCE_NAME[t.source]}, without a card`}><span className="font-mono">{t.key}</span><span className="max-w-[240px] truncate">{t.title}</span></span>)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function BandHead({ name, n, note, tone }: { name: string; n: number; note: ReactNode; tone?: 'attn' }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
      <h3 className={`text-[15px] font-bold ${tone === 'attn' && n ? 'text-attn' : ''}`}>{name}</h3>
      <span className="font-mono text-xs font-bold text-faint">{n}</span>
      <span className="text-[12.5px] text-faint">{note}</span>
    </div>
  );
}

/** Tickets no card has started: one row above the bands, folded with i. */
function TicketStrip() {
  const view = useStore((s) => s.line.view);
  const folded = useStore((s) => s.line.ticketsFolded);
  const q = useStore((s) => s.line.q);
  const focus = useStore((s) => s.line.focus);
  useStore((s) => s.tickets);
  useStore((s) => s.cards);
  const tickets = inboxOf(get()).filter((t) => matches(q, `${t.key} ${t.title}`));
  if (!tickets.length && view !== 'qa') return null;
  const other = INBOX_VIEWS.find((v) => v.id !== view)?.name;
  return (
    <section aria-label="Tickets to start" className="mb-4 rounded-xl border border-line bg-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-[13px] text-sub">
        <button onClick={toggleTicketsFolded} className="w-3 text-faint hover:text-ink" aria-label={folded ? 'Show the tickets' : 'Fold the tickets'} aria-expanded={!folded}>{folded ? '▸' : '▾'}</button>
        <b className="text-ink">{tickets.length} ticket{tickets.length === 1 ? '' : 's'} to start</b>
        <span>· {view === 'mine' ? 'Your tickets' : 'Ready for QA in your projects'} ·</span>
        <button onClick={switchInbox} className="underline decoration-dotted underline-offset-2 hover:text-ink">{other}</button><Key k="v" size="sm" />
        <span className="grow" />
        <Key k="i" size="sm" /><span className="text-faint">{folded ? 'show' : 'fold'}</span>
      </div>
      {!folded && (
        <div className="flex gap-2 overflow-x-auto px-3 pb-2.5">
          {tickets.length
            ? tickets.map((t) => <TicketChip key={t.key} t={t} focused={focus === ticketFocus(t.key)} />)
            : <span className="py-1 text-[12.5px] text-faint">Nothing Ready for QA in your projects. <Key k="c" size="sm" inline /> then <Key k="/" size="sm" inline /> searches Jira for any ticket.</span>}
        </div>
      )}
    </section>
  );
}

function TicketChip({ t, focused }: { t: Ticket; focused: boolean }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === t.workspaceId));
  const color = useWsColor(t.workspaceId);
  return (
    <button
      id={`card-${ticketFocus(t.key)}`}
      onClick={() => openComposer(t)}
      title={`${t.key} ${t.title}\n${SOURCE_NAME[t.source]} · ${t.projectName} · ${t.status}${t.demo ? '\nA demo ticket' : ''}\nn starts work on it`}
      className={`flex max-w-[250px] shrink-0 flex-col gap-0.5 rounded-lg border border-l-[3px] border-dashed bg-surface px-2.5 py-1.5 text-left text-[12.5px] ${focused ? 'is-focus' : 'border-line hover:bg-raise'}`}
      style={{ borderLeftColor: color, borderLeftStyle: 'solid' }}
    >
      <span className="flex items-center gap-1.5"><TicketKey k={t.key} source={t.source} />{focused && <Key k="n" size="sm" />}</span>
      <span className="truncate text-[13px] font-semibold">{t.title}</span>
      <span className="truncate text-[11.5px] text-faint">{ws?.name ?? t.projectName} · {t.status}{t.demo ? ' · demo' : ''}</span>
    </button>
  );
}

const NEED_TONE: Record<Need, string> = {
  tool: 'bg-attn-bg text-attn', plan: 'bg-attn-bg text-attn', question: 'bg-attn-bg text-attn', reply: 'bg-attn-bg text-attn', tab: 'bg-attn-bg text-attn',
  failed: 'bg-bad-bg text-bad', tryFailed: 'bg-bad-bg text-bad', unread: 'bg-busy-bg text-busy',
};

/** A card waiting on you: what it needs, how long it has waited, and the answer keys right on it. */
function YouTile({ w, focused }: { w: Waiting; focused: boolean }) {
  const { card, need } = w;
  const now = useNow(true);
  const color = useWsColor(card.workspaceId);
  const asking = need !== 'unread' && need !== 'failed' && need !== 'tryFailed';
  const long = asking && now - w.since >= 10 * 60_000;
  const bad = need === 'failed' || need === 'tryFailed';
  return (
    <div
      className={`flex min-w-0 flex-col rounded-xl border border-t-[3px] bg-surface text-[13px] ${focused ? 'is-focus' : bad ? 'border-bad/45' : long ? 'border-attn/55' : 'border-line'}`}
      style={{ borderTopColor: color }}
    >
      <button id={`card-${card.id}`} onClick={() => openCard(card.id)} className="flex flex-col gap-1 rounded-t-xl px-3 pb-1 pt-2 text-left hover:bg-raise/60">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`min-w-0 truncate whitespace-nowrap rounded px-1.5 font-mono text-[10px] font-bold uppercase leading-[18px] tracking-wide ${NEED_TONE[need]}`}>{need === 'unread' && card.stage === 'try' ? 'Finished · ready to try' : NEED_LABEL[need]}</span>
          <TicketKey k={card.key} source={card.ticket?.source} />
          {card.kind && card.kind !== 'build' && <KindPill card={card} />}
          <span className="grow" />
          <Stage card={card} />
          <span className={`shrink-0 whitespace-nowrap font-mono text-[11px] font-bold tabular-nums ${long ? 'text-attn' : 'text-faint'}`} title={asking ? 'How long it has waited on you' : 'When it happened'}>{asking ? 'waiting ' : ''}{elapsed(w.since, now)}{asking ? '' : elapsed(w.since, now) === 'just now' ? '' : ' ago'}</span>
        </span>
        <span className="text-[14px] font-semibold leading-snug">{card.title}</span>
      </button>
      <div className="px-3 pb-2.5"><Ask w={w} /></div>
      <TryButtons card={card} focused={focused} />
    </div>
  );
}

/** The thing a card needs, with the keys that answer it. Each button is the same function its key calls. */
function Ask({ w }: { w: Waiting }) {
  const { card, need } = w;
  const ask = askOf(card);
  const run = useStore((s) => mainRun(s.runs, card.id));
  const btn = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface py-0.5 pl-0.5 pr-2 text-[12.5px] font-semibold hover:bg-raise';
  const box = (tone: 'attn' | 'bad' | 'busy', children: ReactNode) => (
    <div className={`flex flex-col gap-2 rounded-lg border px-2.5 py-2 ${tone === 'attn' ? 'border-attn/45 bg-attn-bg' : tone === 'bad' ? 'border-bad/45 bg-bad-bg' : 'border-busy/30 bg-busy-bg'}`}>{children}</div>
  );
  const open = <button className={btn} onClick={() => openCard(card.id)}><Key k="Enter" size="sm" />{need === 'reply' ? 'Reply' : need === 'question' ? 'Answer' : 'Open it'}</button>;
  if (need === 'tool' || need === 'plan') {
    return box('attn', <>
      <span className="font-semibold">{need === 'plan' ? 'Its plan is ready' : `Wants to use ${ask?.tool ?? 'a tool'}`}</span>
      {need === 'plan'
        ? ask?.plan && <span className="line-clamp-3 whitespace-pre-line text-[12.5px] text-sub">{ask.plan.replace(/^#+\s*/gm, '')}</span>
        : ask?.detail && <span className="break-words rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[12px]">{ask.detail}</span>}
      <span className="flex flex-wrap gap-1.5">
        <button className={`${btn} text-acc`} onClick={() => answerAsk(card.id, 'allow')}><Key k="y" size="sm" tone="acc" />{need === 'plan' ? 'Approve the plan' : 'Allow'}</button>
        <button className={btn} onClick={() => answerAsk(card.id, 'deny')}><Key k="n" size="sm" />{need === 'plan' ? 'Keep planning' : 'Deny'}</button>
        {need === 'plan' && open}
      </span>
    </>);
  }
  if (need === 'question') {
    const qs = ask?.questions ?? [];
    const q = qs[0];
    const plain = qs.length === 1 && q && !q.multiSelect;
    return box('attn', <>
      <span className="font-semibold">{q?.question ?? ask?.detail}</span>
      {plain
        ? <span className="flex flex-wrap gap-1.5">{q.options.slice(0, 9).map((o, i) => (
          <button key={i} className={btn} title={o.description} onClick={() => answerQuestionCard(card.id, [{ picks: [i] }]).then(() => flash(`${card.key}: ${o.label}`), (e: Error) => flash(e.message))}><Key k={String(i + 1)} size="sm" tone="attn" />{o.label}</button>
        ))}{open}</span>
        : <span className="flex flex-wrap items-center gap-1.5">{open}<span className="text-[12px] text-faint">{qs.length > 1 ? `${qs.length} questions` : 'Pick several'}</span></span>}
    </>);
  }
  if (need === 'reply') return box('attn', <><span className="line-clamp-3 font-semibold">{ask?.detail}</span><span className="flex gap-1.5">{open}</span></>);
  if (need === 'tab') return box('attn', <><span>{card.live?.text || 'Waiting for you in its terminal'}</span><span className="flex gap-1.5"><button className={btn} onClick={() => goToTab(card.id)}><Key k="g" size="sm" />Answer in its terminal</button></span></>);
  if (need === 'failed') return box('bad', <><span className="font-semibold text-bad">{card.boot.filter((b) => b.state === 'bad').at(-1)?.text ?? 'It didn’t start'}</span><span className="flex gap-1.5">{open}</span></>);
  if (need === 'tryFailed') return box('bad', <><span className="font-semibold text-bad">{run?.text || 'Try it failed'}</span><span className="text-[12px] text-sub">t starts it again (below); Enter opens the card with its output.</span></>);
  // A finished turn you haven't seen: what Claude said, and m to put it away.
  return box('busy', <>
    <span className="line-clamp-3 whitespace-pre-line text-[12.5px]">{(card.live?.lastMessage ?? card.live?.text ?? 'Finished its turn').replace(/^#+\s*/gm, '')}</span>
    <span className="flex flex-wrap gap-1.5">
      <button className={btn} onClick={() => { markSeen(card.id); flash('Marked as seen'); }}><Key k="m" size="sm" />Seen</button>
      {open}
    </span>
  </>);
}

/** A card Claude is working on: what it is doing now, and for how long. */
function ClaudeTile({ card, focused }: { card: Card; focused: boolean }) {
  const now = useNow(true);
  const color = useWsColor(card.workspaceId);
  return (
    <div className={`flex min-w-0 flex-col rounded-xl border border-l-[3px] bg-col text-[13px] ${focused ? 'is-focus' : 'border-line'}`} style={{ borderLeftColor: color }}>
      <button id={`card-${card.id}`} onClick={() => openCard(card.id)} className="flex min-w-0 flex-col gap-1 rounded-xl px-2.5 py-2 text-left hover:bg-raise">
        <span className="flex items-center gap-1.5">
          <TicketKey k={card.key} source={card.ticket?.source} />
          {card.kind && card.kind !== 'build' && <KindPill card={card} />}
          <span className="grow" />
          <Stage card={card} />
          <span className="font-mono text-[11px] tabular-nums text-faint" title="This turn so far">{elapsed(card.live?.turnSince ?? card.createdAt, now)}</span>
        </span>
        <span className="truncate font-semibold">{card.title}</span>
        <ActLine card={card} />
        <RunLine id={card.id} />
      </button>
      <TryButtons card={card} focused={focused} />
    </div>
  );
}

/** A card nobody is waiting on: small, with where it was left. */
function ParkedChip({ card, focused }: { card: Card; focused: boolean }) {
  const now = useNow(false);
  const color = useWsColor(card.workspaceId);
  const app = useStore((s) => { const r = mainRun(s.runs, card.id); return r?.state === 'up' ? r : undefined; });
  const prs = prsOf(card.ship);
  const where = prs.length ? prsLine(prs) : card.live?.phase === 'ended' ? 'Session ended' : `idle ${elapsed(card.live?.at ?? card.createdAt, now)}`;
  return (
    <div className={`flex min-w-0 max-w-[520px] items-center rounded-full border bg-surface text-[12.5px] ${focused ? 'is-focus' : 'border-line'}`}>
      <button id={`card-${card.id}`} onClick={() => openCard(card.id)} className="flex min-w-0 items-center gap-2 rounded-full py-1 pl-2.5 pr-3 text-left hover:bg-raise" title={`${card.key} ${card.title}\n${cardRepos(card).map(repoName).join(', ')}`}>
        <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: color }} />
        <TicketKey k={card.key} source={card.ticket?.source} />
        <span className="truncate">{card.title}</span>
        {app && <span className="shrink-0 whitespace-nowrap font-semibold text-ok" title={app.url}>● {appAt(app)}</span>}
        <span className={`shrink-0 whitespace-nowrap ${prs.length && !allMerged(prs) ? 'text-busy' : 'text-faint'}`}>{where}</span>
      </button>
      <TryButtons card={card} focused={focused} compact />
    </div>
  );
}

/** No cards and no tickets yet: what a card is, and the three ways to start. */
function FirstTime() {
  return (
    <div className="mx-auto mt-16 max-w-[560px] px-4 text-center text-sub">
      <h2 className="mb-1.5 text-[20px] font-bold text-ink">Nothing here yet</h2>
      <p>A card is one piece of work, a ticket or an idea, with its own Claude session and branch, and a way to try it and ship it. Cards show here by whose move it is: yours, Claude’s, or nobody’s.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2.5">
        <button className="btn btn-primary" onClick={() => openComposer()}><Key k="c" size="sm" tone="ghost" />New card</button>
        <button className="btn" onClick={() => set({ modal: { kind: 'workspace', id: null } })}><Key k="W" size="sm" />New lane</button>
        <button className="btn" onClick={() => set({ modal: { kind: 'tickets' } })}><Key k="⇧T" size="sm" />Jira, Trello or demo tickets</button>
      </div>
      <p className="mt-4 text-[13px] text-faint">A lane groups the repos you work on together. Every card in it can use all of them.</p>
    </div>
  );
}
