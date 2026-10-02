// One card open (PLAN §81, direction F): the chat is the page, read live from the terminal tab, with
// the message box and what Claude is asking under it. A dock on the left edge holds the way back and
// one key per panel (Changes, Try it, Verify, Context, More); the panel open sits between the dock
// and the chat and stays open from card to card. Nothing else is on the page. Keys: web/line-keys.ts
// (drawerKeys); the legend and ? list them.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { askOf, cardRepos, fmtK, itemTokens, memoryPct, modelName, ownFolders, packetText, reachable as canReach, tokens, waiting, type Card, type PacketItem } from '../../shared/cards.ts';
import { againstText, changeRows, changeTotals, patchLines, type ChangeRow, type Changes } from '../../shared/changes.ts';
import { cardRecipe, mainRun, runKey, runsOf, specsOf, type CardRun, type RunStep } from '../../shared/recipes.ts';
import type { Stack, StackApiRow } from '../../shared/stack.ts';
import { allMerged, openPrs, prLine, prsOf, shipLeft, shipMode } from '../../shared/ship.ts';
import { SOURCE_NAME } from '../../shared/tickets.ts';
import { repoName } from '../../shared/workspaces.ts';
import { CARD_PANELS, type CardPanel } from '../line-model.ts';
import { booting, cardActivity, elapsed, needsYou, progress, shortPath, stepCard } from '../line-model.ts';
import { answerAsk, boardOf, changeHooks, editRecipe, goToTab, lastPick, openAddComposer, openApp, openChanges, openNeighbour, openOutput, openWorktrees, rememberPick, saySubmit, setChangeCount, setTryRows, shipKey, stopService, togglePanel, toggleTryRow, tryIt, tryService } from '../line-keys.ts';
import { openSession } from '../keys.ts';
import { get, set, setPanelW, useStore } from '../store.ts';
import { cardChanges, send, stackPlan } from '../ws.ts';
import { useNow } from './ActivityBar.tsx';
import { RunLog } from './RunLog.tsx';
import { KindPill, useExpandKey } from './TicketLine.tsx';
import { Transcript } from './Transcript.tsx';
import { Icon, Key, Pill, TicketKey, type IconName } from './ui.tsx';

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** Wide enough for the panel to sit beside the chat (Tailwind's lg); narrower, it lies over it. */
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

const STAGE: Record<Card['stage'], string> = { inbox: 'Inbox', plan: 'Plan', build: 'Build', needs: 'Needs you', try: 'Try it', ship: 'Ship', done: 'Done' };

export function CardView({ id }: { id: string }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id));
  const panel = useStore((s) => s.line.panel);
  // Where it sits among the cards the board shows, for ← →.
  useStore((s) => s.line.filter);
  useStore((s) => s.line.q);
  useStore((s) => s.cards);
  const place = stepCard(boardOf(get()), id, 0);
  if (!card) return null;
  return (
    <section className="absolute inset-0 z-20 flex bg-bg" aria-label={`${card.key} ${card.title}`}>
      <Dock card={card} panel={panel} />
      {panel && <Panel card={card} panel={panel} />}
      <div className="relative flex min-w-0 flex-1 flex-col bg-surface">
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-2.5">
          <TicketKey k={card.key} source={card.ticket?.source} />
          <h2 className="min-w-0 truncate text-[17px] font-bold leading-snug tracking-tight">{card.title}</h2>
          <Pill tone={needsYou(card) ? 'amber' : 'grey'}>{STAGE[card.stage]}</Pill>
          {card.kind && card.kind !== 'build' && <KindPill card={card} />}
          <span className="grow" />
          {card.cwd && <button className="btn py-0.5 text-[13px]" onClick={() => goToTab(card.id)} title="Bring its Windows Terminal tab to the front"><Key k="g" size="sm" />Its tab</button>}
          {place.at >= 0 && place.total > 1 && (
            <div className="ml-1 flex shrink-0 items-center gap-1.5 text-[12.5px] text-faint">
              <button className="hover:text-ink disabled:opacity-40" disabled={place.at === 0} onClick={() => openNeighbour(id, -1)} title="The previous card on the board" aria-label="The previous card"><Key k="←" size="sm" /></button>
              <span className="tabular-nums">{place.at + 1} of {place.total}</span>
              <button className="hover:text-ink disabled:opacity-40" disabled={place.at === place.total - 1} onClick={() => openNeighbour(id, 1)} title="The next card on the board" aria-label="The next card"><Key k="→" size="sm" /></button>
            </div>
          )}
        </div>
        <Chat card={card} />
        <Say card={card} />
      </div>
    </section>
  );
}

/** One item in the dock: its key on top, its name under, a badge when it has news. */
function DockItem({ k, icon, name, on, badge, tone, onClick, title }: { k: string; icon: IconName; name: string; on?: boolean; badge?: ReactNode; tone?: 'ok' | 'busy'; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title} aria-pressed={on}
      className={`relative flex w-[76px] flex-col items-center gap-1 rounded-xl border py-2 text-[11.5px] font-semibold ${on ? 'border-line bg-surface text-ink' : 'border-transparent text-sub hover:bg-raise hover:text-ink'}`}>
      <Icon name={icon} size={20} className={on ? 'text-acc' : ''} />
      <span>{name}</span>
      <Key k={k} size="sm" />
      {badge !== undefined && badge !== null && badge !== 0 && <span className={`absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10.5px] font-bold ${tone === 'ok' ? 'bg-ok text-bg' : 'bg-busy text-bg'}`}>{badge}</span>}
    </button>
  );
}

