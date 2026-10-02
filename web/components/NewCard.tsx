// The new-card screen: 1 add context (the repo library), 2 what Claude will know (three layers and
// your note, or the exact text with p), 3 how it starts (terminal tab, workspace, home repo,
// branch, mode, opening message, and the commands it will run). Ctrl+Enter starts work.
// With c in a card's drawer, the same screen adds to that running card instead: panel 2 is what
// you are adding (and what it already has), panel 3 is when it reaches Claude.

import { useEffect, type ReactNode } from 'react';
import { CARD_KINDS, fmtK, HOOK_CONTEXT_LIMIT, homeOf, includedRepos, itemTokens, kindName, laterText, launchLines, memoryPct, modelFor, modelName, packetText, STAGES, tokens, type Card } from '../../shared/cards.ts';
import type { Workspace } from '../../shared/protocol.ts';
import { SOURCE_NAME, ticketSub } from '../../shared/tickets.ts';
import { samePath } from '../../shared/workspaces.ts';
import { cardFolders, cardHasRepo, cardHasTicket, composerKey, gotPr, goRows, packetRows, pickOption, pickTicket, repoOrigin, sources, ticketSources, toggleSource, togglePacketRow, wantsPr, type Composer, type Pane } from '../line-model.ts';
import { foundFor, keepRepo, leaveComposer, startWork, updateComposer } from '../line-keys.ts';
import { get, NO_FOUND, set, useStore } from '../store.ts';
import { findPr, searchTickets } from '../ws.ts';
import { CornerClose } from './Overlay.tsx';
import { Key, TicketKey, WsBadge } from './ui.tsx';

/** The small kind badge on a packet row. */
const KIND: Record<string, string> = { repo: 'repo', note: 'note', desc: 'ticket', ac: 'done when', comments: 'talk', attach: 'file', linked: 'link', ticket: 'ticket', recipe: 'run' };

export function NewCard() {
  const c = useStore((s) => s.composer)!;
  const workspaces = useStore((s) => s.workspaces);
  const key = useStore((s) => composerKey(s.composer!, s.nextKey));
  const pinned = useStore((s) => s.cardModel);
  const user = useStore((s) => s.userModel);
  const ws = workspaces.find((w) => w.id === c.workspaceId) ?? null;
  const target = useStore((s) => s.cards.find((x) => x.id === s.composer?.addTo?.id));
  const text = c.addTo ? addingText(c) : packetText(c, key);
  const t = c.ticket;
  const model = modelFor(c.launch, pinned ?? undefined, user ?? undefined);
  const size = tokens(text);
  useTicketSearch(c);
  usePrLookup(c);
  if (c.addTo && target) return <AddScreen c={c} card={target} ws={ws} text={text} />;
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-bg" role="region" aria-label="New card">
      <div className="flex items-center gap-4 border-b border-line bg-surface px-4 py-3">
        <WsBadge ws={ws} size={30} />
        <div className="flex min-w-0 grow flex-col gap-1">
          <div className="flex items-center gap-1.5 text-sm text-faint">
            New card · {key} · {ws?.name ?? 'no lane'} · {t ? `from ${SOURCE_NAME[t.source]}${t.demo ? ' (demo)' : ''}` : 'no ticket yet'} ·
            <button className="flex items-center gap-1.5 rounded-md border border-line bg-raise px-1.5 font-semibold text-ink hover:border-ring" onClick={() => updateComposer((x) => ({ ...x, pane: 'go', gi: 0 }))}
              title="The kind of work: Develop, QA or Code review. k changes it.">
              {kindName(c.kind)}<Key k="k" size="sm" />
            </button> ·
            <button className="flex items-center gap-1.5 rounded-md border border-line bg-raise px-1.5 font-semibold text-ink hover:border-ring" onClick={() => updateComposer((x) => ({ ...x, pane: 'go' }))}
              title="The model Claude runs in this card. m changes it; so does Model under How it starts.">
              {modelName(model)}{!c.launch.model && <span className="font-normal text-faint">default</span>}<Key k="m" size="sm" />
            </button>
          </div>
          {t
            ? <div className="flex min-w-0 items-center gap-2 py-1.5 text-[19px] font-bold"><TicketKey k={t.key} source={t.source} /><span className="truncate">{t.title}</span></div>
            : <input
                id="cp-title" type="text" autoComplete="off" value={c.title}
                placeholder="What should this card do? e.g. Add a size guide to product pages, or pick a ticket"
                onChange={(e) => updateComposer((x) => ({ ...x, title: e.target.value }))}
                className="w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[19px] font-bold outline-none focus:border-ring focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--c-ring)_20%,transparent)]"
              />}
        </div>
        <div className="hidden items-center gap-2 whitespace-nowrap text-[13px] lg:flex" title={`About 4 characters per token; ${memoryPct(size)}% of what Claude can hold`}>
          <span className="text-faint">Claude starts knowing</span>
          <b className="font-mono text-[15px] tabular-nums">{fmtK(size)}</b>
        </div>
        <button className="btn whitespace-nowrap py-1" onClick={() => updateComposer((x) => ({ ...x, preview: !x.preview }))}><Key k="p" size="sm" />{c.preview ? 'Back to the list' : 'Preview what Claude gets'}</button>
        <CornerClose onClick={leaveComposer} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[360px_minmax(0,1fr)_420px] lg:overflow-hidden">
        <Sources c={c} />
        <PacketPane c={c} text={text} />
        <GoPane c={c} keyName={key} />
      </div>
    </div>
  );
}

