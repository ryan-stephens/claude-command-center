// One card open (PLAN §81, direction F): the chat is the page, read live from the terminal tab, with
// the message box and what Claude is asking under it. A dock on the left edge holds the way back and
// one key per panel (Changes, Try it, Verify, Context, More); the panel open sits between the dock
// and the chat and stays open from card to card. Nothing else is on the page. Keys: web/line-keys.ts
// (drawerKeys); the legend and ? list them.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { askOf, cardRepos, fmtK, itemTokens, memoryPct, modelName, ownFolders, packetText, tokens, waiting, type Card, type PacketItem } from '../../shared/cards.ts';
import { againstText, changeRows, changeTotals, patchLines, type Changes } from '../../shared/changes.ts';
import { cardRecipe, specsOf, type CardRun, type RunStep } from '../../shared/recipes.ts';
import { allMerged, openPrs, prLine, prsOf, shipLeft, shipMode } from '../../shared/ship.ts';
import { SOURCE_NAME } from '../../shared/tickets.ts';
import { repoName } from '../../shared/workspaces.ts';
import { CARD_PANELS, type CardPanel } from '../line-model.ts';
import { booting, cardActivity, elapsed, needsYou, progress, shortPath, stepCard } from '../line-model.ts';
import { answerAsk, boardOf, editRecipe, goToTab, openAddComposer, openApp, openChanges, openNeighbour, openWorktrees, saySubmit, setChangeCount, shipKey, togglePanel, tryIt } from '../line-keys.ts';
import { openSession } from '../keys.ts';
import { get, set, useStore } from '../store.ts';
import { cardChanges, send } from '../ws.ts';
import { useNow } from './ActivityBar.tsx';
import { KindPill, useExpandKey } from './TicketLine.tsx';
import { Transcript } from './Transcript.tsx';
import { Icon, Key, Pill, TicketKey } from './ui.tsx';

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

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
function DockItem({ k, name, on, badge, tone, onClick, title }: { k: string; name: string; on?: boolean; badge?: ReactNode; tone?: 'ok' | 'busy'; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title} aria-pressed={on}
      className={`relative flex w-[76px] flex-col items-center gap-1.5 rounded-xl border py-2.5 text-[11.5px] font-semibold ${on ? 'border-line bg-surface text-ink' : 'border-transparent text-sub hover:bg-raise hover:text-ink'}`}>
      <Key k={k} size="sm" />
      <span>{name}</span>
      {badge !== undefined && badge !== null && badge !== 0 && <span className={`absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10.5px] font-bold ${tone === 'ok' ? 'bg-ok text-bg' : 'bg-busy text-bg'}`}>{badge}</span>}
    </button>
  );
}

/** The dock on the left: the way back, then one key per panel; Ship at the bottom. */
function Dock({ card, panel }: { card: Card; panel: CardPanel | null }) {
  const run = useStore((s) => s.runs[card.id]);
  const up = run?.state === 'up';
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
  const titles: Record<CardPanel, string> = {
    changes: 'What it changed, by repo, with the diffs', try: 'Its app: start it, open it, the run recipe', verify: 'Check it in the team’s apps (later)',
    context: 'How it started, what Claude was given, what was added since', more: 'Steps, where it runs, the pull request, the report, worktrees',
  };
  return (
    <div className="flex w-[92px] shrink-0 flex-col items-center gap-1.5 border-r border-line bg-bg px-2 py-3">
      <button className="flex w-[76px] flex-col items-center gap-1 rounded-xl border border-transparent py-2 text-sub hover:bg-raise hover:text-ink" onClick={() => set({ line: { ...get().line, drawer: null } })} title="Back to the board" aria-label="Back to the board">
        <Icon name="back" size={16} /><Key k="Esc" size="sm" />
      </button>
      <span className="my-1 w-11 border-t border-line" />
      {CARD_PANELS.filter((p) => p.id !== 'more').map((p) => <DockItem key={p.id} k={p.key} name={p.name} on={panel === p.id} onClick={() => togglePanel(p.id)} title={titles[p.id]} {...badges[p.id]} />)}
      <span className="grow" />
      {canShip && <DockItem k="s" name={shipName} onClick={() => shipKey(card.id)} title={testing ? 'The report Claude ended with' : 'Commit, push and open a PR in each repo the card changed; merge once open'} />}
      <DockItem k="m" name="More" on={panel === 'more'} onClick={() => togglePanel('more')} title={titles.more} {...badges.more} />
    </div>
  );
}