/** The dock on the left: the way back, then one key per panel; Ship at the bottom. */
function Dock({ card, panel }: { card: Card; panel: CardPanel | null }) {
  const up = useStore((s) => runsOf(s.runs, card.id).some((r) => r.state === 'up'));
  const files = card.files?.length ?? 0;
  const left = waiting(card).length;
  const prs = prsOf(card.ship);
  const testing = card.kind === 'qa' || card.kind === 'review';
  const canShip = testing ? Boolean(card.report || card.live?.lastMessage) : card.stage !== 'done' && Boolean(card.sessionId || prs.length);
  const shipName = testing ? (card.kind === 'qa' ? 'QA report' : 'Findings') : shipMode(card.ship) === 'rest' ? 'Ship the rest' : openPrs(prs).length ? 'Merge' : 'Ship';
  const badges: Partial<Record<CardPanel, { badge: ReactNode; tone?: 'ok' | 'busy' }>> = {
    changes: { badge: files },
    try: { badge: up ? 'on' : 0, tone: 'ok' },
    context: { badge: left ? `+${left}` : 0 },
    more: { badge: card.report ? '!' : prs.length && !allMerged(prs) ? 'PR' : 0 },
  };
  const icons: Record<CardPanel, IconName> = { changes: 'diff', try: 'window', verify: 'clipboard', context: 'book', more: 'dots' };
  const titles: Record<CardPanel, string> = {
    changes: 'What it changed, by repo, with the diffs', try: 'Its app, or its services: start them, open them, read their output', verify: 'Check it in the team’s apps (later)',
    context: 'How it started, what Claude was given, what was added since', more: 'Steps, where it runs, the pull request, the report, worktrees',
  };
  return (
    <div className="flex w-[92px] shrink-0 flex-col items-center gap-1.5 border-r border-line bg-bg px-2 py-3">
      <button className="flex w-[76px] flex-col items-center gap-1 rounded-xl border border-transparent py-2 text-sub hover:bg-raise hover:text-ink" onClick={() => set({ line: { ...get().line, drawer: null } })} title="Back to the board" aria-label="Back to the board">
        <Icon name="back" size={16} /><Key k="Esc" size="sm" />
      </button>
      <span className="my-1 w-11 border-t border-line" />
      {CARD_PANELS.filter((p) => p.id !== 'more').map((p) => <DockItem key={p.id} k={p.key} icon={icons[p.id]} name={p.name} on={panel === p.id} onClick={() => togglePanel(p.id)} title={titles[p.id]} {...badges[p.id]} />)}
      <span className="grow" />
      {canShip && <DockItem k="s" icon="rocket" name={shipName} onClick={() => shipKey(card.id)} title={testing ? 'The report Claude ended with' : 'Commit, push and open a PR in each repo the card changed; merge once open'} />}
      <DockItem k="m" icon="dots" name="More" on={panel === 'more'} onClick={() => togglePanel('more')} title={titles.more} {...badges.more} />
    </div>
  );
}

/** The panel open beside the dock. On a narrow window it lies over the chat. */
function Panel({ card, panel }: { card: Card; panel: CardPanel }) {
  const meta = CARD_PANELS.find((p) => p.id === panel)!;
  const width = useStore((s) => s.line.panelW);
  const wide = useWide();
  // Dragging the panel's right edge: the width follows the pointer and is remembered when it lets go.
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const startX = e.clientX;
    const startW = width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setPanelW(startW + ev.clientX - startX);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    e.preventDefault();
  };
  return (
    <div className="absolute inset-y-0 left-[92px] right-0 z-10 flex min-h-0 flex-col border-r border-line bg-col lg:relative lg:left-auto lg:right-auto lg:shrink-0" style={wide ? { width } : undefined} role="region" aria-label={meta.name}>
      {wide && <div onPointerDown={drag} title="Drag to resize ([ and ] too)" aria-label="Resize the panel" role="separator" aria-orientation="vertical"
        className="absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize hover:bg-ring/40 active:bg-ring/60" />}
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-2.5">
        <h3 className="text-[14px] font-bold">{meta.name}</h3>
        <PanelNote card={card} panel={panel} />
        <span className="grow" />
        <span className="flex items-center gap-1.5">
          <Key k={meta.key} size="sm" />
          <button type="button" onClick={() => togglePanel(panel)} aria-label={`Close ${meta.name}`} title={`Close ${meta.name}`} className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:bg-raise hover:text-ink">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><path d="M3.5 3.5l9 9m0-9l-9 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {panel === 'changes' ? <ChangesPanel card={card} />
          : panel === 'try' ? <TryIt card={card} />
          : panel === 'verify' ? <VerifyPanel />
          : panel === 'context' ? <ContextPanel card={card} />
          : <MorePanel card={card} />}
      </div>
    </div>
  );
}

/** The quiet line beside a panel's name. */
function PanelNote({ card, panel }: { card: Card; panel: CardPanel }) {
  const repos = cardRepos(card).length;
  if (panel === 'context') return <span className="text-[12.5px] text-faint">{fmtK(tokens(packetText(card, card.key, card.branchName)))} · {repos} repo{repos === 1 ? '' : 's'}</span>;
  if (panel === 'more') return <span className="text-[12.5px] text-faint">{card.todos?.length ? `${progress(card)!.done} of ${card.todos.length} steps` : 'the card’s facts'}</span>;
  return null;
}

/** A section inside a panel. */
function Sec({ id, title, right, children }: { id?: string; title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="grid gap-2.5 border-b border-line px-4 py-3.5">
      {(title || right) && <div className="flex items-center gap-2">{title && <h4 className="grow text-[13px] font-bold">{title}</h4>}{right}</div>}
      {children}
    </section>
  );
}

// ---- The chat ----

const SEEN_KEY = 'cc-control.seen';

/** How much of each card's transcript was on screen when it was last left (this browser), for the "new since you last looked" line. */
function loadSeen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
function saveSeen(id: string, count: number): void {
  try {
    const all = loadSeen();
    all[id] = count;
    localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-100))));
  } catch { /* storage off */ }
}