/**
 * The search box on Tickets also asks the tracker, so anyone's ticket can be found (one to review,
 * one someone asked you to test). A short pause after typing; only the latest text's answer counts.
 */
export function useTicketSearch(c: Composer) {
  const q = c.tab === 'tickets' ? c.q.trim() : '';
  useEffect(() => {
    if (q.length < 2) { if (get().found !== NO_FOUND) set({ found: NO_FOUND }); return; }
    set({ found: { q, tickets: get().found.q === q ? get().found.tickets : [], looking: true } });
    const t = setTimeout(() => {
      searchTickets(q).then(
        (r) => { if (get().found.q === q) set({ found: { q, tickets: r.tickets, looking: false, ...(r.problem ? { problem: r.problem } : {}) } }); },
        (e: Error) => { if (get().found.q === q) set({ found: { q, tickets: [], looking: false, problem: e.message } }); },
      );
    }, 350);
    return () => clearTimeout(t);
  }, [q]);
}

/** QA and review cards: ask the ticket's code hosts for its pull request, once per ticket. */
export function usePrLookup(c: Composer) {
  const key = wantsPr(c);
  useEffect(() => {
    if (!key) return;
    const repos = includedRepos(get().composer!.packet);
    updateComposer((x) => ({ ...x, prLooking: true }));
    findPr(key, repos).then(
      (r) => updateComposer((x) => gotPr(x, key, r.pr, r.notes)),
      (e: Error) => updateComposer((x) => gotPr(x, key, undefined, [e.message])),
    );
  }, [key]);
}

/** Exactly what the hook will hand Claude for what is being added: the items switched on, and your note. */
function addingText(c: Composer): string {
  const note = c.packet.note.trim();
  const items = [...c.packet.card.filter((i) => i.on), ...(note ? [{ kind: 'note' as const, id: 'note', label: note, text: note, on: true }] : [])];
  return items.length ? laterText(c.addTo!.key, items) : '(Nothing added yet.)';
}

/** The screen when adding to a running card (c in its drawer). */
function AddScreen({ c, card, ws, text }: { c: Composer; card: Card; ws: Workspace | null; text: string }) {
  const stage = STAGES.find((s) => s.id === card.stage)?.name ?? card.stage;
  const has = tokens(packetText(card, card.key, card.branchName) + (card.later?.length ? laterText(card.key, card.later) : ''));
  const empty = !c.packet.card.some((i) => i.on) && !c.packet.note.trim();
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-bg" role="region" aria-label={`Add context to ${card.key}`}>
      <div className="flex items-center gap-4 border-b border-line bg-surface px-4 py-3">
        <WsBadge ws={ws} size={30} />
        <div className="flex min-w-0 grow flex-col gap-1">
          <div className="text-sm text-faint">Add context to a running card · {stage} · terminal tab {card.key}</div>
          <div className="flex min-w-0 items-center gap-2 py-1.5 text-[19px] font-bold"><TicketKey k={card.key} source={card.ticket?.source} /><span className="truncate">{card.title}</span></div>
        </div>
        <div className="hidden items-center gap-2 whitespace-nowrap text-[13px] lg:flex" title="About 4 characters per token">
          <span className="text-faint">Adding</span>
          <b className="font-mono text-[15px] tabular-nums">{empty ? '0.0k' : fmtK(tokens(text))}</b>
          <span className="text-faint">on top of {fmtK(has)}</span>
        </div>
        <button className="btn whitespace-nowrap py-1" onClick={() => updateComposer((x) => ({ ...x, preview: !x.preview }))}><Key k="p" size="sm" />{c.preview ? 'Back to the list' : 'Preview what Claude gets'}</button>
        <CornerClose onClick={() => set({ composer: null })} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[360px_minmax(0,1fr)_420px] lg:overflow-hidden">
        <Sources c={c} />
        <PacketPane c={c} text={text} card={card} />
        <DeliverPane c={c} card={card} />
      </div>
    </div>
  );
}

