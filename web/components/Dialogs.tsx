import { useEffect, useRef, useState } from 'react';
import { KEYMAP, openSession } from '../keys.ts';
import { get, sessionById, set, useStore } from '../store.ts';
import { createSession, send } from '../ws.ts';
import { DeleteDialog, EditDialog, TemplateDialog } from './CommandDialogs.tsx';
import { close, Overlay } from './Overlay.tsx';

export function Dialogs() {
  const modal = useStore((s) => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case 'help': return <HelpOverlay />;
    case 'new': return <NewSessionDialog />;
    case 'rename': return <RenameDialog id={modal.id} />;
    case 'stop': return <StopDialog id={modal.id} />;
    case 'template': return <TemplateDialog sessionId={modal.sessionId} command={modal.command} />;
    case 'edit': return <EditDialog group={modal.group} slot={modal.slot} />;
    case 'delete': return <DeleteDialog group={modal.group} slot={modal.slot} />;
  }
}

function HelpOverlay() {
  return (
    <Overlay label="Keyboard help">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-medium text-zinc-100">Keyboard</h2>
        <span className="text-xs text-zinc-500"><kbd>Esc</kbd> or <kbd>?</kbd> to close</span>
      </div>
      <div className="max-h-[65vh] space-y-4 overflow-y-auto">
        {KEYMAP.map((section) => (
          <section key={section.title}>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-zinc-500">{section.title}</h3>
            <table className="w-full text-sm">
              <tbody>
                {section.keys.map(([k, d]) => (
                  <tr key={k}><td className="w-52 py-0.5 pr-3 align-top"><kbd>{k}</kbd></td><td className="text-zinc-300">{d}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Overlay>
  );
}

/** Two steps, all keyboard: pick or type a directory, then an optional first prompt. */
function NewSessionDialog() {
  const repos = useStore((s) => s.repos);
  const [step, setStep] = useState<'repo' | 'prompt'>('repo');
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [cwd, setCwd] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const needle = query.trim().toLowerCase();
  const matches = repos.filter((r) => r.toLowerCase().includes(needle)).slice(0, 8);

  useEffect(() => {
    (step === 'repo' ? inputRef.current : promptRef.current)?.focus();
  }, [step]);

  async function create() {
    setBusy(true);
    setError('');
    try {
      const id = await createSession(cwd, prompt.trim() || undefined);
      close();
      openSession(id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Overlay label="New session">
      <h2 className="mb-3 text-base font-medium text-zinc-100">New session</h2>
      {step === 'repo' ? (
        <>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(matches.length - 1, index + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(0, index - 1)); }
              else if (e.key === 'Tab' && matches[index]) { e.preventDefault(); setQuery(matches[index]); }
              else if (e.key === 'Enter') {
                e.preventDefault();
                // A typed absolute path wins over the highlighted suggestion.
                const typed = /^([a-zA-Z]:[\\/]|\/)/.test(query.trim()) ? query.trim() : '';
                const pick = typed || matches[index];
                if (pick) { setCwd(pick); setStep('prompt'); }
              }
            }}
            placeholder="Repo: type to filter, or paste a full path"
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-sky-600"
          />
          <ul className="mt-2">
            {matches.map((r, i) => (
              <li
                key={r}
                onClick={() => { setCwd(r); setStep('prompt'); }}
                className={`truncate rounded px-2 py-1 font-mono text-xs ${i === index ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'}`}
              >{r}</li>
            ))}
            {matches.length === 0 && <li className="px-2 py-1 text-xs text-zinc-500">No known repo matches. Type a full path.</li>}
          </ul>
          <p className="mt-3 text-xs text-zinc-500"><kbd>↑ ↓</kbd> pick · <kbd>Tab</kbd> complete · <kbd>Enter</kbd> next · <kbd>Esc</kbd> cancel</p>
        </>
      ) : (
        <>
          <p className="mb-2 truncate font-mono text-xs text-zinc-400">{cwd}</p>
          <textarea
            ref={promptRef}
            value={prompt}
            rows={4}
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); setStep('repo'); }
              else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); create(); }
            }}
            placeholder="First prompt (optional)"
            className="w-full resize-none rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-sky-600"
          />
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          <p className="mt-2 text-xs text-zinc-500"><kbd>Enter</kbd> start · <kbd>Shift+Enter</kbd> newline · <kbd>Esc</kbd> back</p>
        </>
      )}
    </Overlay>
  );
}

function RenameDialog({ id }: { id: string }) {
  const [title, setTitle] = useState(() => sessionById(id)?.title ?? '');
  return (
    <Overlay label="Rename session">
      <h2 className="mb-3 text-base font-medium text-zinc-100">Rename session</h2>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          else if (e.key === 'Enter' && title.trim()) {
            send({ type: 'session.rename', id, title: title.trim() });
            close();
          }
        }}
        className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-sky-600"
      />
      <p className="mt-2 text-xs text-zinc-500"><kbd>Enter</kbd> save · <kbd>Esc</kbd> cancel</p>
    </Overlay>
  );
}

function StopDialog({ id }: { id: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'y' || k === 'enter') {
        send({ type: 'session.stop', id });
        close();
        if (get().openId === id) set({ screen: 'list', openId: null });
      } else if (k === 'n' || k === 'escape') close();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);
  return (
    <Overlay label="Stop session">
      <p className="text-sm text-zinc-200">Stop <span className="font-medium">{sessionById(id)?.title}</span>? It stays in History and can be resumed.</p>
      <p className="mt-3 text-xs text-zinc-500"><kbd>Y</kbd>/<kbd>Enter</kbd> stop · <kbd>N</kbd>/<kbd>Esc</kbd> cancel</p>
    </Overlay>
  );
}
