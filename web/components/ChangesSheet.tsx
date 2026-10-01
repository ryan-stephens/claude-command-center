// D on a card: what it changed, as git sees it, without leaving for an editor. Files on the left
// (the card's own first; ↑ ↓ or j k move), the chosen file's diff on the right. s ships from here.

import { useEffect, useState } from 'react';
import { patchLines, type Changes } from '../../shared/changes.ts';
import { shipKey } from '../line-keys.ts';
import { useStore } from '../store.ts';
import { cardChanges } from '../ws.ts';
import { close, DialogKeys, DialogTitle, Overlay, useDialogKeys } from './Overlay.tsx';
import { Key, TicketKey } from './ui.tsx';

const KIND: Record<string, string> = { added: 'added', modified: 'changed', deleted: 'deleted', renamed: 'renamed', new: 'new' };

export function ChangesSheet({ id }: { id: string }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id));
  const [changes, setChanges] = useState<Changes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);

  useEffect(() => { cardChanges(id).then(setChanges, (e: Error) => setError(e.message)); }, [id]);

  const files = changes?.files ?? [];
  const file = files[Math.min(at, files.length - 1)];
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
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  return (
    <Overlay label="Changes" wide="xl">
      <DialogTitle><span className="flex min-w-0 items-center gap-2">Changes · <TicketKey k={card.key} source={card.ticket?.source} /><span className="truncate">{card.title}</span></span></DialogTitle>
      {error && <div className="rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{error}</div>}
      {!changes && !error && <p className="flex items-center gap-2 text-sm text-faint"><span className="spinner" />Asking git…</p>}
      {changes && (
        <>
          <p className="mb-3 text-[13px] text-sub">
            {files.length ? <><b>{files.length}</b> file{files.length === 1 ? '' : 's'} · <span className="text-ok">+{added}</span> <span className="text-bad">−{removed}</span></> : 'No changes'}
            {changes.branch && changes.branch !== changes.base ? <> · <span className="font-mono">{changes.branch}</span> against <span className="font-mono">{changes.base}</span>{changes.committed ? `, ${changes.committed} commit${changes.committed === 1 ? '' : 's'} already on the branch` : ''}</> : <> · uncommitted, on <span className="font-mono">{changes.branch || 'HEAD'}</span></>}
            {changes.truncated && <span className="text-attn"> · the diff was cut: it is very large</span>}
          </p>
          {files.length > 0 && (
            <div className="grid max-h-[62vh] min-h-[40vh] grid-cols-[minmax(220px,300px)_minmax(0,1fr)] gap-3">
              <ul className="overflow-y-auto rounded-xl border border-line" role="listbox" aria-label="Changed files">
                {files.map((f, i) => (
                  <li key={f.path} id={`chg-${i}`} role="option" aria-selected={i === at} onClick={() => setAt(i)}
                    className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12.5px] [&+&]:border-t [&+&]:border-line/60 ${i === at ? 'is-focus bg-raise' : 'hover:bg-raise/60'}`}>
                    <span className={`w-12 shrink-0 text-[10.5px] font-bold uppercase ${f.kind === 'deleted' ? 'text-bad' : f.kind === 'modified' ? 'text-faint' : 'text-ok'}`}>{KIND[f.kind]}</span>
                    <span className="min-w-0 grow truncate font-mono" title={f.path}>{f.path}</span>
                    {f.mine && <span className="shrink-0 rounded-full bg-ok-bg px-1.5 text-[10.5px] font-semibold text-ok" title="Written by this card’s session">card</span>}
                    <span className="shrink-0 font-mono text-[11px] tabular-nums"><span className="text-ok">+{f.added}</span> <span className="text-bad">−{f.removed}</span></span>
                  </li>
                ))}
              </ul>
              <div className="overflow-auto rounded-xl border border-line bg-bg">
                {file?.binary
                  ? <p className="px-3 py-2 text-sm text-faint">A binary file: nothing to show.</p>
                  : <pre className="m-0 px-0 py-1 font-mono text-[12px] leading-[1.45]">
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
        <span className="grow text-[13px] text-faint">Committed or not, tracked or new: everything different from where the branch left {changes?.base ?? 'the base'}. The card’s own files come first.</span>
        <button className="btn" onClick={close}>Close<Key k="Esc" size="sm" /></button>
        {card.stage !== 'done' && card.cwd && <button className="btn btn-primary" onClick={() => { close(); shipKey(card.id); }}>Ship<Key k="s" size="sm" tone="ghost" /></button>}
      </div>
      <DialogKeys items={[['↑ ↓', 'file'], ['s', 'ship'], ['Esc', 'close']]} />
    </Overlay>
  );
}