/** The conversation, kept at the newest line unless you scrolled up; what came since you last looked is marked. */
function Chat({ card }: { card: Card }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const items = useStore((s) => (card.sessionId ? s.transcripts[card.sessionId] : undefined));
  const count = items?.length ?? 0;
  const [seen, setSeen] = useState(() => loadSeen()[card.id] ?? 0);
  const latest = useRef(count);
  latest.current = count;
  useEffect(() => {
    if (card.sessionId) send({ type: 'session.open', id: card.sessionId });
  }, [card.sessionId]);
  // Opening a card reads where you left it; leaving it (or moving to the next) remembers where it was.
  useEffect(() => {
    setSeen(loadSeen()[card.id] ?? 0);
    pinned.current = true;
    return () => saveSeen(card.id, latest.current);
  }, [card.id]);
  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [count, card.id]);
  const act = cardActivity(card);
  const now = useNow(act.state === 'go');
  const mark = seen > 0 && seen < count;
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto px-5 py-4" onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      <div className="mx-auto grid max-w-[880px] gap-3">
        {booting(card) && <BootLines card={card} />}
        {!card.sessionId && !booting(card) && <p className="text-sm text-faint">The chat shows once the session has started and linked to this card.</p>}
        {items && (mark
          ? <>
            <Transcript items={items.slice(0, seen)} cwd={card.cwd} expand={false} />
            <div className="flex items-center gap-3 py-1 text-[12.5px] text-faint" role="separator" aria-label="New since you last looked"><span className="grow border-t border-line" />new since you last looked<span className="grow border-t border-line" /></div>
            <Transcript items={items.slice(seen)} cwd={card.cwd} expand={false} />
          </>
          : <Transcript items={items} cwd={card.cwd} expand={false} />)}
        {card.sessionId && items && !items.length && <p className="text-sm text-faint">Nothing written yet.</p>}
        {card.live && !askOf(card) && !booting(card) && (
          <div className={`flex items-center gap-2 text-[13px] font-semibold ${act.state === 'go' ? 'text-busy' : act.state === 'off' ? 'text-faint' : act.state === 'bad' ? 'text-attn' : 'text-ok'}`}>
            {act.state === 'go' ? <span className="spinner" /> : <span className={`h-2 w-2 rounded-full ${act.state === 'off' ? 'bg-faint' : act.state === 'bad' ? 'bg-attn' : 'bg-ok'}`} />}
            <span>{act.text}</span>
            {card.live.turnSince && act.state === 'go' && <span className="font-mono text-xs font-medium tabular-nums text-faint">{elapsed(card.live.turnSince, now)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** While the card starts: what has happened so far, in the chat's place. */
function BootLines({ card }: { card: Card }) {
  const act = cardActivity(card);
  return (
    <div className="grid gap-2">
      <div className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold ${act.state === 'bad' ? 'bg-attn-bg text-attn' : 'bg-busy-bg text-busy'}`}>
        {act.state === 'go' && <span className="spinner" />}<span>{act.text}</span>
      </div>
      <ol className="grid gap-1 text-[13px] text-sub">
        {card.boot.map((b, i) => <li key={i} className="flex items-start gap-2.5"><time className="w-[68px] shrink-0 font-mono text-xs tabular-nums text-faint">{clock(b.at)}</time><span className={b.state === 'bad' ? 'text-attn' : ''}>{b.text}</span></li>)}
      </ol>
    </div>
  );
}

/**
 * The message box into the card's terminal session, through its channel, and above it what Claude
 * is asking with the keys that answer. Without a channel (the tab closed, the session ended, or the
 * card started before channels), the box stays: sending opens a new tab on the session first (§85).
 */
function Say({ card }: { card: Card }) {
  if (!card.sessionId) return null;
  const ended = card.live?.phase === 'ended';
  const reachable = canReach(card);
  const ask = askOf(card);
  const answerable = Boolean(ask?.requestId || ask?.typed);
  return (
    <div className="grid gap-2.5 border-t border-line bg-surface px-5 py-3">
      {ask && (
        <div className="mx-auto grid w-full max-w-[880px] gap-2 rounded-xl border border-attn/45 bg-attn-bg px-3.5 py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grow font-semibold text-attn">{ask.kind === 'plan' ? 'Approve the plan?' : ask.kind === 'question' ? 'Claude is asking' : <>Run <span className="font-mono font-medium">{ask.detail ?? ask.tool}</span>?</>}</span>
            {answerable
              ? <><button className="btn btn-primary py-0.5" onClick={() => answerAsk(card.id, 'allow')}><Key k="y" size="sm" tone="ghost" />{ask.kind === 'plan' ? 'Approve' : 'Allow'}</button>
                <button className="btn py-0.5" onClick={() => answerAsk(card.id, 'deny')}><Key k="n" size="sm" />{ask.kind === 'plan' ? 'Not yet' : 'Deny'}</button></>
              : ask.kind === 'question' && reachable ? <span className="text-faint">answer below</span>
              : <button className="btn py-0.5" onClick={() => goToTab(card.id)}><Key k="g" size="sm" />Answer in its tab</button>}
          </div>
          {ask.kind === 'plan' && ask.plan && <div className="md max-h-56 overflow-y-auto rounded-lg border border-line bg-surface px-3 py-2 text-[13px]"><Markdown remarkPlugins={[remarkGfm]}>{ask.plan}</Markdown></div>}
          {ask.kind === 'question' && ask.detail && <p className="text-[13.5px]">{ask.detail}</p>}
        </div>
      )}
      <div className="mx-auto flex w-full max-w-[880px] items-end gap-2">
        <textarea id="card-say" rows={2} placeholder={reachable ? `Type to ${card.key}’s terminal… Enter sends, Shift+Enter is a new line` : `Type to ${card.key}’s session… Enter opens a new tab on it and sends`} spellCheck={false} className="field grow resize-none text-[13.5px]" />
        {card.stage !== 'done' && <button className="btn py-1.5" onClick={() => openAddComposer(card.id)} title="Add a repo, a folder, a ticket or a note: it goes in with your next message"><Key k="c" size="sm" />+ Context</button>}
        <button className="btn btn-primary py-1.5" onClick={() => saySubmit(card.id)} title={reachable ? (card.keys ? 'Typed into its terminal tab by the launcher there, the way the keyboard would' : 'Sent into the terminal session through its channel') : 'Opens a new terminal tab on the session (claude --resume) and sends once it connects'}><Key k="Enter" size="sm" tone="ghost" />{reachable ? 'Send' : 'Resume and send'}</button>
      </div>
      {!reachable && (
        <p className="mx-auto w-full max-w-[880px] text-[12.5px] text-faint" role="note">
          {ended ? 'Its session ended.' : 'Its tab can’t be reached (it closed, or the server restarted and nothing has reconnected yet).'} Sending opens a new tab that resumes the session, with the card following it as before.
        </p>
      )}
      {reachable && card.keys && (
        <p className="mx-auto w-full max-w-[880px] text-[12.5px] text-faint" role="note">Typed into its tab: the launcher in the tab types what you send, the way the keyboard would, and y / n press its prompt’s keys.</p>
      )}
    </div>
  );
}

// ---- Changes ----

/** What the card changed, by repo: each repo's files, the chosen one's diff under it. j / k move, f opens the full sheet. */
function ChangesPanel({ card }: { card: Card }) {
  const [changes, setChanges] = useState<Changes | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Folded repos (by root) and whether the chosen file's diff is open (§90); both start afresh on another card.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [diffOpen, setDiffOpen] = useState(true);
  const at = useStore((s) => s.line.at);
  const stamp = `${card.files?.length ?? 0}:${card.ship?.steps.length ?? 0}:${card.live?.at ?? 0}`;
  useEffect(() => { setFolded(new Set()); setDiffOpen(true); }, [card.id]);
  useEffect(() => {
    if (!card.cwd) return;
    let on = true;
    cardChanges(card.id).then((c) => { if (on) { setChanges(c); setError(null); } }, (e: Error) => { if (on) setError(e.message); });
    return () => { on = false; };
  }, [card.id, card.cwd, stamp]);
  const rows = changes ? changeRows(changes) : [];
  const files = rows.filter((r): r is Extract<ChangeRow, { kind: 'file' }> => r.kind === 'file');
  // The files on screen: a folded repo's are left out, so j / k walk what is shown; `at` counts along these.
  const shown = files.filter((r) => !folded.has(r.repo.root));
  const shownKey = shown.map((r) => r.index).join(',');
  useEffect(() => { setChangeCount(shown.map((r) => r.index)); return () => setChangeCount([]); }, [shownKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosenPos = Math.min(at, shown.length - 1);
  const chosen = chosenPos >= 0 ? shown[chosenPos] : undefined;
  const toggleFold = (root: string) => setFolded((prev) => { const next = new Set(prev); if (next.has(root)) next.delete(root); else next.add(root); return next; });
  useEffect(() => {
    changeHooks.toggleDiff = () => setDiffOpen((v) => !v);
    changeHooks.foldRepo = () => { if (chosen) toggleFold(chosen.repo.root); };
    // Z: unfold everything when any repo is folded (the way back after z), else fold every repo.
    changeHooks.foldAll = () => setFolded((prev) => (prev.size > 0 ? new Set() : new Set(changes?.repos.map((r) => r.root) ?? [])));
    return () => { changeHooks.toggleDiff = () => {}; changeHooks.foldRepo = () => {}; changeHooks.foldAll = () => {}; };
  }, [chosen?.repo.root, changes]);
  useEffect(() => { document.getElementById(`pchg-${chosenPos}`)?.scrollIntoView({ block: 'nearest' }); }, [chosenPos]);
  if (!card.cwd) return <p className="px-4 py-3 text-sm text-faint">Nothing yet: the card hasn’t started.</p>;
  if (error) return <p className="px-4 py-3 text-sm text-bad" role="alert">{error}</p>;
  if (!changes) return <p className="flex items-center gap-2 px-4 py-3 text-sm text-faint"><span className="spinner" />Asking git…</p>;
  const totals = changeTotals(changes);
  return (
    <div className="grid gap-3 px-3 py-3">
      {totals.files === 0 && <p className="px-1 text-sm text-faint">Nothing changed yet in {changes.repos.map((r) => r.repo).join(', ') || 'its repos'}.</p>}
      {changes.repos.map((r) => {
        const isFolded = folded.has(r.root);
        return (
          <section key={r.root} className="overflow-hidden rounded-xl border border-line bg-surface" aria-label={r.repo}>
            {/* The header folds the repo's files under it (z on the chosen file's repo, Z for all). */}
            <button onClick={() => toggleFold(r.root)} aria-expanded={!isFolded} title={isFolded ? `Unfold ${r.repo}’s files` : `Fold ${r.repo}’s files`}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-raise/60 ${isFolded ? '' : 'border-b border-line'}`}>
              <span className="w-3 shrink-0 text-center text-[11px] text-faint" aria-hidden>{isFolded ? '▸' : '▾'}</span>
              <span className="font-bold">{r.repo}</span>
              <span className="min-w-0 truncate text-[12px] text-faint" title={againstText(r)}>{r.branch && r.branch !== r.base ? r.branch : 'uncommitted'}</span>
              <span className="grow" />
              {isFolded && <span className="shrink-0 text-[11.5px] text-faint">{r.files.length} file{r.files.length === 1 ? '' : 's'}</span>}
              <span className="font-mono text-[11.5px] tabular-nums"><span className="text-ok">+{r.files.reduce((n, f) => n + f.added, 0)}</span> <span className="text-bad">−{r.files.reduce((n, f) => n + f.removed, 0)}</span></span>
            </button>
            {!isFolded && r.files.length === 0 && <p className="px-3 py-2 text-[12.5px] text-faint">Nothing changed here.</p>}
            {!isFolded && shown.filter((x) => x.repo.root === r.root).map((x) => {
              const pos = shown.indexOf(x);
              const isChosen = pos === chosenPos;
              return (
                <div key={x.file.path} id={`pchg-${pos}`} className="border-t border-line/60 first:border-t-0">
                  {/* A click chooses the file; a second click on the chosen one folds its diff (Space). */}
                  <button onClick={() => { if (isChosen) setDiffOpen((v) => !v); else { set({ line: { ...get().line, at: pos } }); setDiffOpen(true); } }} aria-pressed={isChosen} aria-expanded={isChosen ? diffOpen : undefined}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] ${isChosen ? 'bg-raise' : 'hover:bg-raise/60'}`}>
                    <span className="w-3 shrink-0 text-center text-[11px] text-faint" aria-hidden>{isChosen ? (diffOpen ? '▾' : '▸') : ''}</span>
                    <span className={`w-[52px] shrink-0 text-[10.5px] font-bold uppercase ${x.file.kind === 'deleted' ? 'text-bad' : x.file.kind === 'modified' ? 'text-faint' : 'text-ok'}`}>{{ added: 'added', modified: 'changed', deleted: 'deleted', renamed: 'renamed', new: 'new' }[x.file.kind]}</span>
                    <span className="min-w-0 grow truncate font-mono" title={x.file.path}>{x.file.path}</span>
                    {x.file.mine && <span className="shrink-0 rounded-full bg-ok-bg px-1.5 text-[10.5px] font-semibold text-ok" title="Written by this card’s session">card</span>}
                    <span className="shrink-0 font-mono text-[11px] tabular-nums"><span className="text-ok">+{x.file.added}</span> <span className="text-bad">−{x.file.removed}</span></span>
                  </button>
                  {isChosen && diffOpen && (
                    <>
                      {x.file.binary
                        ? <p className="px-3 py-1.5 text-[12px] text-faint">A binary file: nothing to show.</p>
                        : <pre className="m-0 max-h-[42vh] overflow-auto border-t border-line/60 bg-bg py-1 font-mono text-[11.5px] leading-[1.45]">
                          {patchLines(x.file.patch).filter((l) => l.kind !== 'meta').map((l, i) => (
                            <div key={i} className={`whitespace-pre px-3 ${l.kind === 'add' ? 'bg-ok-bg text-ok' : l.kind === 'del' ? 'bg-bad-bg text-bad' : l.kind === 'hunk' ? 'bg-raise text-busy' : 'text-sub'}`}>{l.text || ' '}</div>
                          ))}
                        </pre>}
                      {/* The same file, full width: the sheet opens on it. */}
                      <div className="flex justify-end border-t border-line/60 px-3 py-1">
                        <button className="flex items-center gap-1.5 text-[12px] text-acc underline decoration-dotted underline-offset-2 hover:decoration-solid" onClick={() => openChanges(card.id, x.index)} title="This diff full width, in its own window">
                          <Icon name="popout" size={13} />Pop out<Key k="f" size="sm" />
                        </button>
                      </div>
                    </>)}
                </div>
              );
            })}
          </section>
        );
      })}
      {totals.truncated && <p className="px-1 text-[12.5px] text-attn">The diff was cut: it is very large.</p>}
    </div>
  );
}

// ---- Try it ----

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

/** Try it: with a stack, the services (§82); else this card's app, the run recipe step by step, and what a failing step said. */
function TryIt({ card }: { card: Card }) {
  const home = cardRepos(card)[0];
  const recipe = useStore((s) => cardRecipe(s.recipes, card.workspaceId, home));
  if (recipe?.stack) return <StackTry card={card} stack={recipe.stack} source={recipe.source} />;
  return <RecipeTry card={card} />;
}

/** The state of one service's run, as a word and a tone. */
function runState(run: CardRun | undefined): { text: string; tone: string; dot: string } {
  if (!run) return { text: 'not started', tone: 'text-faint', dot: 'border border-line' };
  switch (run.state) {
    case 'running': return { text: 'starting', tone: 'text-busy', dot: 'bg-busy' };
    case 'up': return { text: 'up', tone: 'text-ok', dot: 'bg-ok' };
    case 'done': return { text: 'finished', tone: 'text-sub', dot: 'bg-faint' };
    case 'failed': return { text: run.text, tone: 'text-bad', dot: 'bg-bad' };
    case 'stopped': return { text: 'stopped', tone: 'text-faint', dot: 'bg-faint' };
  }
}

/**
 * A lane with a stack: the environment, then each service (every API, and the UI) with its own
 * state, Start / Start again and Stop, so one can be fixed and started again while the rest keep
 * running. t starts every ticked service at once (a new session: ports and the proxy copy), or
 * stops them all. The pick is remembered per card, in this browser.
 */
function StackTry({ card, stack, source }: { card: Card; stack: Stack; source: string }) {
  const [rows, setRows] = useState<StackApiRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runs = useStore((s) => s.runs);
  const at = useStore((s) => s.line.at);
  useStore((s) => s.line.pickTick);
  const mine = runsOf(runs, card.id);
  const live = mine.some((r) => r.state === 'running' || r.state === 'up');
  const choose = Object.entries(stack.choose);
  useEffect(() => {
    let on = true;
    stackPlan(card.id).then((p) => {
      if (!on) return;
      setRows(p.rows);
      // No pick yet for this card: the suggestion (the APIs changed on its branch, else the ones the ticket names) is the pick, so t can start it.
      if (!lastPick(card.id)) rememberPick(card.id, { values: Object.fromEntries(choose.map(([k, v]) => [k, v[0]])), apis: p.suggested.filter((r) => p.rows.some((x) => x.repo === r && x.found)) });
    }, (e: Error) => { if (on) setError(e.message); });
    return () => { on = false; };
  }, [card.id]);
  const pick = lastPick(card.id) ?? { values: {}, apis: [] };
  const services = [...(rows ?? stack.apis.map((a) => ({ repo: a.repo, found: true, changed: false, named: false, why: '' }))).map((r) => ({ id: r.repo, found: r.found, fixed: false, why: r.why, changed: r.changed })), ...(stack.ui ? [{ id: 'ui', found: true, fixed: true, why: stack.ui.repo, changed: false }] : [])];
  useEffect(() => { setTryRows({ choose, services: services.map(({ id, found, fixed }) => ({ id, found, fixed })) }); return () => setTryRows({ choose: [], services: [] }); }, [JSON.stringify(choose), services.map((x) => `${x.id}:${x.found}`).join(',')]);
  useEffect(() => { document.getElementById(`try-${at}`)?.scrollIntoView({ block: 'nearest' }); }, [at]);
  const highlighted = services[at - choose.length];
  const run = highlighted ? runs[runKey(card.id, highlighted.id)] : undefined;
  const label = mine[0]?.choice;
  const ticked = (id: string) => id === 'ui' || pick.apis.includes(id);
  return (
    <>
      <Sec title={live ? `Running · ${label ?? ''}` : 'Services'} right={<button className="flex items-center gap-1.5 text-[12px] text-faint hover:text-ink" onClick={() => editRecipe(card.id)} title="Change the lane's stack">set up <Key k="e" size="sm" /></button>}>
        {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}
        <ul className="grid gap-1" role="listbox" aria-label="The environment and the services">
          {choose.map(([k, vals], i) => (
            <li key={k} id={`try-${i}`} role="option" aria-selected={at === i} onClick={() => set({ line: { ...get().line, at: i } })}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border-l-[3px] py-1.5 pl-2 pr-2 ${at === i ? 'border-l-acc bg-acc-soft' : 'border-l-transparent hover:bg-raise/60'}`}>
              <span className="w-20 shrink-0 text-[12px] font-semibold text-sub">{k}</span>
              <div className="flex grow flex-wrap gap-1" role="radiogroup" aria-label={k}>
                {vals.map((v) => (
                  <button key={v} role="radio" aria-checked={(pick.values[k] ?? vals[0]) === v} onClick={(e) => { e.stopPropagation(); rememberPick(card.id, { ...pick, values: { ...pick.values, [k]: v } }); }}
                    className={`rounded-md border px-2 py-0.5 font-mono text-[12px] ${(pick.values[k] ?? vals[0]) === v ? 'border-ring bg-surface font-semibold text-ink' : 'border-line bg-raise text-sub'}`}>{v}</button>
                ))}
              </div>
            </li>
          ))}
          {services.map((sv, j) => {
            const i = choose.length + j;
            const r = runs[runKey(card.id, sv.id)];
            const st = runState(r);
            const on = r?.state === 'running' || r?.state === 'up';
            return (
              <li key={sv.id} id={`try-${i}`} role="option" aria-selected={at === i} onClick={() => set({ line: { ...get().line, at: i } })}
                className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg border-l-[3px] py-1.5 pl-2 pr-2 ${at === i ? 'border-l-acc bg-acc-soft' : 'border-l-transparent hover:bg-raise/60'} ${sv.found ? '' : 'opacity-55'}`}>
                {sv.fixed
                  ? <span className="grid h-4 w-4 place-items-center rounded border border-line text-[10px] text-faint" title="The UI always runs">●</span>
                  : <button role="checkbox" aria-checked={ticked(sv.id)} aria-label={`Run ${sv.id}`} disabled={!sv.found} onClick={(e) => { e.stopPropagation(); set({ line: { ...get().line, at: i } }); toggleTryRow(card.id); }}
                    className={`grid h-4 w-4 place-items-center rounded border text-[11px] font-bold ${ticked(sv.id) ? 'border-ring bg-ring text-bg' : 'border-line bg-surface'}`}>{ticked(sv.id) ? '✓' : ''}</button>}
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-[13px] font-semibold">{sv.id === 'ui' ? `${stack.ui?.repo ?? 'UI'}` : sv.id}</span>
                  <span className={`flex min-w-0 items-center gap-1.5 text-[12px] ${st.tone}`} title={r?.text}><span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} />{r?.state === 'running' && <span className="spinner" />}<span className="truncate">{st.text}</span></span>
                </span>
                <span className="flex items-center gap-1">
                  {sv.id === 'ui' && r?.state === 'up' && r.url && <button className="btn py-0 text-[12px]" onClick={(e) => { e.stopPropagation(); openApp(card.id); }}><Key k="o" size="sm" />Open</button>}
                  {on
                    ? <button className="btn py-0 text-[12px]" onClick={(e) => { e.stopPropagation(); stopService(card.id, sv.id); }} title="Stop this one; the others keep running"><Key k="q" size="sm" />Stop</button>
                    : (live || r) && ticked(sv.id) && <button className="btn py-0 text-[12px]" onClick={(e) => { e.stopPropagation(); tryService(card.id, sv.id); }} title="Start this one on its own"><Key k="r" size="sm" />{r ? 'Again' : 'Start'}</button>}
                  {on && <button className="btn py-0 text-[12px]" onClick={(e) => { e.stopPropagation(); tryService(card.id, sv.id); }} title="Stop it and start it again, the others keep running"><Key k="r" size="sm" />Again</button>}
                </span>
                {!sv.fixed && sv.why && <span className={`col-start-2 text-[11.5px] ${sv.changed ? 'text-attn' : 'text-faint'}`}>{sv.why}</span>}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <button className={`btn py-1 ${!live && card.stage === 'try' ? 'btn-primary' : ''}`} onClick={() => tryIt(card.id)}><Key k="t" size="sm" tone={!live && card.stage === 'try' ? 'ghost' : undefined} />{live ? 'Stop all' : `Start ${pick.apis.length ? `${pick.apis.length} API${pick.apis.length === 1 ? '' : 's'}${stack.ui ? ' and the UI' : ''}` : stack.ui ? 'the UI' : 'nothing'}`}</button>
          {!live && <span className="text-[12px] text-faint">APIs left unticked are served by the shared {pick.values.env ?? choose[0]?.[1][0] ?? ''} environment.</span>}
        </div>
        {source.startsWith('from the workspace file') && !live && <div className="rounded-lg bg-attn-bg px-3 py-2 text-[13px] text-attn">This stack came with a lane file someone shared. Read its steps before starting: they run on this machine.</div>}
      </Sec>
      {highlighted && (
        <Sec id="try-it" title={highlighted.id === 'ui' ? `${stack.ui?.repo ?? 'UI'} · its steps` : `${highlighted.id} · its steps`} right={run ? <span className="text-[12px] text-faint">{run.text}</span> : null}>
          {run
            ? <ol className="grid min-w-0 gap-1 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[12px]">
              {run.steps.filter((s) => !s.stop).map((s, i) => <StepRow key={i} s={s} />)}
              {run.steps.some((s) => s.stop) && <li className="mt-1 font-sans text-[11px] font-bold uppercase tracking-wide text-faint">When stopped</li>}
              {run.steps.filter((s) => s.stop).map((s, i) => <StepRow key={`stop${i}`} s={s} />)}
            </ol>
            : <p className="text-[13px] text-faint">Not started yet. Its steps show here as they run.</p>}
          <Output card={card} service={highlighted.id} run={run} />
        </Sec>
      )}
    </>
  );
}

/** A run's output under its steps (§84), following the newest line, with Pop out (f) to the full-width sheet. */
function Output({ card, service, run }: { card: Card; service?: string; run: CardRun | undefined }) {
  return (
    <>
      <RunLog runKey={runKey(card.id, service)} run={run} className="max-h-[40vh]" />
      {run && (
        <div className="flex justify-end">
          <button className="flex items-center gap-1.5 text-[12px] text-acc underline decoration-dotted underline-offset-2 hover:decoration-solid" onClick={() => openOutput(card.id, service)} title="Its output full width, in its own window">
            <Icon name="popout" size={13} />Pop out<Key k="f" size="sm" />
          </button>
        </div>
      )}
    </>
  );
}

/** A repo's own recipe: the app, the steps as they run, and what a failing step said. */
function RecipeTry({ card }: { card: Card }) {
  const home = cardRepos(card)[0];
  const recipe = useStore((s) => cardRecipe(s.recipes, card.workspaceId, home));
  const wsName = useStore((s) => s.workspaces.find((w) => w.id === card.workspaceId)?.name);
  const last: CardRun | undefined = useStore((s) => mainRun(s.runs, card.id));
  const specs = recipe ? specsOf(recipe) : [];
  const live = last?.state === 'running' || last?.state === 'up';
  const run = last && (live || (recipe && last.steps.map((s) => s.cmd).join('\n') === specs.map((s) => s.cmd).join('\n'))) ? last : undefined;
  const name = recipe?.workspaceId ? `${wsName ?? 'the lane'} lane` : home ? repoName(home) : card.key;
  const all: RunStep[] = run?.steps ?? specs.map((s) => ({
    cmd: s.cmd, state: s.note ? 'note' as const : 'wait' as const, tail: [],
    ...(s.repo ? { repo: s.repo } : {}), ...(Object.keys(s.env).length ? { env: Object.keys(s.env) } : {}), ...(s.stop ? { stop: true } : {}),
  }));
  const steps = all.filter((s) => !s.stop);
  const stops = all.filter((s) => s.stop);
  const can = Boolean(recipe || card.workspaceId);
  return (
    <>
      <Sec title="This card’s app">
        {run?.state === 'up'
          ? <div className="flex items-center gap-2.5 rounded-lg bg-ok-bg px-3 py-2 text-sm font-semibold text-ok">
            <span className="h-2 w-2 rounded-full bg-ok" /><span className="min-w-0 grow truncate">{run.text}</span>
            {run.url && <button className="btn py-0.5" onClick={() => openApp(card.id)}><Key k="o" size="sm" />Open</button>}
          </div>
          : run?.state === 'running'
            ? <div className="flex items-center gap-2.5 rounded-lg bg-busy-bg px-3 py-2 text-sm font-semibold text-busy"><span className="spinner" /><span className="min-w-0 grow truncate">{run.text}</span></div>
            : <p className="text-[13px] text-sub">{run ? `${run.text}.` : 'Not running.'}{ownFolders(card).length ? ' It runs from this card’s own folders, so only this card’s change is in it.' : ''}</p>}
        <div className="flex flex-wrap gap-2">
          {can && <button className={`btn py-1 ${!live && card.stage === 'try' ? 'btn-primary' : ''}`} onClick={() => tryIt(card.id)}><Key k="t" size="sm" tone={!live && card.stage === 'try' ? 'ghost' : undefined} />{live ? 'Stop' : run ? 'Start again' : 'Start'}</button>}
          <button className="btn py-1" onClick={() => editRecipe(card.id)} title="How it runs: what starts it, where it serves"><Key k="e" size="sm" />{recipe ? 'How it runs' : 'Set up how it runs'}</button>
        </div>
      </Sec>
      <Sec id="try-it" title={`How ${name} runs`} right={<span className="text-[12px] text-faint">{recipe ? recipe.source : 'not set up yet'}</span>}>
        {steps.length ? (
          <ol className="grid min-w-0 gap-1 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[12px]">
            {steps.map((s, i) => <StepRow key={i} s={s} />)}
            {stops.length > 0 && <li className="mt-1 font-sans text-[11px] font-bold uppercase tracking-wide text-faint">When stopped</li>}
            {stops.map((s, i) => <StepRow key={`stop${i}`} s={s} />)}
          </ol>
        ) : <p className="text-[13px] text-faint">Nothing in {name} says how it starts (no package.json or compose file): e sets it up.</p>}
        {recipe?.source.startsWith('from the workspace file') && !run && <div className="rounded-lg bg-attn-bg px-3 py-2 text-[13px] text-attn">This came with a lane file someone shared. Read the commands before starting: they run on this machine.</div>}
        <Output card={card} run={run} />
      </Sec>
    </>
  );
}

// ---- Verify ----

function VerifyPanel() {
  return (
    <Sec title="Check it in the team’s apps">
      <p className="text-[13px] text-sub">Coming later: look up a record, add fields to it, and create test data from this card’s context, without leaving the card.</p>
      <p className="text-[13px] text-faint">For now: start the app under Try it, open it, and tell Claude what you saw in the chat.</p>
    </Sec>
  );
}

// ---- Context ----

function Chips({ items }: { items: PacketItem[] }) {
  const on = items.filter((i) => i.on);
  if (!on.length) return <span className="text-[13px] text-faint">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {on.map((i) => <span key={i.kind + i.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raise px-2.5 py-0.5 text-[12.5px]">{i.kind === 'repo' ? `repo · ${i.label}` : i.label}</span>)}
    </div>
  );
}

/** How it started, what Claude was given, and what was added since. */
function ContextPanel({ card }: { card: Card }) {
  const wsName = useStore((s) => s.workspaces.find((w) => w.id === card.workspaceId)?.name);
  const text = packetText(card, card.key, card.branchName);
  const size = tokens(text);
  return (
    <>
      <AddedSince card={card} />
      <Sec title="What Claude was given" right={<span className="text-[12px] text-faint">{fmtK(size)} · {memoryPct(size)}% of its memory</span>}>
        <div className="grid gap-1.5"><div className="flex gap-2 text-[13px]"><b>Lane</b><span className="text-faint">{wsName ? `shared by every ${wsName} card` : 'no lane'}</span></div><Chips items={card.packet.workspace} /></div>
        <div className="grid gap-1.5">
          <div className="flex gap-2 text-[13px]"><b>Ticket</b><span className="text-faint">{card.ticket ? `from ${SOURCE_NAME[card.ticket.source]} ${card.ticket.key}${card.ticket.demo ? ' (a demo ticket)' : ''}` : 'no ticket'}</span></div>
          {card.ticket && <Chips items={card.packet.ticket} />}
        </div>
        <div className="grid gap-1.5">
          <div className="flex gap-2 text-[13px]"><b>This card</b><span className="text-faint">added when it started</span></div>
          {card.packet.card.some((i) => i.on) || card.packet.note.trim()
            ? <div className="flex flex-wrap gap-1.5"><Chips items={card.packet.card} />{card.packet.note.trim() && <span className="rounded-full border border-line bg-raise px-2.5 py-0.5 text-[12.5px]">your note: “{card.packet.note.trim().slice(0, 40)}{card.packet.note.trim().length > 40 ? '…' : ''}”</span>}</div>
            : <span className="text-[13px] text-faint">Nothing extra</span>}
        </div>
        <details className="text-[13px]">
          <summary className="cursor-pointer text-faint hover:text-ink">The exact text, as the SessionStart hook returned it</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-line bg-bg px-3.5 py-3 font-mono text-[12px] leading-relaxed">{text}</pre>
        </details>
      </Sec>
      <Sec title="How it started">
        <ol className="grid gap-1.5 text-[13px]">
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
    </>
  );
}

/** Context added since the card started: what waits for the next message in its tab, and what went in. */
function AddedSince({ card }: { card: Card }) {
  const later = card.later ?? [];
  const left = waiting(card);
  return (
    <Sec id="added-since" title="Added since it started" right={card.stage !== 'done' && <button className="btn py-0.5 text-[12.5px]" onClick={() => openAddComposer(card.id)}><Key k="c" size="sm" />+ Context</button>}>
      {later.length ? (
        <ol className="grid min-w-0 gap-1.5 text-[13px]">
          {later.map((i) => (
            <li key={i.id} className="flex min-w-0 items-center gap-2.5">
              <time className="w-[68px] shrink-0 font-mono text-xs tabular-nums text-faint">{clock(i.sent ?? i.at)}</time>
              <span className="min-w-0 grow truncate" title={i.text ?? i.label}>{i.kind === 'repo' ? `Repo: ${i.label}` : i.label} <span className="font-mono text-[11.5px] text-faint">{fmtK(itemTokens(i))}</span></span>
              {i.sent
                ? <span className="whitespace-nowrap rounded-full bg-ok-bg px-2 text-[11px] font-semibold text-ok">delivered</span>
                : <span className="whitespace-nowrap rounded-full bg-attn-bg px-2 text-[11px] font-semibold text-attn">{card.sessionId ? 'with your next message' : 'when it starts'}</span>}
            </li>
          ))}
        </ol>
      ) : <p className="text-[13px] text-faint">Nothing yet. A repo, a related ticket or a note goes in with your next message in its tab.</p>}
      {left.length > 0 && <p className="text-[12.5px] text-faint"><Key k="x" size="sm" inline /> takes back the last one still waiting.</p>}
    </Sec>
  );
}

// ---- More ----

/** The rest: steps, the pull request, the report, where it runs, the session's own keys. */
function MorePanel({ card }: { card: Card }) {
  const expand = useExpandKey();
  const linked = useStore((s) => Boolean(card.sessionId && s.sessions.some((x) => x.id === card.sessionId)));
  return (
    <>
      {card.todos?.length ? (
        <Sec title="Steps" right={<span className="text-[12px] text-faint">from Claude’s to-do list</span>}>
          <ol className="grid gap-1.5">
            {card.todos.map((t) => (
              <li key={t.id} className={`flex items-center gap-2.5 text-[13px] ${t.status === 'pending' ? 'text-sub' : ''}`}>
                <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full font-mono text-[11px] font-bold ${t.status === 'completed' ? 'bg-ok-bg text-ok' : t.status === 'in_progress' ? 'text-busy' : 'border-2 border-line'}`}>
                  {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? <span className="spinner" /> : ''}
                </span>
                <span>{t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}</span>
              </li>
            ))}
          </ol>
        </Sec>
      ) : null}
      {card.report && (
        <Sec title={card.kind === 'qa' ? 'QA report' : 'Review findings'} right={<button className="flex items-center gap-1.5 text-[12.5px] text-faint hover:text-ink" onClick={() => shipKey(card.id)}>open <Key k="s" size="sm" /></button>}>
          <div className="md max-h-72 overflow-y-auto text-[13px]"><Markdown remarkPlugins={[remarkGfm]}>{card.report.text}</Markdown></div>
        </Sec>
      )}
      {card.pr && (
        <Sec title="Pull request">
          <p className="text-[13px]"><a className="underline hover:text-acc" href={card.pr.url} target="_blank" rel="noreferrer">PR #{card.pr.number} {card.pr.title}</a> · <span className="font-mono text-[12px]">{card.pr.source} → {card.pr.target}</span></p>
        </Sec>
      )}
      {card.ship && <Shipped card={card} />}
      <Sec title="Where it runs">
        <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
          {card.ticket && <><dt className="text-faint">Ticket</dt><dd>{card.ticket.url ? <a className="underline hover:text-acc" href={card.ticket.url} target="_blank" rel="noreferrer">{card.ticket.key} in {SOURCE_NAME[card.ticket.source]}</a> : `${card.ticket.key}${card.ticket.demo ? ' (a demo ticket)' : ''}`} · {card.ticket.status}</dd></>}
          <dt className="text-faint">Terminal tab</dt><dd>Titled <b>{card.key}</b> in Windows Terminal.</dd>
          <dt className="text-faint">Folder</dt><dd className="break-all font-mono text-[12px]">{card.cwd}</dd>
          {card.branchName && <><dt className="text-faint">Branch</dt><dd className="font-mono text-[12px]">{card.branchName}</dd></>}
          {ownFolders(card).length > 0 && <><dt className="text-faint">Worktrees</dt><dd className="break-all">
            <span className="font-mono text-[12px]">{ownFolders(card).map((f) => repoName(f.dir)).join(', ')}</span>
            <button className="ml-2 text-faint hover:text-ink" onClick={() => openWorktrees(card.id)} title={card.stage === 'done' ? 'Remove them and their branch' : 'What each holds; removable once the card is done'}><Key k="⇧X" size="sm" inline /> {card.stage === 'done' ? 'remove' : 'look'}</button>
          </dd></>}
          <dt className="text-faint">Model</dt><dd>{modelName(card.model ?? card.launch.model)}{!card.launch.model && card.model ? <span className="text-faint"> (the default)</span> : null}</dd>
          <dt className="text-faint">Session</dt><dd className="font-mono text-[12px]">{card.sessionId ?? 'not linked yet'}</dd>
          <dt className="text-faint">Started</dt><dd>{new Date(card.createdAt).toLocaleString()}</dd>
          {card.files?.length ? <><dt className="text-faint">Files</dt><dd className="grid gap-0.5 font-mono text-[12px]">{card.files.map((f) => <span key={f} className="truncate" title={f}>{shortPath(f, card.cwd, card.folders)}</span>)}</dd></> : null}
        </dl>
      </Sec>
      <Sec>
        <div className="flex flex-wrap gap-2">
          {card.sessionId && <button className="btn py-1" disabled={!linked} onClick={() => openSession(card.sessionId!)} title={linked ? 'Read along in the app (Esc comes back). Typing there forks the session.' : 'The session hasn’t shown up in the session list yet'}><Key k={expand} size="sm" />Its session</button>}
          {card.stage === 'ship' && <button className="btn py-1" onClick={() => send({ type: 'card.done', id: card.id })} title="The PR was merged or closed by hand"><Key k="d" size="sm" />Done</button>}
          <button className="btn py-1" onClick={() => set({ modal: { kind: 'deleteCard', id: card.id } })}><Key k="Delete" size="sm" />Remove card</button>
        </div>
      </Sec>
    </>
  );
}