function PaneBox({ pane, n, title, right, children, c }: { pane: Pane; n: number; title: string; right?: ReactNode; children: ReactNode; c: Composer }) {
  const on = c.pane === pane;
  return (
    <section
      onMouseDown={() => { if (!on) updateComposer((x) => ({ ...x, pane })); }}
      className={`flex min-h-0 min-w-0 flex-col border-r border-line last:border-r-0 ${on ? 'bg-surface shadow-[inset_0_3px_0_var(--c-acc)]' : 'bg-col'}`}
    >
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <span className={`grid h-5 w-5 place-items-center rounded-full border font-mono text-xs font-bold ${on ? 'border-acc bg-acc text-acc-ink' : 'border-line bg-raise text-sub'}`}>{n}</span>
        <h4 className="grow text-sm font-bold">{title}</h4>
        {right}
      </div>
      {children}
    </section>
  );
}

function Sources({ c }: { c: Composer }) {
  const repos = useStore((s) => s.library.repos);
  const tickets = useStore((s) => s.tickets);
  const cards = useStore((s) => s.cards);
  const found = useStore((s) => s.found);
  const onTickets = c.tab === 'tickets';
  const list = sources(c, repos);
  const started = new Set(cards.map((x) => x.key));
  const tlist = ticketSources(c, tickets, started, foundFor(get(), c.q));
  const folders = cardFolders(c, repos);
  const si = c.tab === 'folders' ? Math.min(c.si, folders.length) : Math.min(c.si, (onTickets ? tlist.length : list.length) - 1);
  const focused = c.pane === 'src';
  useEffect(() => {
    if (focused && si >= 0) document.getElementById(`src-${si}`)?.scrollIntoView({ block: 'nearest' });
  }, [focused, si, c.tab]);
  const tab = (id: Composer['tab'], name: string) => (
    <button onClick={() => updateComposer((x) => ({ ...x, tab: id, si: 0, pane: 'src' }))}
      className={`rounded-md border px-1.5 py-0.5 text-[12.5px] ${c.tab === id ? 'border-line bg-raise font-semibold' : 'border-transparent text-faint hover:text-ink'}`}>{name}</button>
  );
  return (
    <PaneBox pane="src" n={1} title="Add context" c={c} right={<span className="kc-hint flex items-center gap-2"><span className="text-xs text-faint">click, or</span><Key k="Space" size="sm" /></span>}>
      <div className="flex items-center gap-1 px-3 pb-2">
        {tab('tickets', 'Tickets')}{tab('repos', 'Repos')}{tab('folders', 'Folders')}
        <span className="grow" />
        <Key k="←" size="sm" /><Key k="→" size="sm" />
      </div>
      {c.tab !== 'folders' && <label className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-line bg-surface py-1 pl-2.5 pr-1.5">
        <Key k="/" size="sm" />
        <input id="cp-q" type="text" autoComplete="off" value={c.q} placeholder={onTickets ? 'Search tickets, or type a key, e.g. SHOP-160' : 'Search the repo library'}
          onChange={(e) => updateComposer((x) => ({ ...x, q: e.target.value, si: 0 }))}
          className="w-full bg-transparent text-sm outline-none placeholder:text-faint" />
      </label>}
      {onTickets && c.q.trim().length >= 2 && (found.looking || found.problem) && (
        <div className={`mx-3 mb-2 text-[12.5px] ${found.problem ? 'text-attn' : 'text-faint'}`}>{found.problem ?? 'Searching Jira for anyone’s tickets…'}</div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {c.tab === 'folders' ? <>
          <button id="src-0" onClick={() => { updateComposer((x) => ({ ...x, pane: 'src', si: 0 })); set({ modal: { kind: 'addFolder' } }); }}
            className={`flex items-center gap-2.5 rounded-lg border border-dashed border-line px-2.5 py-2 text-left text-[13.5px] ${focused && si === 0 ? 'is-focus bg-raise' : 'hover:bg-raise'}`}>
            <span className="w-4 text-center font-mono text-[17px] font-bold text-faint">+</span>
            <span className="grow">Add a folder from anywhere on disk…</span>
            <Key k="Enter" size="sm" />
          </button>
          {folders.map((d, i) => (
            <button key={d.id} id={`src-${i + 1}`} onClick={() => updateComposer((x) => ({ ...toggleSource(x, d.id), pane: 'src', si: i }))}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] ${focused && si === i + 1 ? 'is-focus bg-raise' : 'hover:bg-raise'}`}>
              <span className="rounded border border-line px-1 font-mono text-[10px] font-bold uppercase text-faint">dir</span>
              <span className="min-w-0 grow"><span className="block truncate">{d.label}</span><span className="block truncate text-xs text-faint">{d.id}</span></span>
              <span className="rounded-full bg-ok-bg px-2 text-[11px] font-semibold text-ok">added</span>
            </button>
          ))}
        </>
        : onTickets ? (tlist.length ? tlist.map((tk, i) => {
          const own = c.ticket?.key === tk.key || c.addTo?.ticketKey === tk.key;
          const related = c.packet.card.some((x) => x.id === `ticket:${tk.key}`);
          const had = !own && cardHasTicket(c, tk.key);
          const taken = !own && !c.addTo && started.has(tk.key);
          return (
            <button key={tk.key} id={`src-${i}`} onClick={() => updateComposer((x) => { const r = pickTicket({ ...x, pane: 'src', si: i }, tk, get().workspaces, started, get().recipes); return typeof r === 'string' ? r : { ...r, pane: 'src', si: i }; })}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] ${focused && i === si ? 'is-focus bg-raise' : 'hover:bg-raise'} ${own || related || had ? 'opacity-70' : ''}`}>
              <TicketKey k={tk.key} source={tk.source} />
              <span className="min-w-0 grow">
                <span className="block truncate">{tk.title}</span>
                <span className="block truncate text-xs text-faint">{ticketSub(tk)}{taken ? ' · has a card' : ''}{tk.hidden ? ' · hidden from the Inbox' : ''}{tk.found ? ' · found in Jira' : ''}{tk.demo ? ' · demo' : ''}</span>
              </span>
              {own ? <span className="rounded-full bg-ok-bg px-2 text-[11px] font-semibold text-ok">this card’s</span>
                : related ? <span className="rounded-full bg-ok-bg px-2 text-[11px] font-semibold text-ok">{c.addTo ? 'adding' : 'related'}</span>
                : had ? <span className="rounded-full bg-raise px-2 text-[11px] font-semibold text-faint">has it</span>
                : <span className="w-4 text-center font-mono text-[17px] font-bold text-faint">+</span>}
            </button>
          );
        }) : <div className="rounded-xl border border-dashed border-line px-2 py-3 text-center text-[12.5px] text-faint">{c.q.trim() ? (found.looking ? 'Searching…' : `Nothing matches “${c.q}”`) : tickets.length ? 'No tickets' : <>No tickets yet. <Key k="⇧T" size="sm" inline /> on the board connects Jira or Trello, or shows demo tickets.</>}</div>)
        : list.length ? list.map((r, i) => {
          const where = repoOrigin(c, r.path);
          const had = cardHasRepo(c, r.path);
          const inPacket = where === 'workspace' ? c.packet.workspace.find((x) => samePath(x.id, r.path))?.on : where === 'card';
          return (
            <button key={r.path} id={`src-${i}`} onClick={() => updateComposer((x) => ({ ...toggleSource(x, r.path), pane: 'src', si: i }))}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] ${focused && i === si ? 'is-focus bg-raise' : 'hover:bg-raise'} ${inPacket || had ? 'opacity-70' : ''}`}>
              <span className="rounded border border-line px-1 font-mono text-[10px] font-bold uppercase text-faint">repo</span>
              <span className="min-w-0 grow">
                <span className="block truncate">{r.name}</span>
                <span className="block truncate text-xs text-faint">{had ? `${c.addTo!.key} can use it` : where === 'workspace' ? 'in this lane' : 'from the library'}{r.branch ? ` · ${r.branch}` : ''}</span>
              </span>
              {had ? <span className="rounded-full bg-raise px-2 text-[11px] font-semibold text-faint">has it</span> : inPacket ? <span className="rounded-full bg-ok-bg px-2 text-[11px] font-semibold text-ok">added</span> : <span className="w-4 text-center font-mono text-[17px] font-bold text-faint">+</span>}
            </button>
          );
        }) : <div className="rounded-xl border border-dashed border-line px-2 py-3 text-center text-[12.5px] text-faint">{repos.length ? `Nothing matches “${c.q}”` : 'The repo library is empty. F on the board picks the folders it scans.'}</div>}
      </div>
      <div className="border-t border-line px-4 pb-3 pt-2 text-[12.5px] leading-snug text-faint">{c.tab === 'folders'
        ? (c.addTo ? 'Any folder on disk. Added now, it reaches Claude as its path; the session may ask once before reading outside its folder.' : 'Any folder on disk, git repo or not: docs, specs, a tool’s folder. It starts with --add-dir, so Claude can read and edit it.')
        : c.addTo
        ? (onTickets ? 'Jira and Trello tickets, read-only. What you pick goes in as a related ticket.' : 'The repo library. A repo added now reaches Claude as its path; the session may ask once before working outside its folder.')
        : onTickets
          ? 'Your tickets, and anyone’s through / (Jira is searched too), read-only. The first you pick becomes the card’s ticket; later ones go in as related.'
          : 'The repo library. Extra repos start with --add-dir, so Claude can read and edit them.'}</div>
    </PaneBox>
  );
}

function PacketPane({ c, text, card }: { c: Composer; text: string; card?: Card }) {
  const rows = packetRows(c);
  const focused = c.pane === 'pkt';
  const pi = Math.min(c.pi, rows.length - 1);
  const home = homeOf(c.packet, c.launch);
  const over = text.length > HOOK_CONTEXT_LIMIT;
  const wsName = useStore((s) => s.workspaces.find((w) => w.id === c.workspaceId)?.name);
  const library = useStore((s) => s.library.repos);
  let idx = -1;
  const row = (layer: 'workspace' | 'ticket' | 'card', item: (typeof c.packet.card)[number]) => {
    idx += 1;
    const at = idx;
    const isHome = !card && item.kind === 'repo' && item.on && home !== undefined && samePath(item.id, home);
    return (
      <div key={layer + item.id} onClick={() => updateComposer((x) => { const r = togglePacketRow({ ...x, pi: at }, at); return typeof r === 'string' ? r : { ...r, pi: at }; })}
        className={`flex min-w-0 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13.5px] [&+&]:border-t [&+&]:border-line/60 ${item.on ? '' : 'text-faint'} ${focused && at === pi ? 'is-focus' : ''}`}>
        <span className="grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px] border-line font-mono text-[11px] font-bold text-ok">{item.on ? '✓' : ''}</span>
        <span className="whitespace-nowrap rounded border border-line px-1 font-mono text-[10px] font-bold uppercase text-faint">{item.kind === 'repo' && !library.some((r) => samePath(r.path, item.id)) && !(c.packet.workspace.some((w) => w.id === item.id)) ? 'dir' : KIND[item.kind] ?? item.kind}</span>
        <span className="min-w-0 grow truncate">{item.label}</span>
        {isHome && <span className="rounded-full bg-busy-bg px-2 text-[11px] font-semibold text-busy">starts here</span>}
        {item.kind === 'repo' && item.on && !isHome && !card && <span className="text-xs text-faint">--add-dir</span>}
        <span className={`font-mono text-[11.5px] font-semibold tabular-nums text-faint ${item.on ? '' : 'line-through'}`}>{fmtK(itemTokens(item))}</span>
        {layer === 'card' && item.kind === 'repo' && c.workspaceId && !card && (
          <button className="flex items-center gap-1 whitespace-nowrap text-xs text-faint hover:text-ink" title="Keep this repo for the whole lane: every card there gets it"
            onClick={(e) => { e.stopPropagation(); keepRepo(at); }}>Keep for {wsName ?? 'workspace'}<Key k="w" size="sm" /></button>
        )}
        {layer === 'card' && <Key k="x" size="sm" />}
      </div>
    );
  };
  const layer = (name: string, note: string, layerId: 'workspace' | 'ticket' | 'card', empty: ReactNode, extra?: ReactNode) => {
    const items = c.packet[layerId];
    return (
      <div className="shrink-0 overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line bg-raise px-3 py-1.5 text-[12.5px]">
          <span className="text-[13.5px] font-bold">{name}</span>
          <span className="grow text-faint">{note}</span>
          <span className="font-mono text-[11.5px] font-semibold tabular-nums text-faint">{fmtK(items.filter((i) => i.on).reduce((n, i) => n + itemTokens(i), 0))}</span>
        </div>
        {items.length ? items.map((i) => row(layerId, i)) : <div className="px-3 py-2.5 text-[13px] text-faint">{empty}</div>}
        {extra}
      </div>
    );
  };
  const noteFocused = focused && pi === rows.length - 1;
  const noteRow = (placeholder: string) => (
    <div className={`flex items-start gap-2.5 border-t border-line/60 px-3 py-1.5 ${noteFocused ? 'is-focus' : ''}`}>
      <span className="mt-1.5 rounded border border-line px-1 font-mono text-[10px] font-bold uppercase text-faint">you</span>
      <textarea id="cp-note" value={c.packet.note} placeholder={placeholder}
        onFocus={() => updateComposer((x) => ({ ...x, pane: 'pkt', pi: rows.length - 1 }))}
        onChange={(e) => updateComposer((x) => ({ ...x, packet: { ...x.packet, note: e.target.value } }))}
        className="min-h-[56px] flex-1 resize-none rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13.5px] leading-snug outline-none focus:border-ring" />
      <Key k="e" size="sm" className="mt-1.5" />
    </div>
  );
  return (
    <PaneBox pane="pkt" n={2} c={c} title={c.preview ? 'Exactly what Claude receives' : card ? 'What you are adding' : 'What Claude will know'}
      right={c.preview ? <span className="text-xs text-faint">{card ? 'sent by a UserPromptSubmit hook' : 'returned by the SessionStart hook as additionalContext'}</span> : <span className="kc-hint flex items-center gap-2"><Key k="Space" size="sm" /><span className="text-xs text-faint">include or leave out</span></span>}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 pb-3.5 pt-0.5">
        {over && <div className="rounded-lg bg-attn-bg px-3 py-2 text-[13px] text-attn">Over {HOOK_CONTEXT_LIMIT.toLocaleString()} characters: Claude Code will hand Claude a file with a preview instead of the whole text. Leave something out.</div>}
        {c.preview
          ? <pre className="m-0 whitespace-pre-wrap break-words rounded-xl border border-line bg-bg px-3.5 py-3 font-mono text-[12.5px] leading-relaxed">{text}</pre>
          : card ? <>
            {layer('Adding now', `only ${card.key} gets these`, 'card', <>Pick repos or tickets in panel 1 with <Key k="Space" size="sm" inline />, or write a note with <Key k="e" size="sm" inline />.</>, noteRow('Anything Claude should know from here on? e.g. The totals must round down, not to nearest.'))}
            <AlreadyHas card={card} />
          </>
          : <>
            {layer('Workspace', wsName ? `shared by every ${wsName} card · set once` : 'no lane', 'workspace', 'Pick a lane under How it starts, or add repos from the library.')}
            {layer('Ticket', c.ticket ? `from ${SOURCE_NAME[c.ticket.source]} ${c.ticket.key}` : 'none yet', 'ticket', 'No ticket. Pick one under Tickets, or describe the work in the title.')}
            {layer('This card', 'only this card gets these', 'card', <>Add repos from the library with <Key k="Space" size="sm" inline />. <Key k="w" size="sm" inline /> on one keeps it for the whole lane.</>,
              noteRow('Anything else Claude should know? e.g. Keep it behind the size_guide flag.'))}
          </>}
      </div>
    </PaneBox>
  );
}

function GoPane({ c, keyName }: { c: Composer; keyName: string }) {
  const workspaces = useStore((s) => s.workspaces);
  const model = useStore((s) => s.cardModel);
  const user = useStore((s) => s.userModel);
  const trust = useStore((s) => s.settings.trustWorktrees === true);
  const rows = goRows(c, workspaces, keyName, { pinned: model, user });
  const gi = Math.min(c.gi, rows.length - 1);
  const focused = c.pane === 'go';
  return (
    <PaneBox pane="go" n={3} c={c} title="How it starts" right={<span className="kc-hint flex items-center gap-2"><Key k="↑" size="sm" /><Key k="↓" size="sm" /><span className="text-xs text-faint">then</span><Key k="←" size="sm" /><Key k="→" size="sm" /></span>}>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3.5 pb-3.5 pt-0.5">
        {rows.map((r, i) => (
          <div key={r.id} onMouseDown={() => updateComposer((x) => ({ ...x, gi: i }))}
            className={`grid gap-1.5 rounded-xl border border-transparent px-2.5 py-2 ${focused && i === gi ? 'is-focus' : ''}`}>
            <div className="eyebrow">{r.label}</div>
            {r.id === 'msg'
              ? <input id="cp-msg" type="text" autoComplete="off" value={c.launch.message}
                  onChange={(e) => updateComposer((x) => ({ ...x, msgTouched: true, launch: { ...x.launch, message: e.target.value } }))}
                  className="w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13.5px] outline-none focus:border-ring" />
              : <div className="flex flex-wrap gap-1.5">
                  {r.opts.map((o, j) => (
                    <button key={o + j} disabled={r.off?.includes(j)}
                      onClick={() => updateComposer((x) => ({ ...pickOption(x, r.id, j, workspaces, keyName, get().recipes), gi: i }))}
                      className={`rounded-lg border px-2.5 py-1 text-[13px] ${j === r.at ? 'border-ring bg-surface font-semibold text-ink shadow-[0_0_0_2px_color-mix(in_srgb,var(--c-ring)_22%,transparent)]' : 'border-line bg-raise text-sub'} disabled:cursor-default disabled:opacity-50`}>{o}</button>
                  ))}
                </div>}
            {r.id === 'kind' && <div className="text-[12.5px] text-faint">{CARD_KINDS.find((k) => k.id === c.kind)!.blurb} <Key k="k" size="sm" inline /> changes it from anywhere on this screen.</div>}
            {r.id === 'branch' && c.kind === 'build' && <div className="text-[12.5px] text-faint">{c.launch.branch === 'worktree'
              ? <>Each repo gets a folder of its own next to it ({homeOf(c.packet, c.launch) ? `${homeOf(c.packet, c.launch)!.replace(/[\\/]+$/, '')}-${keyName.toLowerCase()}` : 'repo-card-n'}) on the card’s branch, so other cards in the same repos are never touched. What that costs: a UI’s first start runs its install, and Claude Code asks once in the tab whether to trust the new folder{trust ? ' (your setting marks it trusted first)' : <> (the <Key k="?" size="sm" inline /> <Key k="B" size="sm" inline /> setting can mark it trusted first)</>}. <Key k="⇧X" size="sm" inline /> on the card removes the folders when it is done.</>
              : c.launch.branch === 'new' ? 'Switches the repo’s usual folder to the new branch. Another card in the same repo would then change the files under this one: pick a worktree for that.'
              : 'Stays on whatever the repo’s folder is on, and changes it there.'}</div>}
            {r.id === 'branch' && c.kind !== 'build' && <div className="text-[12.5px] text-faint">{c.pr
              ? <>Found <a className="underline hover:text-ink" href={c.pr.url} target="_blank" rel="noreferrer">PR #{c.pr.number} {c.pr.title}</a>: {c.pr.source} → {c.pr.target}. The copy is a detached worktree, so your own checkout stays as it is.</>
              : c.prLooking ? 'Looking for the ticket’s pull request…'
              : c.ticket ? <>No open pull request names {c.ticket.key}{c.prNotes?.length ? `: ${c.prNotes.join('; ')}` : '.'} {c.kind === 'review' ? 'Claude will look for its branch.' : ''}</>
              : 'Pick the ticket first: its pull request is looked up by its key.'}</div>}
            {r.id === 'where' && <div className="text-[12.5px] text-faint">A Windows Terminal tab runs claude with this context.{c.launch.branch === 'worktree' && trust ? '' : ' The first time in a folder it asks whether to trust it: answer in the tab.'}</div>}
            {r.id === 'mode' && c.launch.mode === 'auto' && <div className="text-[12.5px] text-faint">Auto isn’t offered on every model{c.launch.model === 'haiku' ? ' (Haiku refuses it)' : ''}.</div>}
            {r.id === 'model' && <div className="text-[12.5px] text-faint">{c.launch.model ? `Starts with --model ${c.launch.model}.` : model ? `The default is ${model}, pinned by this server (CC_CONTROL_MODEL).` : user ? `The default is ${user}, from your Claude Code settings.` : 'Claude Code picks, as in a plain terminal.'} <Key k="m" size="sm" inline /> changes it from anywhere on this screen.</div>}
          </div>
        ))}
        <div className="grid gap-1.5 px-2.5 py-2">
          <div className="eyebrow">What happens</div>
          <pre className="m-0 whitespace-pre-wrap break-all rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[11.5px] leading-relaxed">{launchLines(c, keyName, model ?? undefined).join('\n')}</pre>
          <div className="text-[12.5px] text-faint">The hook comes from cc-control’s own settings file, passed with --settings. Nothing is added to your Claude Code settings.</div>
        </div>
      </div>
      <div className="grid gap-2 border-t border-line px-4 py-3">
        {c.error && <div className="rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{c.error}</div>}
        <button className="btn btn-primary justify-center py-2 text-[15px]" disabled={c.starting} onClick={startWork}>
          <Key k="Ctrl Enter" size="sm" tone="ghost" />{c.starting ? 'Starting…' : 'Start work'}
        </button>
        <span className="text-[12.5px] text-faint">{c.kind === 'qa' ? 'The card goes to Plan with its test plan; approve it in the tab, and Claude sets up the data and walks you through. The report lands on the card.'
          : c.kind === 'review' ? 'Claude reviews read-only. Its findings land on the card, to copy into the PR when you are ready.'
          : c.launch.mode === 'plan' ? 'The card goes to Plan. Nothing changes until you approve the plan.' : 'The card goes straight to Build.'}</span>
      </div>
    </PaneBox>
  );
}

/** Adding to a running card: what it already has, dimmed (given when it started, and added since). */
function AlreadyHas({ card }: { card: Card }) {
  const given = [...card.packet.workspace, ...card.packet.ticket, ...card.packet.card].filter((i) => i.on);
  return (
    <div className="shrink-0 overflow-hidden rounded-xl border border-line bg-surface opacity-75">
      <div className="flex items-center gap-2 border-b border-line bg-raise px-3 py-1.5 text-[12.5px]">
        <span className="text-[13.5px] font-bold">Already has</span>
        <span className="grow text-faint">given when it started, and added since</span>
      </div>
      <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
        {given.map((i) => <span key={i.kind + i.id} className="rounded-full border border-line bg-raise px-2.5 py-0.5 text-[12.5px]">{i.kind === 'repo' ? `repo · ${i.label}` : i.label.length > 40 ? `${i.label.slice(0, 38)}…` : i.label}</span>)}
        {card.packet.note.trim() && <span className="rounded-full border border-line bg-raise px-2.5 py-0.5 text-[12.5px]">your note</span>}
        {(card.later ?? []).map((i) => <span key={i.id} className="rounded-full border border-line bg-raise px-2.5 py-0.5 text-[12.5px]">{i.kind === 'repo' ? `repo · ${i.label}` : i.label.slice(0, 40)}{i.sent ? '' : ' · waiting'}</span>)}
      </div>
    </div>
  );
}

/** Adding to a running card, panel 3: when it reaches Claude, and the button. */
function DeliverPane({ c, card }: { c: Composer; card: Card }) {
  const workspaces = useStore((s) => s.workspaces);
  const rows = goRows(c, workspaces, card.key);
  const focused = c.pane === 'go';
  return (
    <PaneBox pane="go" n={3} c={c} title="Deliver" right={<span className="kc-hint flex items-center gap-2"><Key k="↑" size="sm" /><Key k="↓" size="sm" /><span className="text-xs text-faint">then</span><Key k="←" size="sm" /><Key k="→" size="sm" /></span>}>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3.5 pb-3.5 pt-0.5">
        {rows.map((r) => (
          <div key={r.id} className={`grid gap-1.5 rounded-xl border border-transparent px-2.5 py-2 ${focused ? 'is-focus' : ''}`}>
            <div className="eyebrow">{r.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {r.opts.map((o, j) => (
                <button key={o} disabled={r.off?.includes(j)}
                  className={`rounded-lg border px-2.5 py-1 text-[13px] ${j === r.at ? 'border-ring bg-surface font-semibold text-ink shadow-[0_0_0_2px_color-mix(in_srgb,var(--c-ring)_22%,transparent)]' : 'border-line bg-raise text-sub'} disabled:cursor-default disabled:opacity-50`}>{o}</button>
              ))}
            </div>
            <div className="text-[12.5px] text-faint">
              {card.sessionId
                ? <>Waits on the card. A UserPromptSubmit hook adds it to the next thing you type in the tab <b>{card.key}</b>. No special flags. Pushing it in at once needs the channel, a preview flag, so that comes later.</>
                : <>The session hasn’t linked yet, so it goes in with the rest of the context when the session starts.</>}
            </div>
          </div>
        ))}
        <div className="grid gap-1.5 px-2.5 py-2">
          <div className="eyebrow">Good to know</div>
          <div className="text-[12.5px] text-faint">A repo added now reaches Claude as its path. The session may ask once before reading outside its folder. If you /clear the session, everything added here goes in again with the packet.</div>
        </div>
      </div>
      <div className="grid gap-2 border-t border-line px-4 py-3">
        {c.error && <div className="rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{c.error}</div>}
        <button className="btn btn-primary justify-center py-2 text-[15px]" disabled={c.starting} onClick={startWork}>
          <Key k="Ctrl Enter" size="sm" tone="ghost" />{c.starting ? 'Adding…' : `Add to ${card.key}`}
        </button>
        <span className="text-[12.5px] text-faint">Shows under Added since, on the card’s Context tab.</span>
      </div>
    </PaneBox>
  );
}
