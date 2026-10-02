// Shift+D on a card: what it changed, as git sees it, in every repo it works in, without leaving for
// an editor. Files on the left under a header per repo (the card's own first in each; ↑ ↓ or j k
// move across all of them), the chosen file's diff on the right. s ships from here.

import { useEffect, useState } from 'react';
import { againstText, changeRows, changeTotals, patchLines, type Changes } from '../../shared/changes.ts';
import { shipKey } from '../line-keys.ts';
import { useStore } from '../store.ts';
import { cardChanges } from '../ws.ts';
import { close, DialogKeys, DialogTitle, Overlay, useDialogKeys } from './Overlay.tsx';
import { Key, TicketKey } from './ui.tsx';

const KIND: Record<string, string> = { added: 'added', modified: 'changed', deleted: 'deleted', renamed: 'renamed', new: 'new' };

/** `at`: the file to open on (the panel's choice, when popped out from the open card). */
export function ChangesSheet({ id, at: start = 0 }: { id: string; at?: number }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id));
  const [changes, setChanges] = useState<Changes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(start);

  useEffect(() => { cardChanges(id).then(setChanges, (e: Error) => setError(e.message)); }, [id]);

  const rows = changes ? changeRows(changes) : [];
  const files = rows.filter((r) => r.kind === 'file');
  const chosen = files[Math.min(at, files.length - 1)];
  const file = chosen?.kind === 'file' ? chosen.file : undefined;
  useEffect(() => { document.getElementById(`chg-${at}`)?.scrollIntoView({ block: 'nearest' }); }, [at]);

  useDialogKeys((e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown' || e.key === 'j') setAt((i) => Math.min(files.length - 1, i + 1));
    else if (e.key === 'ArrowUp' || e.key === 'k') setAt((i) => Math.max(0, i - 1));
    else if (e.key === 's' && card) { close(); shipKey(card.id); }
    else return false;
    return true;
  });

  if (!card) return null;
  const totals = changes ? changeTotals(changes) : null;
  const several = (changes?.repos.length ?? 0) > 1;
  const one = changes?.repos[0];
  return (
    <Overlay label="Changes" wide="full">
      <DialogTitle><span className="flex min-w-0 items-center gap-2">Changes · <TicketKey k={card.key} source={card.ticket?.source} /><span className="truncate">{card.title}</span></span></DialogTitle>
      {error && <div className="rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{error}</div>}
      {!changes && !error && <p className="flex items-center gap-2 text-sm text-faint"><span className="spinner" />Asking git…</p>}
      {changes && totals && (
        <>
          <p className="mb-3 text-[13px] text-sub">
            {totals.files ? <><b>{totals.files}</b> file{totals.files === 1 ? '' : 's'} · <span className="text-ok">+{totals.added}</span> <span className="text-bad">−{totals.removed}</span></> : 'No changes'}
            {several
              ? <> · in <b>{changes.repos.length}</b> repos: {changes.repos.map((r) => <span key={r.root}>{r.repo}{r.files.length ? '' : ' (nothing)'}</span>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ', ', el] : [el]), [])}</>
              : one ? <> · {againstText(one).split(/(\S+ against \S+|on \S+)$/).map((part, i) => (i === 1 ? <span key={i} className="font-mono">{part}</span> : part))}</> : null}
            {totals.truncated && <span className="text-attn"> · the diff was cut: it is very large</span>}
          </p>
          {totals.files > 0 && (
            <div className="grid h-[calc(100vh-15rem)] min-h-[40vh] grid-cols-[minmax(240px,340px)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-3">
              <ul className="min-h-0 overflow-y-auto rounded-xl border border-line" role="listbox" aria-label="Changed files">
                {rows.map((r) => r.kind === 'repo'
                  ? (
                    <li key={`repo-${r.repo.root}`} className="sticky top-0 border-b border-line/60 bg-raise px-2.5 py-1.5 text-[11.5px] [li+&]:border-t">
                      <span className="font-semibold">{r.repo.repo}</span> <span className="text-faint">· {r.repo.files.length ? againstText(r.repo) : 'nothing changed here'}</span>
                    </li>
                  )
                  : (
                    <li key={`${r.repo.root}:${r.file.path}`} id={`chg-${r.index}`} role="option" aria-selected={r.index === at} onClick={() => setAt(r.index)}
                      className={`flex cursor-pointer items-center gap-2 border-l-[3px] py-2 pl-2 pr-2.5 text-[12.5px] [li+&]:border-t [li+&]:border-line/60 ${r.index === at ? 'border-l-acc bg-acc-soft font-semibold' : 'border-l-transparent hover:bg-raise/60'}`}>
                      <span className={`w-12 shrink-0 text-[10.5px] font-bold uppercase ${r.file.kind === 'deleted' ? 'text-bad' : r.file.kind === 'modified' ? 'text-faint' : 'text-ok'}`}>{KIND[r.file.kind]}</span>
                      <span className="min-w-0 grow truncate font-mono" title={`${several ? `${r.repo.repo}/` : ''}${r.file.path}`}>{r.file.path}</span>
                      {r.file.mine && <span className="shrink-0 rounded-full bg-ok-bg px-1.5 text-[10.5px] font-semibold text-ok" title="Written by this card’s session">card</span>}
                      <span className="shrink-0 font-mono text-[11px] tabular-nums"><span className="text-ok">+{r.file.added}</span> <span className="text-bad">−{r.file.removed}</span></span>
                    </li>
                  ))}
              </ul>
              <div className="min-h-0 overflow-auto rounded-xl border border-line bg-bg">
                {several && chosen?.kind === 'file' && <div className="sticky top-0 border-b border-line/60 bg-raise px-3 py-1 font-mono text-[11.5px] text-sub">{chosen.repo.repo}/{chosen.file.path}</div>}
                {file?.binary
                  ? <p className="px-3 py-2 text-sm text-faint">A binary file: nothing to show.</p>
                  : <pre className="m-0 px-0 py-1 font-mono text-[12.5px] leading-[1.5]">
                    {patchLines(file?.patch ?? '').map((l, i) => (
                      <div key={i} className={`whitespace-pre px-3 ${l.kind === 'add' ? 'bg-ok-bg text-ok' : l.kind === 'del' ? 'bg-bad-bg text-bad' : l.kind === 'hunk' ? 'bg-raise text-busy' : l.kind === 'meta' ? 'text-faint' : 'text-sub'}`}>{l.text || ' '}</div>
                    ))}
                  </pre>}
              </div>
            </div>
          )}
        </>
      )}
      <div className="mt-4 flex items-center gap-3">
        <span className="grow text-[13px] text-faint">Committed or not, tracked or new: everything different from where each branch left its base{several ? ', in every repo the card works in' : ''}. The card’s own files come first.</span>
        <button className="btn" onClick={close}>Close<Key k="Esc" size="sm" /></button>
        {card.stage !== 'done' && card.cwd && <button className="btn btn-primary" onClick={() => { close(); shipKey(card.id); }}>Ship<Key k="s" size="sm" tone="ghost" /></button>}
      </div>
      <DialogKeys items={[['↑ ↓', 'file'], ['s', 'ship'], ['Esc', 'close']]} />
    </Overlay>
  );
}