/** The card's pull requests (one per repo it shipped) and how shipping went. */
function Shipped({ card }: { card: Card }) {
  const prs = prsOf(card.ship);
  const seen = prs.map((p) => p.checkedAt ?? 0).reduce((a, b) => Math.max(a, b), 0);
  return (
    <Sec title="Ship" right={prs.length > 0 && <span className="text-[12px] text-faint">{seen ? `looked at ${clock(seen)}` : ''}</span>}>
      {prs.map((pr) => (
        <div key={`${pr.host}-${pr.number}`} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-semibold ${pr.state === 'MERGED' ? 'bg-ok-bg text-ok' : 'bg-busy-bg text-busy'}`}>
          {prs.length > 1 && <span className="shrink-0 rounded border border-current px-1 font-mono text-[11px]">{pr.repo ?? 'repo'}</span>}
          <a className="min-w-0 grow truncate underline" href={pr.url} target="_blank" rel="noreferrer">{prLine(pr)}</a>
          {pr.state === 'OPEN' && !shipLeft(card.ship).length && <button className="flex items-center gap-1.5" onClick={() => shipKey(card.id)}><Key k="s" size="sm" />merge{openPrs(prs).length > 1 ? ' all' : ''}</button>}
        </div>
      ))}
      {shipLeft(card.ship).length > 0 && (
        <div className="flex items-center gap-2.5 rounded-lg bg-attn-bg px-3 py-2 text-[13px] text-attn">
          <span className="grow">Stopped before {shipLeft(card.ship).join(' and ')} shipped. Fix what the step below says, then ship the rest.</span>
          <button className="flex items-center gap-1.5 font-semibold" onClick={() => shipKey(card.id)}><Key k="s" size="sm" />ship the rest</button>
        </div>
      )}
      <ol className="grid gap-1 text-[12.5px]">
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
