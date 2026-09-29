import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { addPath, homeRepo, removePath, repoName, samePath, WORKSPACE_COLORS } from '../../shared/workspaces.ts';
import { WORKFLOW_TEMPLATES } from '../../shared/templates.ts';
import { exportWorkspace } from '../commands.ts';
import { keymap, openSession } from '../keys.ts';
import { get, NO_BINDINGS, sessionById, set, setScope, useStore, type RepoTarget } from '../store.ts';
import { createSession, send } from '../ws.ts';
import { BindingsDialog } from './BindingsDialog.tsx';
import { DeleteDialog, EditDialog, TemplateDialog, VoiceMatchDialog } from './CommandDialogs.tsx';
import { Palette } from './Palette.tsx';
import { Welcome } from './Welcome.tsx';
import { close, DialogKeys, DialogTitle, Overlay, useDialogKeys } from './Overlay.tsx';
import { Icon, Key, SWATCH, WsBadge } from './ui.tsx';

export function Dialogs() {
  const modal = useStore((s) => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case 'help': return <HelpOverlay />;
    case 'new': return <NewSessionDialog workspaceId={modal.workspaceId} repo={modal.repo} />;
    case 'rename': return <RenameDialog id={modal.id} />;
    case 'stop': return <StopDialog id={modal.id} />;
    case 'template': return <TemplateDialog sessionId={modal.sessionId} command={modal.command} />;
    case 'edit': return <EditDialog group={modal.group} slot={modal.slot} />;
    case 'delete': return <DeleteDialog group={modal.group} slot={modal.slot} />;
    case 'voiceMatch': return <VoiceMatchDialog sessionId={modal.sessionId} text={modal.text} command={modal.command} />;
    case 'palette': return <Palette />;
    case 'bindings': return <BindingsDialog />;
    case 'welcome': return <Welcome />;
    case 'workspace': return <WorkspaceDialog id={modal.id} />;
    case 'deleteWorkspace': return <DeleteWorkspaceDialog id={modal.id} />;
    case 'repoPicker': return <RepoPicker target={modal.target} />;
    case 'sources': return <SourcesDialog />;
  }
}

