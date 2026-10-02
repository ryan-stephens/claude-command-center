// Saved opening prompts (PLAN §62), from the new-card screen (Shift+E, or "Save as a prompt"):
// the list (↑ ↓, n new, e or Enter edit, Delete twice removes, Esc), and the editor (name, kind,
// body, with the placeholders and a live example rendered from the card beside it; Ctrl+Enter
// saves, Esc back). The prompts live on the server; saving sends them there.

import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CARD_KINDS, kindName, type CardKind } from '../../shared/cards.ts';
import { PLACEHOLDERS, placeholdersIn, renderPrompt, type SavedPrompt } from '../../shared/prompts.ts';
import { composerKey } from '../line-model.ts';
import { promptContext } from '../simple-model.ts';
import { flash, useStore } from '../store.ts';
import { send } from '../ws.ts';
import { close, DialogKeys, DialogTitle, Overlay, useDialogKeys } from './Overlay.tsx';
import { Key } from './ui.tsx';

interface Draft { id?: string; name: string; kind: CardKind | ''; body: string }

// The controls sit inside eyebrow labels (bold, spaced, uppercase): they take their own weight and spacing back, or the whole editor reads bold.
const fieldClass = 'field mt-1 py-1.5 text-sm font-normal normal-case tracking-normal text-ink';
const labelClass = 'eyebrow block';

