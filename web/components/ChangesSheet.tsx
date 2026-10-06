// Shift+D on a card: what it changed, as git sees it, in every repo it works in, without leaving for
// an editor. Files on the left under a header per repo (the card's own first in each; ↑ ↓ or j k
// move across all of them), the chosen file's diff on the right. A repo's header folds its files
// (a click, z for the chosen file's repo, Z for all, §101). s ships from here.

import { useEffect, useState } from 'react';
import { againstText, changeRows, changeTotals, patchLines, type ChangeRow, type Changes } from '../../shared/changes.ts';
import { shipKey } from '../line-keys.ts';
import { useStore } from '../store.ts';
import { cardChanges } from '../ws.ts';
import { close, DialogKeys, DialogTitle, Overlay, useDialogKeys } from './Overlay.tsx';
import { Icon, Key, TicketKey } from './ui.tsx';

const KIND: Record<string, string> = { added: 'added', modified: 'changed', deleted: 'deleted', renamed: 'renamed', new: 'new' };

/** `at`: the file to open on (the panel's choice, when popped out from the open card). */
export function ChangesSheet({ id, at: start = 0 }: { id: string; at?: number }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id));
  const [changes, setChanges] = useState<Changes | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `at`: the chosen file's index in the full list (it survives folding); folded repos, by root.
  const [at, setAt] = useState(start);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => { cardChanges(id).then(setChanges, (e: Error) => setError(e.message)); }, [id]);

  const rows = changes ? changeRows(changes) : [];
  const files = rows.filter((r): r is Extract<ChangeRow, { kind: 'file' }> => r.kind === 'file');
  // What j / k walk: the files of the repos that are open.
  const shown = files.filter((r) => !folded.has(r.repo.root));
  const chosen = files.find((r) => r.index === at) ?? files[0];
  const file = chosen?.file;
  useEffect(() => { document.getElementById(`chg-${at}`)?.scrollIntoView({ block: 'nearest' }); }, [at]);

  /** Fold or unfold these repos; the chosen file, if its repo folds, gives way to the nearest file still shown. */
  const fold = (next: ReadonlySet<string>) => {
    setFolded(next);
    if (chosen && next.has(chosen.repo.root)) {
      const open = files.filter((r) => !next.has(r.repo.root));
      const after = open.find((r) => r.index > chosen.index) ?? open.at(-1);
      if (after) setAt(after.index);
    }
  };
  const toggle = (root: string) => { const next = new Set(folded); if (next.has(root)) next.delete(root); else next.add(root); fold(next); };
  const step = (d: number) => {
    const pos = shown.findIndex((r) => r.index === at);
    const target = shown[pos < 0 ? 0 : Math.max(0, Math.min(shown.length - 1, pos + d))];
    if (target) setAt(target.index);
  };

  useDialogKeys((e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown' || e.key === 'j') step(1);
    else if (e.key === 'ArrowUp' || e.key === 'k') step(-1);
    else if (e.key === 'z' && chosen) toggle(chosen.repo.root);
    // Z: unfold everything when any repo is folded (the way back after z), else fold every repo.
    else if (e.key === 'Z' && changes) fold(folded.size ? new Set() : new Set(changes.repos.map((r) => r.root)));
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
                {rows.map((r) => {
                  if (r.kind === 'repo') {
                    // The repo is the parent of the files under it: a header of its own, which folds them (§101).
                    const isFolded = folded.has(r.repo.root);
                    const added = r.repo.files.reduce((n, x) => n + x.added, 0);
                    const removed = r.repo.files.reduce((n, x) => n + x.removed, 0);
                    return (
                      <li key={`repo-${r.repo.root}`} className="sticky top-0 z-10 border-b border-line bg-raise [li+&]:border-t">
                        <button onClick={() => toggle(r.repo.root)} aria-expanded={!isFolded} title={`${isFolded ? 'Unfold' : 'Fold'} ${r.repo.repo}’s files (z on its file, Z for every repo)\n${r.repo.files.length ? againstText(r.repo) : 'nothing changed here'}`}
                          className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-line/40">
                          <span className="w-3 shrink-0 text-center text-[12px] text-sub" aria-hidden>{isFolded ? '▸' : '▾'}</span>
                          <Icon name="folder" size={15} className="shrink-0 text-sub" />
                          <span className="min-w-0 truncate text-[13.5px] font-bold">{r.repo.repo}</span>
                          <span className="shrink-0 rounded-full bg-surface px-1.5 text-[11px] font-semibold text-sub">{r.repo.files.length} file{r.repo.files.length === 1 ? '' : 's'}</span>
                          <span className="grow" />
                          {r.repo.files.length > 0 && <span className="shrink-0 font-mono text-[11px] tabular-nums"><span className="text-ok">+{added}</span> <span className="text-bad">−{removed}</span></span>}
                        </button>
                        {!isFolded && <div className="truncate px-2.5 pb-1.5 pl-[42px] text-[11.5px] text-faint">{r.repo.files.length ? againstText(r.repo) : 'nothing changed here'}</div>}
                      </li>
                    );
                  }
                  if (folded.has(r.repo.root)) return null;
                  return (
                    <li key={`${r.repo.root}:${r.file.path}`} id={`chg-${r.index}`} role="option" aria-selected={r.index === at} onClick={() => setAt(r.index)}
                      className={`flex cursor-pointer items-center gap-2 border-l-[3px] py-2 pl-7 pr-2.5 text-[12.5px] [li+&]:border-t [li+&]:border-line/60 ${r.index === at ? 'border-l-acc bg-acc-soft font-semibold' : 'border-l-transparent hover:bg-raise/60'}`}>
                      <span className={`w-14 shrink-0 text-[10.5px] font-bold uppercase ${r.file.kind === 'deleted' ? 'text-bad' : r.file.kind === 'modified' ? 'text-faint' : 'text-ok'}`}>{KIND[r.file.kind]}</span>
                      <span className="min-w-0 grow truncate font-mono" title={`${several ? `${r.repo.repo}/` : ''}${r.file.path}`}>{r.file.path}</span>
                      {r.file.mine && <span className="shrink-0 rounded-full bg-ok-bg px-1.5 text-[10.5px] font-semibold text-ok" title="Written by this card’s session">card</span>}
                      <span className="shrink-0 font-mono text-[11px] tabular-nums"><span className="text-ok">+{r.file.added}</span> <span className="text-bad">−{r.file.removed}</span></span>
                    </li>
                  );
                })}
              </ul>
              <div className="min-h-0 overflow-auto rounded-xl border border-line bg-bg">
                {several && chosen && <div className="sticky top-0 border-b border-line/60 bg-raise px-3 py-1 font-mono text-[11.5px] text-sub">{chosen.repo.repo}/{chosen.file.path}</div>}
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
      <DialogKeys items={[['↑ ↓', 'file'], ...(several ? [['z', 'fold its repo'], ['Z', 'fold all']] as [string, string][] : []), ['s', 'ship'], ['Esc', 'close']]} />
    </Overlay>
  );
}