function HelpOverlay() {
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  return (
    <Overlay label="Every key" wide>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="grow text-[19px] font-bold tracking-tight">Every key</h2>
        <span className="flex items-center gap-1.5 text-sm text-faint"><Key k="B" size="sm" />change shortcuts</span>
        <span className="flex items-center gap-1.5 text-sm text-faint"><Key k="Esc" size="sm" />close</span>
      </div>
      <div className="max-h-[68vh] columns-1 gap-8 overflow-y-auto md:columns-2">
        {keymap(bindings).map((section) => (
          <section key={section.title} className="mb-5 break-inside-avoid">
            <h3 className="eyebrow mb-2">{section.title}</h3>
            <dl className="space-y-1.5 text-sm">
              {section.keys.map(([k, d]) => {
                // "E / Delete (workspace column)": the keys go on the keycap, where they work goes with the text.
                const m = /^(.*?) \((.+)\)$/.exec(k);
                return (
                  <div key={k + d} className="grid grid-cols-[minmax(0,9.5rem)_1fr] items-baseline gap-3">
                    <dt><Key k={m ? m[1] : k} size="sm" className="!h-auto min-h-5 whitespace-normal py-0.5 text-left" /></dt>
                    <dd className="text-sub">{m && <span className="text-faint">{m[2]}: </span>}{d}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </div>
    </Overlay>
  );
}

// ---- New session ------------------------------------------------------------------------

interface RepoChoice { path: string; name: string; note?: string }

/** Where a new session can start: the workspace's repos, or the library and recent folders. */
function repoChoices(workspaceId: string | null): RepoChoice[] {
  const s = get();
  const ws = s.workspaces.find((w) => w.id === workspaceId);
  if (ws) return ws.repos.map((p) => ({ path: p, name: repoName(p), note: samePath(p, homeRepo(ws) ?? '') ? 'home' : undefined }));
  let paths: string[] = [];
  for (const r of s.library.repos) paths = addPath(paths, r.path);
  for (const r of s.repos) paths = addPath(paths, r);
  return paths.map((p) => ({ path: p, name: repoName(p) }));
}

/** Two steps, all keyboard: where (Space adds more repos as context), then what to do. */
function NewSessionDialog({ workspaceId, repo }: { workspaceId: string | null; repo?: string }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === workspaceId) ?? null);
  const choices = useMemo(() => repoChoices(workspaceId), [workspaceId]);
  const start = repo ?? (ws ? homeRepo(ws) : undefined);
  const [step, setStep] = useState<'where' | 'what'>(repo || (ws && ws.repos.length === 1) ? 'what' : 'where');
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(() => Math.max(0, choices.findIndex((c) => start && samePath(c.path, start))));
  const [cwd, setCwd] = useState(start ?? choices[0]?.path ?? '');
  const [extras, setExtras] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const needle = query.trim().toLowerCase();
  const matches = choices.filter((c) => !needle || c.path.toLowerCase().includes(needle)).slice(0, 9);
  const typedPath = /^([a-zA-Z]:[\\/]|\/)/.test(query.trim()) ? query.trim() : '';

  useEffect(() => {
    (step === 'where' ? inputRef.current : promptRef.current)?.focus();
  }, [step]);

  function pick(path: string) {
    setCwd(path);
    setExtras((x) => removePath(x, path));
    setStep('what');
  }

  async function create() {
    if (!cwd) { setStep('where'); return; }
    setBusy(true);
    setError('');
    try {
      const id = await createSession(cwd, prompt.trim() || undefined, extras);
      close();
      openSession(id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const title = ws ? <span className="flex items-center gap-2.5">New session in <WsBadge ws={ws} size={24} />{ws.name}</span> : 'New session';
  return (
    <Overlay label="New session">
      <DialogTitle>{title}</DialogTitle>
      {step === 'where' ? (
        <>
          <div className="eyebrow mb-2">Which repo should Claude work in?</div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(matches.length - 1, index + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(0, index - 1)); }
              else if (e.key === ' ' && !query.trim() && matches[index]) {
                // Space (with an empty filter) adds the highlighted repo as extra context.
                e.preventDefault();
                const p = matches[index].path;
                setExtras((x) => (x.some((d) => samePath(d, p)) ? removePath(x, p) : addPath(x, p)));
              } else if (/^[1-9]$/.test(e.key) && !query.trim() && matches[Number(e.key) - 1]) {
                e.preventDefault();
                pick(matches[Number(e.key) - 1].path);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const p = typedPath || matches[index]?.path;
                if (p) pick(p);
              }
            }}
            placeholder={choices.length ? 'Type to filter, or paste a full folder path' : 'Paste the full path of a folder'}
            className="field"
          />
          <ul className="mt-2 space-y-0.5" role="listbox" aria-label="Repos">
            {matches.map((c, i) => {
              const extra = extras.some((d) => samePath(d, c.path));
              return (
                <li
                  key={c.path}
                  role="option"
                  aria-selected={i === index}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => pick(c.path)}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 ${i === index ? 'is-focus bg-raise' : ''}`}
                >
                  <Key k={String(i + 1)} size="sm" />
                  <Icon name="repo" size={16} className="text-faint" />
                  <span className="shrink-0 whitespace-nowrap font-semibold">{c.name}</span>
                  {c.note && <span className="shrink-0 rounded bg-acc-soft px-1.5 text-xs text-acc">{c.note}</span>}
                  <span className="min-w-0 truncate font-mono text-xs text-faint">{c.path}</span>
                  {extra && <span className="ml-auto shrink-0 rounded-full bg-busy-bg px-2 text-xs font-semibold text-busy">+ also</span>}
                </li>
              );
            })}
            {matches.length === 0 && !typedPath && <li className="px-2.5 py-2 text-sm text-sub">Nothing matches. Paste a full path, like C:\repos\my-app.</li>}
            {typedPath && <li className="px-2.5 py-2 text-sm text-sub">Enter starts in <span className="font-mono">{typedPath}</span></li>}
          </ul>
          <DialogKeys items={[['↑ ↓', 'choose'], ['1–9', 'pick'], ['Enter', 'next'], ['Space', 'also let Claude use it'], ['Esc', 'cancel']]} />
        </>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-faint">In</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-raise px-2.5 py-0.5 font-semibold" title={cwd}><Icon name="repo" size={14} />{repoName(cwd)}</span>
            {extras.map((d) => <span key={d} className="inline-flex items-center gap-1.5 rounded-full bg-raise px-2.5 py-0.5" title={d}><Icon name="link" size={13} />{repoName(d)}</span>)}
            {choices.length > 1 && <button className="text-faint underline hover:text-ink" onClick={() => setStep('where')}>change</button>}
          </div>
          <div className="eyebrow mb-2">What should Claude do?</div>
          <textarea
            ref={promptRef}
            value={prompt}
            rows={4}
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); if (choices.length > 1 && !repo) setStep('where'); else close(); }
              else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); create(); }
            }}
            placeholder="Describe a change, a question, or a bug. You can also leave this empty and start typing in the session."
            className="field resize-none"
          />
          {error && <p className="mt-2 text-sm text-bad">{error}</p>}
          <div className="mt-4 flex items-center gap-3">
            <p className="grow text-sm text-faint">Claude asks before running commands or changing files you haven’t allowed.</p>
            <button className="btn btn-primary" disabled={busy} onClick={create}>{busy ? 'Starting…' : 'Start'}<Key k="Enter" size="sm" tone="ghost" /></button>
          </div>
          <DialogKeys items={[['Enter', 'start'], ['Shift+Enter', 'new line'], ['Esc', 'back']]} />
        </>
      )}
    </Overlay>
  );
}

function RenameDialog({ id }: { id: string }) {
  const [title, setTitle] = useState(() => sessionById(id)?.title ?? '');
  return (
    <Overlay label="Rename session">
      <DialogTitle>Rename session</DialogTitle>
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
        aria-label="Session name"
        className="field"
      />
      <DialogKeys items={[['Enter', 'save'], ['Esc', 'cancel']]} />
    </Overlay>
  );
}

function StopDialog({ id }: { id: string }) {
  useDialogKeys((e) => {
    const k = e.key.toLowerCase();
    if (k === 'y' || k === 'enter') {
      send({ type: 'session.stop', id });
      close();
      if (get().openId === id) set({ screen: 'list', openId: null });
    } else if (k === 'n' || k === 'escape') close();
    else return false;
    return true;
  });
  return (
    <Overlay label="End session">
      <DialogTitle>End this session?</DialogTitle>
      <p className="text-sub"><strong className="text-ink">{sessionById(id)?.title}</strong> stops, along with anything it is running in the background. It stays in the list, and you can pick it up again any time.</p>
      <div className="mt-5 flex justify-end gap-2.5">
        <button className="btn" onClick={close}>Keep it<Key k="N" size="sm" /></button>
        <button className="btn btn-primary" onClick={() => { send({ type: 'session.stop', id }); close(); if (get().openId === id) set({ screen: 'list', openId: null }); }}>End session<Key k="Y" size="sm" tone="ghost" /></button>
      </div>
    </Overlay>
  );
}

// ---- Workspaces ------------------------------------------------------------------------------

function WorkspaceDialog({ id }: { id: string | null }) {
  const existing = useStore((s) => s.workspaces.find((w) => w.id === id) ?? null);
  const library = useStore((s) => s.library);
  const workspaces = useStore((s) => s.workspaces);
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? WORKSPACE_COLORS[workspaces.length % WORKSPACE_COLORS.length]);
  const [repos, setRepos] = useState<string[]>(existing?.repos ?? []);
  const [home, setHome] = useState<string | undefined>(existing?.home);
  const [template, setTemplate] = useState('web');
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [editSources, setEditSources] = useState(false);

  // Every repo you could pick: the library, plus any already in the workspace that it doesn't list.
  const all = useMemo(() => {
    let paths = library.repos.map((r) => r.path);
    for (const r of repos) paths = addPath(paths, r);
    return paths;
  }, [library.repos, repos]);
  const needle = filter.trim().toLowerCase();
  const shown = all.filter((p) => !needle || p.toLowerCase().includes(needle));
  const picked = (p: string) => repos.some((r) => samePath(r, p));
  const toggle = (p: string) => setRepos((x) => (picked(p) ? removePath(x, p) : addPath(x, p)));

  function save() {
    if (!name.trim()) { setError('Give the workspace a name.'); return; }
    const workspaceId = existing?.id ?? crypto.randomUUID();
    const homePath = home && repos.some((r) => samePath(r, home)) ? home : undefined;
    send({ type: 'workspace.save', workspace: { id: workspaceId, name: name.trim(), color, repos, home: homePath }, template: existing ? undefined : template });
    setScope({ kind: 'workspace', id: workspaceId });
    set({ modal: null, homeCol: 'sessions' });
  }

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && !(e.target instanceof HTMLElement && e.target.dataset.list)) { e.preventDefault(); save(); }
  };

  const listKey = (e: ReactKeyboardEvent) => {
    const p = shown[index];
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(shown.length - 1, index + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(0, index - 1)); }
    else if ((e.key === ' ' || e.key === 'Enter') && p) { e.preventDefault(); e.stopPropagation(); toggle(p); }
    else if (e.key.toLowerCase() === 'h' && p) { e.preventDefault(); if (!picked(p)) toggle(p); setHome(p); }
  };

  return (
    <Overlay label={existing ? 'Edit workspace' : 'New workspace'} wide>
      <div onKeyDown={onKey}>
        <DialogTitle>{existing ? 'Edit workspace' : 'New workspace'}</DialogTitle>
        <div className="flex flex-wrap items-end gap-4">
          <label className="min-w-0 grow">
            <span className="eyebrow mb-1.5 block">Name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Storefront, Payments, Docs" className="field text-[16px]" />
          </label>
          <div role="radiogroup" aria-label="Colour">
            <span className="eyebrow mb-1.5 block">Colour</span>
            <div className="flex gap-1.5">
              {WORKSPACE_COLORS.map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-lg ${color === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''}`}
                  style={{ background: SWATCH[c] }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="eyebrow grow">Repos · {repos.length} picked</span>
            <button className="text-sm text-faint underline hover:text-ink" onClick={() => setEditSources(!editSources)}>
              {library.sources.length ? `From ${library.sources.map(repoName).join(', ')} · add a folder` : 'Pick the folder your repos are in'}
            </button>
          </div>
          {(editSources || (library.sources.length === 0 && !repos.length)) && <div className="mb-3"><SourcePrompt autoFocus={editSources} /></div>}
          {(library.sources.length > 0 || repos.length > 0) && (
            <>
              <input value={filter} onChange={(e) => { setFilter(e.target.value); setIndex(0); }} placeholder="Filter repos" className="field mb-2 py-1.5 text-sm" aria-label="Filter repos" />
              <div data-list="1" tabIndex={0} onKeyDown={listKey} className="grid max-h-[34vh] grid-cols-1 gap-1.5 overflow-y-auto rounded-xl p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-2 md:grid-cols-3" role="listbox" aria-multiselectable="true" aria-label="Repos">
                {shown.map((p, i) => {
                  const on = picked(p);
                  const isHome = on && home ? samePath(home, p) : on && !home && samePath(repos[0] ?? '', p);
                  return (
                    <div
                      key={p}
                      role="option"
                      aria-selected={on}
                      onClick={() => { setIndex(i); toggle(p); }}
                      title={p}
                      className={`flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 ${on ? 'border-acc bg-acc-soft' : 'border-line'} ${i === index ? 'outline-2 outline-ring' : ''}`}
                    >
                      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${on ? 'border-acc bg-acc text-acc-ink' : 'border-line'}`}>{on && <Icon name="check" size={13} />}</span>
                      <span className="min-w-0 grow">
                        <span className="block truncate text-sm font-semibold">{repoName(p)}</span>
                        <span className="block truncate text-xs text-faint">{isHome ? 'home: new sessions start here' : workspaces.filter((w) => w.id !== id && w.repos.some((r) => samePath(r, p))).map((w) => w.name).join(', ') || ' '}</span>
                      </span>
                      {on && !isHome && <button className="shrink-0 text-faint hover:text-ink" title="Make this the home repo (H)" onClick={(e) => { e.stopPropagation(); setHome(p); }}><Icon name="home" size={15} /></button>}
                      {isHome && <Icon name="home" size={15} className="shrink-0 text-acc" />}
                    </div>
                  );
                })}
                {shown.length === 0 && <p className="col-span-full px-1 py-2 text-sm text-sub">No repos match.</p>}
              </div>
            </>
          )}
        </div>

        {!existing && (
          <div className="mt-5">
            <span className="eyebrow mb-1.5 block">Start with these workflows (the number-pad keys)</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Starter workflows">
              {WORKFLOW_TEMPLATES.map((t) => (
                <button key={t.id} role="radio" aria-checked={template === t.id} onClick={() => setTemplate(t.id)} className={`rounded-xl border px-3 py-1.5 text-left ${template === t.id ? 'border-acc bg-acc-soft' : 'border-line hover:bg-raise'}`}>
                  <span className="block text-sm font-semibold">{t.label}</span>
                  <span className="block text-xs text-faint">{t.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
        <div className="mt-5 flex items-center gap-3">
          <DialogKeys items={[['Tab', 'next part'], ['↑ ↓', 'choose repo'], ['Space', 'pick'], ['H', 'home repo']]} />
          {existing && <button className="btn btn-ghost ml-auto" onClick={() => exportWorkspace(existing.id)} title="Save this workspace and its workflows as a file to share (Shift+E on home)"><Icon name="file" size={16} />Export</button>}
          <button className={`btn btn-primary ${existing ? '' : 'ml-auto'}`} onClick={save}>{existing ? 'Save' : 'Create workspace'}<Key k="Enter" size="sm" tone="ghost" /></button>
        </div>
      </div>
    </Overlay>
  );
}

function DeleteWorkspaceDialog({ id }: { id: string }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === id));
  const doIt = () => { send({ type: 'workspace.delete', id }); close(); };
  useDialogKeys((e) => {
    const k = e.key.toLowerCase();
    if (k === 'y' || k === 'enter') doIt();
    else if (k === 'n' || k === 'escape') close();
    else return false;
    return true;
  });
  return (
    <Overlay label="Delete workspace">
      <DialogTitle>Delete {ws?.name ?? 'workspace'}?</DialogTitle>
      <p className="text-sub">Only the grouping and its workflows go. The repos and every session in them stay where they are.</p>
      <div className="mt-5 flex justify-end gap-2.5">
        <button className="btn" onClick={close}>Keep it<Key k="N" size="sm" /></button>
        <button className="btn btn-primary" onClick={doIt}>Delete<Key k="Y" size="sm" tone="ghost" /></button>
      </div>
    </Overlay>
  );
}

/** Pick a repo for a workspace or a session, from the library (or any folder by path). */
function RepoPicker({ target }: { target: RepoTarget }) {
  const library = useStore((s) => s.library);
  const knownDirs = useStore((s) => s.repos);
  const ws = useStore((s) => (target.kind === 'workspace' ? s.workspaces.find((w) => w.id === target.id) : undefined));
  const session = useStore((s) => (target.kind === 'session' ? s.sessions.find((x) => x.id === target.id) : undefined));
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const has = (p: string) => (ws ? ws.repos.some((r) => samePath(r, p)) : session ? samePath(session.cwd, p) || Boolean(session.extraDirs?.some((d) => samePath(d, p))) : false);
  const all = useMemo(() => {
    let paths = library.repos.map((r) => r.path);
    for (const d of knownDirs) paths = addPath(paths, d);
    return paths;
  }, [library.repos, knownDirs]);
  const needle = query.trim().toLowerCase();
  const matches = all.filter((p) => !needle || p.toLowerCase().includes(needle)).slice(0, 9);
  const typedPath = /^([a-zA-Z]:[\\/]|\/)/.test(query.trim()) ? query.trim() : '';

  function add(path: string) {
    if (has(path)) { close(); return; }
    if (target.kind === 'workspace') send({ type: 'workspace.addRepo', id: target.id, path });
    else send({ type: 'session.addDir', id: target.id, path });
    close();
  }

  const title = target.kind === 'workspace' ? `Add a repo to ${ws?.name ?? 'the workspace'}` : 'Let this session work in another repo';
  return (
    <Overlay label={title}>
      <DialogTitle>{title}</DialogTitle>
      {target.kind === 'session' && (
        <p className="mb-3 text-sm text-sub">Claude can then read and change it alongside {session ? repoName(session.cwd) : 'its own repo'}. {session?.live ? 'The session restarts in place to pick it up; the conversation is kept.' : ''}</p>
      )}
      <input
        autoFocus
        value={query}
        onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(matches.length - 1, index + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(0, index - 1)); }
          else if (/^[1-9]$/.test(e.key) && !query.trim() && matches[Number(e.key) - 1]) { e.preventDefault(); add(matches[Number(e.key) - 1]); }
          else if (e.key === 'Enter') { e.preventDefault(); const p = typedPath || matches[index]; if (p) add(p); }
        }}
        placeholder="Type to filter, or paste a full folder path"
        className="field"
      />
      <ul className="mt-2 space-y-0.5" role="listbox" aria-label="Repos">
        {matches.map((p, i) => (
          <li key={p} role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => add(p)} className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 ${i === index ? 'is-focus bg-raise' : ''} ${has(p) ? 'opacity-60' : ''}`}>
            <Key k={String(i + 1)} size="sm" />
            <Icon name="repo" size={16} className="text-faint" />
            <span className="shrink-0 whitespace-nowrap font-semibold">{repoName(p)}</span>
            <span className="min-w-0 truncate font-mono text-xs text-faint">{p}</span>
            {has(p) && <span className="ml-auto shrink-0 text-xs text-faint">already in</span>}
          </li>
        ))}
        {!matches.length && !typedPath && <li className="px-2.5 py-2 text-sm text-sub">{library.sources.length ? 'Nothing matches.' : 'Your repo library is empty. Paste a full path, or press Esc and choose your repo folder (F in the library).'}</li>}
        {typedPath && <li className="px-2.5 py-2 text-sm text-sub">Enter adds <span className="font-mono">{typedPath}</span></li>}
      </ul>
      <DialogKeys items={[['↑ ↓', 'choose'], ['1–9', 'pick'], ['Enter', 'add'], ['Esc', 'cancel']]} />
    </Overlay>
  );
}

/** The folders the repo library scans. */
function SourcesDialog() {
  const library = useStore((s) => s.library);
  return (
    <Overlay label="Repo folders">
      <DialogTitle>Where are your repos?</DialogTitle>
      <p className="mb-4 text-sub">Pick the folder (or folders) that hold your projects. Every git repo directly inside shows up in the repo library, ready to drag into a workspace.</p>
      {library.sources.length > 0 && (
        <ul className="mb-4 space-y-1.5">
          {library.sources.map((src) => (
            <li key={src} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
              <Icon name="folder" size={16} className="text-faint" />
              <span className="grow truncate font-mono text-sm">{src}</span>
              <button className="text-sm text-faint hover:text-bad" onClick={() => send({ type: 'library.setSources', sources: library.sources.filter((x) => x !== src) })}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <SourcePrompt autoFocus />
      <DialogKeys items={[['Enter', 'add the folder'], ['1–3', 'use a suggestion'], ['Esc', 'done']]} />
    </Overlay>
  );
}

/** Type or pick a source folder; used by the sources dialog and inline in the workspace editor. */
function SourcePrompt({ autoFocus = false }: { autoFocus?: boolean }) {
  const library = useStore((s) => s.library);
  const [path, setPath] = useState('');
  const addSource = (p: string) => {
    if (!p.trim()) return;
    send({ type: 'library.setSources', sources: [...library.sources, p.trim()] });
    setPath('');
  };
  return (
    <div className="space-y-2">
      <input
        autoFocus={autoFocus}
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); close(); }
          else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addSource(path); }
          else if (/^[1-3]$/.test(e.key) && !path && library.suggested[Number(e.key) - 1]) { e.preventDefault(); addSource(library.suggested[Number(e.key) - 1]); }
        }}
        placeholder="Full path of a folder, e.g. C:\repos"
        aria-label="Repo folder"
        className="field font-mono text-sm"
      />
      {library.suggested.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-faint">Suggested from your past sessions:</span>
          {library.suggested.map((sug, i) => (
            <button key={sug} className="btn min-h-8 py-0 pl-1.5 font-mono text-[13px]" onClick={() => addSource(sug)}><Key k={String(i + 1)} size="sm" />{sug}</button>
          ))}
        </div>
      )}
    </div>
  );
}