export function PromptsDialog({ draft }: { draft?: { body: string } }) {
  const prompts = useStore((s) => s.prompts);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState<Draft | null>(draft ? { name: '', kind: '', body: draft.body } : null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const at = Math.min(index, Math.max(0, prompts.length - 1));
  const current = prompts[at];

  const startEdit = (p?: SavedPrompt) => setEditing(p ? { id: p.id, name: p.name, kind: p.kind ?? '', body: p.body } : { name: '', kind: '', body: '' });
  const remove = (p: SavedPrompt) => {
    if (confirm !== p.id) { setConfirm(p.id); return; }
    send({ type: 'prompt.delete', id: p.id });
    setConfirm(null);
    flash(`Deleted the prompt ${p.name}`);
  };

  useDialogKeys((e) => {
    if (editing) return false;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return false;
    switch (e.key) {
      case 'ArrowDown': setIndex(Math.min(prompts.length - 1, at + 1)); setConfirm(null); return true;
      case 'ArrowUp': setIndex(Math.max(0, at - 1)); setConfirm(null); return true;
      case 'n': startEdit(); return true;
      case 'e': case 'Enter': if (current) startEdit(current); return true;
      case 'Delete': case 'Backspace': if (current) remove(current); return true;
      case 'Escape': close(); return true;
    }
    return false;
  });

  if (editing) return <PromptEditor draft={editing} onDone={() => { if (draft && !editing.id) close(); else setEditing(null); }} />;
  return (
    <Overlay label="Saved prompts" wide>
      <DialogTitle>Saved prompts</DialogTitle>
      <p className="mb-3 text-sm text-sub">The opening message of a new card can start from one of these. Its <span className="font-mono">{'{{placeholders}}'}</span> are filled from the card: the ticket, the repos, folders, lane, branch and kind. A prompt with a kind is offered first for that kind of card.</p>
      {prompts.length ? (
        <ul className="space-y-1" role="listbox" aria-label="Prompts">
          {prompts.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === at} onClick={() => { setIndex(i); setConfirm(null); }} onDoubleClick={() => startEdit(p)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 ${i === at ? 'is-focus bg-raise' : 'hover:bg-raise'}`}>
              <span className="min-w-0 grow">
                <span className="flex items-center gap-2"><span className="font-medium">{p.name}</span><span className="text-xs text-faint">{p.kind ? kindName(p.kind) : 'any kind'}</span></span>
                <span className="block truncate text-[13px] text-sub">{p.body.split('\n')[0]}</span>
              </span>
              {confirm === p.id
                ? <span className="shrink-0 text-xs text-bad">Delete again to remove it</span>
                : <span className="shrink-0 text-xs text-faint">{placeholdersIn(p.body).map((n) => `{{${n}}}`).join(' ') || 'no placeholders'}</span>}
            </li>
          ))}
        </ul>
      ) : <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-faint">No prompts yet. <Key k="n" size="sm" inline /> writes one.</p>}
      <div className="mt-5 flex items-center gap-3">
        <DialogKeys items={[['↑ ↓', 'choose'], ['n', 'new'], ['e', 'edit'], ['Delete', 'remove'], ['Esc', 'close']]} />
        <button className="btn ml-auto" onClick={() => startEdit()}>New prompt<Key k="n" size="sm" /></button>
        {current && <button className="btn btn-primary" onClick={() => startEdit(current)}>Edit<Key k="e" size="sm" tone="ghost" /></button>}
      </div>
    </Overlay>
  );
}

function PromptEditor({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const [name, setName] = useState(draft.name);
  const [kind, setKind] = useState<CardKind | ''>(draft.kind);
  const [body, setBody] = useState(draft.body);
  const [error, setError] = useState('');
  const composer = useStore((s) => s.composer);
  const workspaces = useStore((s) => s.workspaces);
  const nextKey = useStore((s) => s.nextKey);
  const library = useStore((s) => s.library.repos);
  const ctx = composer ? promptContext(composer, workspaces, composerKey(composer, nextKey), library) : {};
  const example = renderPrompt(body, ctx);
  const used = placeholdersIn(body);

  function save() {
    if (!name.trim() || !body.trim()) { setError('A prompt needs a name and a body.'); return; }
    const prompt: SavedPrompt = { id: draft.id ?? crypto.randomUUID(), name: name.trim(), body, ...(kind ? { kind } : {}), updatedAt: Date.now() };
    send({ type: 'prompt.save', prompt });
    flash(`Saved the prompt ${prompt.name}`);
    onDone();
  }

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onDone(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
  };

  return (
    <Overlay label={draft.id ? 'Edit prompt' : 'New prompt'} wide="xl">
      <div onKeyDown={onKey}>
        <DialogTitle>{draft.id ? 'Edit prompt' : 'New prompt'}</DialogTitle>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div>
            <div className="grid grid-cols-[1fr_12rem] gap-3">
              <label className={labelClass}>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} placeholder="Review and plan" /></label>
              <label className={labelClass}>Offered first for
                <select value={kind} onChange={(e) => setKind(e.target.value as CardKind | '')} className={fieldClass}>
                  <option value="">any kind of card</option>
                  {CARD_KINDS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
              </label>
            </div>
            <label className={`${labelClass} mt-3`}>
              The prompt <span className="normal-case tracking-normal">· {'{{name}}'} for each blank; a line whose blanks are all empty is left out</span>
              {/* Prose, so the text face, not mono: light mono text on a dark ground reads as bold (§74). */}
              <textarea value={body} rows={12} onChange={(e) => setBody(e.target.value)} className={`${fieldClass} resize-none text-[14px] leading-relaxed`} spellCheck={false} />
            </label>
            {error && <p className="mt-2 text-sm text-bad" role="alert">{error}</p>}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <div>
              <div className="eyebrow mb-1.5">Placeholders</div>
              <ul className="space-y-1 text-[13px]">
                {PLACEHOLDERS.map((p) => (
                  <li key={p.name} className="flex items-baseline gap-2">
                    <button type="button" className={`shrink-0 rounded border px-1 font-mono text-[12px] ${used.includes(p.name) ? 'border-acc bg-raise text-acc' : 'border-line text-sub hover:border-ring'}`}
                      onClick={() => setBody((b) => `${b}${b && !/\s$/.test(b) ? ' ' : ''}{{${p.name}}}`)} title="Put it at the end of the prompt">{`{{${p.name}}}`}</button>
                    <span className="text-sub">{p.what}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0">
              <div className="eyebrow mb-1.5">Example, from {composer ? 'this card' : 'an empty card'}</div>
              <pre className="m-0 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-raise/60 px-3 py-2 font-sans text-[13px] font-normal leading-relaxed text-sub">{example.text || <span className="text-faint">Nothing yet.</span>}</pre>
              {example.missing.length > 0 && <p className="mt-1.5 text-xs text-faint">This card has nothing for {example.missing.map((n) => `{{${n}}}`).join(', ')}: those render to nothing.</p>}
              {example.unknown.length > 0 && <p className="mt-1.5 text-xs text-attn">Not a placeholder: {example.unknown.map((n) => `{{${n}}}`).join(', ')}.</p>}
            </div>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <DialogKeys items={[['Ctrl Enter', 'save'], ['Esc', 'back']]} />
          <button className="btn ml-auto" onClick={onDone}>Back<Key k="Esc" size="sm" /></button>
          <button className="btn btn-primary" onClick={save}>Save<Key k="Ctrl Enter" size="sm" tone="ghost" /></button>
        </div>
      </div>
    </Overlay>
  );
}
