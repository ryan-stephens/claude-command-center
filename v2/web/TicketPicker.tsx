import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { suggest } from '../shared/tickets.ts';
import type { TicketPick, TicketPicks } from '../shared/types.ts';
import { ago, get } from './api.ts';

/**
 * The ticket box with your tickets under it: the ones assigned to you and still workable, filtered
 * as you type, then what a Jira search finds. Pick one with a click, or the arrows and Enter.
 */
export function TicketPicker({ value, onChange, jira }: { value: string; onChange: (v: string) => void; jira: boolean }) {
  const [picks, setPicks] = useState<TicketPicks | null>(null);
  const [found, setFound] = useState<TicketPick[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(true);
  const [at, setAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const asked = useRef(0);

  const load = (fresh = false) => {
    setLoading(true);
    get<TicketPicks>(`/api/tickets${fresh ? '?fresh=1' : ''}`)
      .then(setPicks)
      .catch((e: Error) => setPicks({ mine: [], found: [], source: jira ? 'jira' : 'demo', problem: e.message }))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(), []);

  // A search of the rest of Jira, a moment after typing stops.
  useEffect(() => {
    const q = value.trim();
    const n = ++asked.current;
    if (q.length < 2 || !open) { setFound([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(() => {
      get<TicketPicks>(`/api/tickets?q=${encodeURIComponent(q)}`)
        .then((r) => { if (n === asked.current) { setFound(r.found); setPicks((p) => (p ? { ...p, mine: r.mine } : r)); } })
        .catch(() => { if (n === asked.current) setFound([]); })
        .finally(() => { if (n === asked.current) setSearching(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [value, open]);

  const items = suggest(picks?.mine ?? [], found, value);
  useEffect(() => { setAt(0); }, [value]);
  const shown = open && Boolean(picks);

  const pick = (p: TicketPick) => { onChange(p.key); setOpen(false); };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!shown) { if (e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && items[at]) { e.preventDefault(); pick(items[at]); }
  };

  const mineCount = picks?.mine.length ?? 0;
  const firstFound = items.findIndex((p) => !p.mine);

  return (
    <>
      <input id="lp-ticket" type="text" className="ticket-input" value={value} autoFocus autoComplete="off"
        role="combobox" aria-expanded={shown} aria-controls="lp-picks" aria-activedescendant={shown && items[at] ? `lp-pick-${items[at].key}` : undefined}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKey}
        placeholder="Key or search" />
      {!shown && !value.trim() && picks && (
        <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(true)}>Show your tickets ({mineCount})</button>
      )}
      {shown && (
        <div className="picks" id="lp-picks" role="listbox" aria-label="Tickets">
          <div className="picks-head">
            <span className="cap">Assigned to you{picks!.source === 'demo' ? ' (demo tickets)' : ''} · {mineCount}</span>
            <button type="button" className="btn small" aria-label="Refresh your tickets" title="Ask Jira again" disabled={loading}
              onMouseDown={(e) => e.preventDefault()} onClick={() => load(true)}>{loading ? '…' : '↻'}</button>
          </div>
          {items.map((p, i) => (
            <div key={p.key}>
              {i === firstFound && <div className="cap picks-sep">Elsewhere in Jira</div>}
              <div id={`lp-pick-${p.key}`} role="option" aria-selected={i === at} className={`pick-row${i === at ? ' on' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setAt(i)} onClick={() => pick(p)}>
                <span className="mono">{p.key}</span>
                <span className="pick-title">{p.title}</span>
                <span className="chip">{p.status}</span>
                <span className="mu" style={{ fontSize: 12 }}>{ago(p.updatedAt)}</span>
              </div>
            </div>
          ))}
          {!items.length && <div className="mu" style={{ fontSize: 14, padding: '6px 10px' }}>{searching ? 'Searching Jira…' : value.trim() ? 'No ticket matches. Launch it as a plain session, or try other words.' : 'Nothing assigned to you that is still open.'}</div>}
          {items.length > 0 && searching && <div className="mu" style={{ fontSize: 13, padding: '4px 10px' }}>Searching the rest of Jira…</div>}
          {picks!.problem && <div className="err" style={{ margin: 6 }}>{picks!.problem}</div>}
        </div>
      )}
    </>
  );
}
