import { listStep } from '../list-step.ts';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import type { FolderEntry, FolderListing } from '../../shared/protocol.ts';
import { samePath } from '../../shared/workspaces.ts';
import { filterEntries, looksLikePath, repoSummary, splitTyped } from '../folder-model.ts';
import { listFolder } from '../ws.ts';
import { DialogKeys } from './Overlay.tsx';
import { Icon, Key } from './ui.tsx';

interface Props {
  /** Called with the chosen folder. May reject: the message shows inside the picker. */
  onUse: (path: string) => void | Promise<void>;
  /** The button, e.g. "Use this folder", "Start here". */
  useLabel?: string;
  /** Open here instead of at the starting points (drives, home, suggestions). */
  start?: string;
  autoFocus?: boolean;
  onEscape: () => void;
  /** Tab leaves the picker for something else in the dialog (the folders list). */
  onTab?: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Tailwind max-height for the list. */
  listClass?: string;
}

/**
 * Walk the disk from the keyboard: ↑ ↓ choose, → or Enter opens, ← or Backspace goes up, Space
 * (or Ctrl+Enter) uses the folder you are in. Typing filters this folder; typing or pasting a
 * path jumps there. The server does the listing (browsers can't see real paths).
 */
export function FolderPicker({ onUse, useLabel = 'Use this folder', start, autoFocus = true, onEscape, onTab, inputRef, listClass = 'max-h-[40vh]' }: Props) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [index, setIndex] = useState(0);
  const [text, setText] = useState('');
  /** Set when a half-typed path showed its parent: the name to filter by. */
  const [partial, setPartial] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const ownInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownInput;
  const listRef = useRef<HTMLUListElement>(null);

  const typed = text.trim();
  const pathy = looksLikePath(typed);
  const shown = filterEntries(listing?.entries ?? [], pathy ? partial ?? '' : typed);
  const current = listing?.path ?? null;

  /** Show a folder (or the starting points); `focus` highlights the entry with that path. Null on failure. */
  async function load(path: string | undefined, opts: { focus?: string; quiet?: boolean; keepError?: boolean } = {}): Promise<FolderListing | null> {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const l = await listFolder(path);
      if (mine !== seq.current) return null;
      setListing(l);
      setIndex(Math.max(0, opts.focus ? l.entries.findIndex((e) => samePath(e.path, opts.focus!)) : 0));
      if (!opts.keepError) setError('');
      return l;
    } catch (e) {
      if (mine === seq.current && !opts.quiet) setError((e as Error).message);
      return null;
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }

  useEffect(() => {
    // A start that can't be opened still says why, over the starting points.
    void load(start).then((l) => { if (!l && start) void load(undefined, { keepError: true }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Typing a path jumps there as you type; a half-typed one shows its folder, filtered to the rest.
  useEffect(() => {
    if (!pathy) { setPartial(null); return; }
    const t = setTimeout(async () => {
      if (await load(typed, { quiet: true })) { setPartial(''); return; }
      const { dir, partial: name } = splitTyped(typed);
      if (dir && (await load(dir, { quiet: true }))) setPartial(name);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, pathy]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index, listing]);

  function clearText() { setText(''); setPartial(null); }

  async function open(entry: FolderEntry | undefined) {
    if (!entry) return;
    if (await load(entry.path)) clearText();
  }

  async function up() {
    if (!listing?.path) return; // already at the starting points
    await load(listing.parent ?? undefined, { focus: listing.path });
  }

  async function use(path: string | null) {
    if (!path) { setError('Open a folder first: → or Enter goes into the highlighted one.'); return; }
    setBusy(true);
    setError('');
    try {
      await onUse(path);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Enter on typed text: go to that exact path, else into the best match, else say what's wrong. */
  async function enterTyped() {
    if (pathy) {
      if (await load(typed, { quiet: true })) { clearText(); return; }
      if (partial !== null && shown[index]) { await open(shown[index]); return; }
      await load(typed); // not quiet: shows why
      return;
    }
    await open(shown[index]);
  }

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const empty = !text;
    const take = () => { e.preventDefault(); e.stopPropagation(); };
    switch (e.key) {
      case 'Escape': take(); if (text) clearText(); else onEscape(); return;
      case 'ArrowDown': take(); setIndex(Math.min(shown.length - 1, index + listStep(e))); return;
      case 'ArrowUp': take(); setIndex(Math.max(0, index - listStep(e))); return;
      case 'PageDown': take(); setIndex(Math.min(shown.length - 1, index + 8)); return;
      case 'PageUp': take(); setIndex(Math.max(0, index - 8)); return;
      case 'Enter':
        take();
        if (busy) return;
        if (e.ctrlKey || e.metaKey) {
          if (pathy) void load(typed).then((l) => { if (l?.path) { clearText(); void use(l.path); } });
          else void use(current);
        } else if (text) void enterTyped();
        else void open(shown[index]);
        return;
      case 'Tab':
        if (onTab && !e.shiftKey) { take(); onTab(); }
        return;
    }
    if (!empty) return; // the rest edit the text while there is some
    switch (e.key) {
      case 'Home': take(); setIndex(0); return;
      case 'End': take(); setIndex(Math.max(0, shown.length - 1)); return;
      case 'ArrowRight': take(); void open(shown[index]); return;
      case 'ArrowLeft': case 'Backspace': take(); void up(); return;
      case ' ': take(); if (!busy) void use(current); return;
    }
  };

  const summary = listing?.path ? repoSummary(listing) : '';
  return (
    <div className="space-y-2">
      <nav className="flex min-h-7 flex-wrap items-center gap-1 text-sm" aria-label="Where you are">
        <button className={`rounded-md px-1.5 py-0.5 hover:bg-raise ${current ? 'text-faint' : 'font-semibold'}`} onClick={() => void load(undefined, { focus: listing?.crumbs[0]?.path })}>
          Start
        </button>
        {listing?.crumbs.map((c, i) => (
          <span key={c.path} className="flex items-center gap-1">
            <span className="text-faint">›</span>
            <button
              className={`rounded-md px-1.5 py-0.5 font-mono hover:bg-raise ${i === listing.crumbs.length - 1 ? 'font-semibold text-ink' : 'text-faint'}`}
              onClick={() => void load(c.path, { focus: listing.crumbs[i + 1]?.path })}
            >
              {c.name}
            </button>
          </span>
        ))}
        {summary && <span className="ml-1 rounded-full bg-acc-soft px-2 text-xs font-semibold text-acc">{summary}</span>}
        {loading && <span className="spinner ml-1 text-faint" aria-label="Loading" />}
      </nav>
      <input
        ref={input}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="Type to filter, or paste a path like D:\repos"
        aria-label="Filter folders, or a folder path"
        spellCheck={false}
        className="field font-mono text-sm"
      />
      {error && <p className="flex items-start gap-1.5 text-sm text-bad" role="alert"><Icon name="warn" size={15} className="mt-0.5 shrink-0" />{error}</p>}
      <ul ref={listRef} className={`${listClass} space-y-0.5 overflow-y-auto`} role="listbox" aria-label="Folders">
        {shown.map((f, i) => {
          const note = repoSummary(f);
          return (
            <li
              key={f.path}
              data-i={i}
              role="option"
              aria-selected={i === index}
              // Move, not enter: a list redrawn under a resting pointer must not steal the keyboard's place.
              onMouseMove={() => { if (i !== index) setIndex(i); }}
              onClick={() => { setIndex(i); void open(f); input.current?.focus(); }}
              title={f.path}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-1.5 ${i === index ? 'is-focus bg-raise' : ''}`}
            >
              <Icon name={f.repo ? 'repo' : 'folder'} size={16} className={f.repos ? 'text-acc' : 'text-faint'} />
              <span className="min-w-0 truncate font-medium">{f.name}</span>
              {f.note && <span className="shrink-0 truncate text-xs text-faint">{f.note}</span>}
              {note && <span className={`ml-auto shrink-0 rounded-full px-2 text-xs ${f.repos ? 'bg-acc-soft font-semibold text-acc' : 'text-faint'}`}>{note}</span>}
              <Icon name="right" size={14} className={`shrink-0 text-faint ${note ? '' : 'ml-auto'}`} />
            </li>
          );
        })}
        {!loading && listing && shown.length === 0 && (
          <li className="px-2.5 py-2 text-sm text-sub">{typed && !pathy ? 'No folder here matches. Esc clears the filter.' : 'No folders in here.'}</li>
        )}
        {listing?.truncated && <li className="px-2.5 py-1 text-xs text-faint">Showing the first {listing.entries.length} folders. Type to filter.</li>}
      </ul>
      <div className="flex items-center gap-3 pt-1">
        <span className={`min-w-0 grow truncate text-sm text-sub ${current ? 'font-mono' : ''}`} title={current ?? ''}>{current ?? 'Open a drive or a folder to start from.'}</span>
        <button className="btn btn-primary shrink-0" disabled={!current || busy} onClick={() => void use(current)}>
          {busy ? 'Adding…' : useLabel}<Key k="Space" size="sm" tone="ghost" />
        </button>
      </div>
      <DialogKeys items={[['↑ ↓', 'choose'], ['→ Enter', 'open'], ['← ⌫', 'up'], ['Space', useLabel.toLowerCase()], ['Esc', text ? 'clear' : 'back']]} />
    </div>
  );
}
