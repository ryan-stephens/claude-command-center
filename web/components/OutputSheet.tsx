// f in the Try it panel (PLAN §84): a service's output full width, as it prints, without opening a
// terminal. One tab per run of the card (j k switch), a filter (/), wrap (w), and the service's own
// Stop, Again and Open from here. Esc closes it; the panel keeps following the same run.

import { useEffect, useRef, useState } from 'react';
import { runKey, runsOf, wsRecipeKey, type CardRun } from '../../shared/recipes.ts';
import { repoName } from '../../shared/workspaces.ts';
import { openApp, stopService, tryService } from '../line-keys.ts';
import { useStore } from '../store.ts';
import { close, DialogKeys, DialogTitle, Overlay, useDialogKeys } from './Overlay.tsx';
import { RunLog } from './RunLog.tsx';
import { Key, TicketKey } from './ui.tsx';

/** What a run is called on its tab: its service (the UI by its repo's name), or the card's own recipe by its repo. */
export function runName(run: CardRun, uiRepo?: string): string {
  if (!run.service) return repoName(run.repo) || 'its app';
  return run.service === 'ui' ? (uiRepo ?? 'UI') : run.service;
}

const DOT: Record<CardRun['state'], string> = { running: 'bg-busy', up: 'bg-ok', done: 'bg-faint', failed: 'bg-bad', stopped: 'bg-faint' };

export function OutputSheet({ id, service }: { id: string; service?: string }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id));
  const runs = useStore((s) => s.runs);
  const uiRepo = useStore((s) => { const c = s.cards.find((x) => x.id === id); const r = c?.workspaceId ? s.recipes[wsRecipeKey(c.workspaceId)] : undefined; return r?.stack?.ui?.repo; });
  // The tabs in the panel's order: the APIs, then the UI (runsOf puts the UI first for the tile).
  const mine = card ? runsOf(runs, card.id).sort((a, b) => Number(a.service === 'ui') - Number(b.service === 'ui')) : [];
  const [at, setAt] = useState(() => Math.max(0, mine.findIndex((r) => (r.service ?? undefined) === service)));
  const [filter, setFilter] = useState('');
  const [wrap, setWrap] = useState(true);
  const [jump, setJump] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const run = mine[Math.min(at, Math.max(0, mine.length - 1))];
  const key = card ? runKey(card.id, run?.service) : '';
  // The run the panel had goes first when the sheet opens; a run that starts later joins the tabs.
  useEffect(() => { if (at >= mine.length) setAt(Math.max(0, mine.length - 1)); }, [mine.length]);

  useDialogKeys((e) => {
    const typing = document.activeElement === search.current;
    if (e.key === 'Escape') { if (typing) search.current?.blur(); else close(); return true; }
    if (typing) return false;
    if (e.key === '/') { search.current?.focus(); return true; }
    if (e.key === 'j' || e.key === 'ArrowDown') { setAt((i) => Math.min(mine.length - 1, i + 1)); return true; }
    if (e.key === 'k' || e.key === 'ArrowUp') { setAt((i) => Math.max(0, i - 1)); return true; }
    if (e.key === 'w') { setWrap((v) => !v); return true; }
    if (e.key === 'End') { setJump((n) => n + 1); return true; }
    if (!card || !run) return false;
    const sv = run.service;
    if (e.key === 'q' && sv) { stopService(card.id, sv); return true; }
    if (e.key === 'r' && sv) { tryService(card.id, sv); return true; }
    if (e.key === 'o') { openApp(card.id); return true; }
    return false;
  });

  if (!card) return null;
  const on = run?.state === 'running' || run?.state === 'up';
  return (
    <Overlay label="Output" wide="full">
      <DialogTitle><span className="flex min-w-0 items-center gap-2">Output · <TicketKey k={card.key} source={card.ticket?.source} /><span className="truncate">{card.title}</span></span></DialogTitle>
      {mine.length === 0
        ? <p className="text-sm text-faint">Nothing has run for this card yet. Start its services in the Try it panel and their output shows here.</p>
        : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Runs">
                {mine.map((r, i) => (
                  <button key={runKey(r.cardId, r.service)} role="tab" aria-selected={i === at} onClick={() => setAt(i)} title={r.text}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-1 font-mono text-[12.5px] ${i === at ? 'border-ring bg-surface font-semibold text-ink' : 'border-line bg-raise text-sub hover:text-ink'}`}>
                    <span className={`h-2 w-2 rounded-full ${DOT[r.state]}`} />{runName(r, uiRepo)}
                  </button>
                ))}
              </div>
              <span className="grow" />
              {run && <span className="truncate text-[12.5px] text-faint" title={run.text}>{run.text}</span>}
              <label className="flex items-center gap-1.5 text-[12.5px] text-faint">
                <Key k="/" size="sm" />
                <input ref={search} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Only lines saying…" aria-label="Filter the output"
                  className="w-44 rounded-md border border-line bg-surface px-2 py-0.5 text-[12.5px] text-ink placeholder:text-faint" />
              </label>
              <button className={`btn py-0.5 text-[12.5px] ${wrap ? '' : 'text-faint'}`} onClick={() => setWrap((v) => !v)} aria-pressed={wrap} title="Fold long lines, or let them run off to the right"><Key k="w" size="sm" />Wrap</button>
              {run?.service && (on
                ? <button className="btn py-0.5 text-[12.5px]" onClick={() => stopService(card.id, run.service!)} title="Stop this one; the others keep running"><Key k="q" size="sm" />Stop</button>
                : <button className="btn py-0.5 text-[12.5px]" onClick={() => tryService(card.id, run.service!)} title="Start it again on its own"><Key k="r" size="sm" />Again</button>)}
              {run?.service && on && <button className="btn py-0.5 text-[12.5px]" onClick={() => tryService(card.id, run.service!)} title="Stop it and start it again"><Key k="r" size="sm" />Again</button>}
              {run?.state === 'up' && run.url && <button className="btn py-0.5 text-[12.5px]" onClick={() => openApp(card.id)}><Key k="o" size="sm" />Open</button>}
            </div>
            <RunLog runKey={key} run={run} filter={filter} wrap={wrap} jump={jump} className="h-[calc(100vh-15rem)] min-h-[40vh]" />
          </>
        )}
      <div className="mt-4 flex items-center gap-3">
        <span className="grow text-[13px] text-faint">Everything the run printed, oldest first; a step's start is marked. It follows the newest line until you scroll up.</span>
        <button className="btn" onClick={close}>Close<Key k="Esc" size="sm" /></button>
      </div>
      <DialogKeys items={[['j k', 'run'], ['/', 'filter'], ['w', 'wrap'], ['End', 'newest'], ['q', 'stop'], ['r', 'again'], ['Esc', 'close']]} />
    </Overlay>
  );
}