/** The panel open beside the dock. On a narrow window it lies over the chat. */
function Panel({ card, panel }: { card: Card; panel: CardPanel }) {
  const meta = CARD_PANELS.find((p) => p.id === panel)!;
  return (
    <div className="absolute inset-y-0 left-[92px] right-0 z-10 flex min-h-0 flex-col border-r border-line bg-col lg:static lg:w-[400px] lg:shrink-0" role="region" aria-label={meta.name}>
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
 * is asking with the keys that answer. Without a channel (the card started before channels, or the
 * tab is gone), it says so.
 */
function Say({ card }: { card: Card }) {
  if (!card.sessionId || card.live?.phase === 'ended') return null;
  const ask = askOf(card);
  const answerable = Boolean(ask?.requestId);
  return (
    <div className="grid gap-2.5 border-t border-line bg-surface px-5 py-3">
      {ask && (
        <div className="mx-auto grid w-full max-w-[880px] gap-2 rounded-xl border border-attn/45 bg-attn-bg px-3.5 py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grow font-semibold text-attn">{ask.kind === 'plan' ? 'Approve the plan?' : ask.kind === 'question' ? 'Claude is asking' : <>Run <span className="font-mono font-medium">{ask.detail ?? ask.tool}</span>?</>}</span>
            {answerable
              ? <><button className="btn btn-primary py-0.5" onClick={() => answerAsk(card.id, 'allow')}><Key k="y" size="sm" tone="ghost" />{ask.kind === 'plan' ? 'Approve' : 'Allow'}</button>
                <button className="btn py-0.5" onClick={() => answerAsk(card.id, 'deny')}><Key k="n" size="sm" />{ask.kind === 'plan' ? 'Not yet' : 'Deny'}</button></>
              : ask.kind === 'question' && card.channel ? <span className="text-faint">answer below</span>
              : <button className="btn py-0.5" onClick={() => goToTab(card.id)}><Key k="g" size="sm" />Answer in its tab</button>}
          </div>
          {ask.kind === 'plan' && ask.plan && <div className="md max-h-56 overflow-y-auto rounded-lg border border-line bg-surface px-3 py-2 text-[13px]"><Markdown remarkPlugins={[remarkGfm]}>{ask.plan}</Markdown></div>}
          {ask.kind === 'question' && ask.detail && <p className="text-[13.5px]">{ask.detail}</p>}
        </div>
      )}
      {card.channel
        ? <div className="mx-auto flex w-full max-w-[880px] items-end gap-2">
          <textarea id="card-say" rows={2} placeholder={`Type to ${card.key}’s terminal… Enter sends, Shift+Enter is a new line`} spellCheck={false} className="field grow resize-none text-[13.5px]" />
          {card.stage !== 'done' && <button className="btn py-1.5" onClick={() => openAddComposer(card.id)} title="Add a repo, a ticket or a note: it goes in with your next message"><Key k="c" size="sm" />Context</button>}
          <button className="btn btn-primary py-1.5" onClick={() => saySubmit(card.id)} title="Sends into the terminal session itself, not a copy"><Key k="Enter" size="sm" tone="ghost" />Send</button>
        </div>
        : <p className="mx-auto w-full max-w-[880px] text-[13px] text-faint">This card’s terminal can’t be reached from here (it started without a channel, or the tab closed): type in its tab, {card.key}.</p>}
    </div>
  );
}

// ---- Changes ----

/** What the card changed, by repo: each repo's files, the chosen one's diff under it. j / k move, f opens the full sheet. */
function ChangesPanel({ card }: { card: Card }) {
  const [changes, setChanges] = useState<Changes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const at = useStore((s) => s.line.at);
  const stamp = `${card.files?.length ?? 0}:${card.ship?.steps.length ?? 0}:${card.live?.at ?? 0}`;
  useEffect(() => {
    if (!card.cwd) return;
    let on = true;
    cardChanges(card.id).then((c) => { if (on) { setChanges(c); setError(null); } }, (e: Error) => { if (on) setError(e.message); });
    return () => { on = false; };
  }, [card.id, card.cwd, stamp]);
  const rows = changes ? changeRows(changes) : [];
  const files = rows.filter((r) => r.kind === 'file');
  useEffect(() => { setChangeCount(files.length); return () => setChangeCount(0); }, [files.length]);
  useEffect(() => { document.getElementById(`pchg-${at}`)?.scrollIntoView({ block: 'nearest' }); }, [at]);
  if (!card.cwd) return <p className="px-4 py-3 text-sm text-faint">Nothing yet: the card hasn’t started.</p>;
  if (error) return <p className="px-4 py-3 text-sm text-bad" role="alert">{error}</p>;
  if (!changes) return <p className="flex items-center gap-2 px-4 py-3 text-sm text-faint"><span className="spinner" />Asking git…</p>;
  const totals = changeTotals(changes);
  const chosen = Math.min(at, files.length - 1);
  return (
    <div className="grid gap-3 px-3 py-3">
      {totals.files === 0 && <p className="px-1 text-sm text-faint">Nothing changed yet in {changes.repos.map((r) => r.repo).join(', ') || 'its repos'}.</p>}
      {changes.repos.map((r) => (
        <section key={r.root} className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px]">
            <span className="font-bold">{r.repo}</span>
            <span className="min-w-0 truncate text-[12px] text-faint" title={againstText(r)}>{r.branch && r.branch !== r.base ? r.branch : 'uncommitted'}</span>
            <span className="grow" />
            <span className="font-mono text-[11.5px] tabular-nums"><span className="text-ok">+{r.files.reduce((n, f) => n + f.added, 0)}</span> <span className="text-bad">−{r.files.reduce((n, f) => n + f.removed, 0)}</span></span>
          </div>
          {r.files.length === 0 && <p className="px-3 py-2 text-[12.5px] text-faint">Nothing changed here.</p>}
          {rows.filter((x) => x.kind === 'file' && x.repo.root === r.root).map((x) => x.kind === 'file' && (
            <div key={x.file.path} id={`pchg-${x.index}`} className="border-t border-line/60 first:border-t-0">
              <button onClick={() => set({ line: { ...get().line, at: x.index } })} aria-pressed={x.index === chosen}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] ${x.index === chosen ? 'bg-raise' : 'hover:bg-raise/60'}`}>
                <span className={`w-[52px] shrink-0 text-[10.5px] font-bold uppercase ${x.file.kind === 'deleted' ? 'text-bad' : x.file.kind === 'modified' ? 'text-faint' : 'text-ok'}`}>{{ added: 'added', modified: 'changed', deleted: 'deleted', renamed: 'renamed', new: 'new' }[x.file.kind]}</span>
                <span className="min-w-0 grow truncate font-mono" title={x.file.path}>{x.file.path}</span>
                {x.file.mine && <span className="shrink-0 rounded-full bg-ok-bg px-1.5 text-[10.5px] font-semibold text-ok" title="Written by this card’s session">card</span>}
                <span className="shrink-0 font-mono text-[11px] tabular-nums"><span className="text-ok">+{x.file.added}</span> <span className="text-bad">−{x.file.removed}</span></span>
              </button>
              {x.index === chosen && (x.file.binary
                ? <p className="px-3 py-1.5 text-[12px] text-faint">A binary file: nothing to show.</p>
                : <pre className="m-0 max-h-[42vh] overflow-auto border-t border-line/60 bg-bg py-1 font-mono text-[11.5px] leading-[1.45]">
                  {patchLines(x.file.patch).filter((l) => l.kind !== 'meta').map((l, i) => (
                    <div key={i} className={`whitespace-pre px-3 ${l.kind === 'add' ? 'bg-ok-bg text-ok' : l.kind === 'del' ? 'bg-bad-bg text-bad' : l.kind === 'hunk' ? 'bg-raise text-busy' : 'text-sub'}`}>{l.text || ' '}</div>
                  ))}
                </pre>)}
            </div>
          ))}
        </section>
      ))}
      {totals.truncated && <p className="px-1 text-[12.5px] text-attn">The diff was cut: it is very large.</p>}
      {totals.files > 0 && <button className="flex items-center gap-1.5 px-1 text-[12.5px] text-faint hover:text-ink" onClick={() => openChanges(card.id)}>full width <Key k="f" size="sm" /></button>}
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

/** Try it: this card's app (its own folders, its own port), the run recipe step by step, and what a failing step said. */
function TryIt({ card }: { card: Card }) {
  const home = cardRepos(card)[0];
  const recipe = useStore((s) => cardRecipe(s.recipes, card.workspaceId, home));
  const wsName = useStore((s) => s.workspaces.find((w) => w.id === card.workspaceId)?.name);
  const last: CardRun | undefined = useStore((s) => s.runs[card.id]);
  const specs = recipe ? specsOf(recipe) : [];
  const stack = recipe?.stack;
  const live = last?.state === 'running' || last?.state === 'up';
  const run = last && (live || stack || (recipe && last.steps.map((s) => s.cmd).join('\n') === specs.map((s) => s.cmd).join('\n'))) ? last : undefined;
  const name = stack ? `${wsName ?? 'the lane'} stack${run?.choice ? ` · ${run.choice}` : ''}` : recipe?.workspaceId ? `${wsName ?? 'the lane'} lane` : home ? repoName(home) : card.key;
  const all: RunStep[] = run?.steps ?? specs.map((s) => ({
    cmd: s.cmd, state: s.note ? 'note' as const : 'wait' as const, tail: [],
    ...(s.repo ? { repo: s.repo } : {}), ...(Object.keys(s.env).length ? { env: Object.keys(s.env) } : {}), ...(s.stop ? { stop: true } : {}),
  }));
  const steps = all.filter((s) => !s.stop);
  const stops = all.filter((s) => s.stop);
  const shown = run?.steps.find((s) => s.state === 'bad') ?? run?.steps.find((s) => s.state === 'go') ?? (run?.state === 'up' ? run.steps.find((s) => s.state === 'up') : undefined);
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
          <button className="btn py-1" onClick={() => editRecipe(card.id)} title="Write or edit the run recipe"><Key k="e" size="sm" />{recipe ? 'Edit the recipe' : 'Write a recipe'}</button>
        </div>
      </Sec>
      <Sec id="try-it" title={`${name}${stack ? '' : ' run recipe'}`} right={<span className="text-[12px] text-faint">{recipe ? recipe.source : 'no recipe yet'}</span>}>
        {steps.length ? (
          <ol className="grid min-w-0 gap-1 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[12px]">
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
        ) : <p className="text-[13px] text-faint">No run recipe for {name}: nothing to go on in its package.json or compose file.</p>}
        {recipe?.source.startsWith('from the workspace file') && !run && <div className="rounded-lg bg-attn-bg px-3 py-2 text-[13px] text-attn">This recipe came with a lane file someone shared. Read the commands before starting: they run on this machine.</div>}
        {shown && shown.tail.length > 0 && (
          <pre className="m-0 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[11.5px] leading-snug text-sub">{shown.tail.join('\n')}</pre>
        )}
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
    <Sec id="added-since" title="Added since it started" right={card.stage !== 'done' && <button className="btn py-0.5 text-[12.5px]" onClick={() => openAddComposer(card.id)}><Key k="c" size="sm" />Add</button>}>
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
