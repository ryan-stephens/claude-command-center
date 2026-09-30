import { listStep } from '../list-step.ts';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { addPath, homeRepo, isInside, removePath, repoName, samePath, WORKSPACE_COLORS, workspaceRepos, workspacesFor } from '../../shared/workspaces.ts';
import { WORKFLOW_TEMPLATES } from '../../shared/templates.ts';
import type { SourceState } from '../../shared/tickets.ts';
import { parseSteps, recipeFor } from '../../shared/recipes.ts';
import { exportWorkspace } from '../commands.ts';
import { looksLikePath } from '../folder-model.ts';
import { keymap, openSession } from '../keys.ts';
import { deleteCard, runWorkspaceAction } from '../line-keys.ts';
import { get, NO_BINDINGS, sessionById, set, setFilter as showWorkspace, useStore, type RepoTarget, type WorkspaceAction } from '../store.ts';
import { createSession, saveRecipe, send, setSources } from '../ws.ts';
import { BindingsDialog } from './BindingsDialog.tsx';
import { DeleteDialog, EditDialog, TemplateDialog, VoiceMatchDialog } from './CommandDialogs.tsx';
import { FolderPicker } from './FolderPicker.tsx';
import { Palette } from './Palette.tsx';
import { ShipSheet } from './ShipSheet.tsx';
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
    case 'repoRemove': return <RepoRemover target={modal.target} />;
    case 'sources': return <SourcesDialog />;
    case 'deleteCard': return <DeleteCardDialog id={modal.id} />;
    case 'recipe': return <RecipeDialog repo={modal.repo} />;
    case 'ship': return <ShipSheet id={modal.id} />;
    case 'pickWorkspace': return <PickWorkspaceDialog then={modal.then} />;
    case 'tickets': return <TicketsDialog />;
  }
}

function HelpOverlay() {
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  return (
    <Overlay label="Every key" wide="xl">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="grow text-[19px] font-bold tracking-tight">Every key</h2>
        <span className="flex items-center gap-1.5 text-sm text-faint"><Key k="B" size="sm" />change shortcuts</span>
        <span className="flex items-center gap-1.5 text-sm text-faint"><Key k="Esc" size="sm" />close</span>
      </div>
      <div className="max-h-[72vh] columns-1 gap-8 overflow-y-auto md:columns-2 xl:columns-3">
        {keymap(bindings).map((section) => (
          <section key={section.title} className="mb-5 break-inside-avoid">
            <h3 className="eyebrow mb-2">{section.title}</h3>
            <dl className="space-y-1.5 text-sm">
              {section.keys.map(([k, d]) => {
                // "E / Delete (workspace column)": the keys go on the keycap, where they work goes with the text.
                const m = /^(.*?) \((.+)\)$/.exec(k);
                return (
                  <div key={k + d} className="grid grid-cols-[minmax(0,7.5rem)_1fr] items-baseline gap-3">
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

/**
 * Two steps, all keyboard: where, then what to do. A session in a workspace can use all of its
 * repos by itself; outside one, Space adds more repos for Claude to use.
 */
function NewSessionDialog({ workspaceId, repo }: { workspaceId: string | null; repo?: string }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === workspaceId) ?? null);
  const workspaces = useStore((s) => s.workspaces);
  const choices = useMemo(() => repoChoices(workspaceId), [workspaceId]);
  const start = repo ?? (ws ? homeRepo(ws) : undefined);
  const [step, setStep] = useState<'where' | 'browse' | 'what'>(repo || (ws && ws.repos.length === 1) ? 'what' : 'where');
  const [browseFrom, setBrowseFrom] = useState<string | undefined>();
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
  const typedPath = looksLikePath(query) ? query.trim() : '';
  const matches = typedPath ? [] : choices.filter((c) => !needle || c.path.toLowerCase().includes(needle)).slice(0, 9);
  /** The last row, after the matches: browse the disk. */
  const anotherRow = matches.length;

  useEffect(() => {
    if (step === 'where') inputRef.current?.focus();
    else if (step === 'what') promptRef.current?.focus();
  }, [step]);

  function browse(from?: string) {
    setBrowseFrom(from);
    setStep('browse');
  }

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
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(anotherRow, index + listStep(e))); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(0, index - listStep(e))); }
              else if (e.key.toLowerCase() === 'o' && e.ctrlKey) { e.preventDefault(); browse(typedPath || undefined); }
              else if (e.key === ' ' && !ws && !query.trim() && matches[index]) {
                // Space (with an empty filter) adds the highlighted repo as extra context.
                e.preventDefault();
                const p = matches[index].path;
                setExtras((x) => (x.some((d) => samePath(d, p)) ? removePath(x, p) : addPath(x, p)));
              } else if (/^[1-9]$/.test(e.key) && !query.trim() && matches[Number(e.key) - 1]) {
                e.preventDefault();
                pick(matches[Number(e.key) - 1].path);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                // A typed path opens the folder picker there, so you see it exists (and what's in it) first.
                if (typedPath || index >= anotherRow) browse(typedPath || undefined);
                else if (matches[index]) pick(matches[index].path);
              }
            }}
            placeholder={choices.length ? 'Type to filter, or paste a full folder path' : 'Paste the full path of a folder, or press Enter to browse'}
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
            {matches.length === 0 && !typedPath && choices.length > 0 && <li className="px-2.5 py-2 text-sm text-sub">No repo matches.</li>}
            <AnotherFolderRow
              active={index >= anotherRow}
              label={typedPath ? <>Open <span className="font-mono">{typedPath}</span> in the folder picker</> : 'Another folder…'}
              onHover={() => setIndex(anotherRow)}
              onClick={() => browse(typedPath || undefined)}
            />
          </ul>
          {ws && ws.repos.length > 1 && <p className="mt-2 text-sm text-faint">Claude can use every repo in {ws.name}; this is just where it starts.</p>}
          <DialogKeys items={[['↑ ↓', 'choose'], ['1–9', 'pick'], ['Enter', 'next'], ...(ws ? [] : [['Space', 'also let Claude use it'] as [string, string]]), ['Ctrl+O', 'another folder'], ['Esc', 'cancel']]} />
        </>
      ) : step === 'browse' ? (
        <>
          <div className="eyebrow mb-2">Pick the folder Claude should work in</div>
          <FolderPicker start={browseFrom} useLabel="Start here" onUse={pick} onEscape={() => setStep('where')} />
        </>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-faint">In</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-raise px-2.5 py-0.5 font-semibold" title={cwd}><Icon name="repo" size={14} />{repoName(cwd)}</span>
            {workspaceRepos(cwd, workspaces).map((d) => {
              const owner = workspacesFor(cwd, workspaces).find((w) => w.repos.some((r) => samePath(r, d))) ?? null;
              return <span key={d} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5" title={`${d}\nFrom the ${owner?.name ?? ''} workspace`}><WsBadge ws={owner} size={14} />{repoName(d)}</span>;
            })}
            {extras.filter((d) => !workspaceRepos(cwd, workspaces).some((w) => samePath(w, d))).map((d) => <span key={d} className="inline-flex items-center gap-1.5 rounded-full bg-raise px-2.5 py-0.5" title={d}><Icon name="link" size={13} />{repoName(d)}</span>)}
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
      if (get().openId === id) set({ screen: 'line', openId: null });
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
        <button className="btn btn-primary" onClick={() => { send({ type: 'session.stop', id }); close(); if (get().openId === id) set({ screen: 'line', openId: null }); }}>End session<Key k="Y" size="sm" tone="ghost" /></button>
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
  const sourcesToggle = useRef<HTMLButtonElement>(null);
  /** Close the embedded picker and keep the keyboard in the dialog (Esc again then closes it). */
  const doneWithSources = () => { setEditSources(false); setTimeout(() => sourcesToggle.current?.focus(), 0); };

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
    showWorkspace(workspaceId);
    set({ modal: null });
  }

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && !(e.target instanceof HTMLElement && e.target.dataset.list)) { e.preventDefault(); save(); }
  };

  const listKey = (e: ReactKeyboardEvent) => {
    const p = shown[index];
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(shown.length - 1, index + listStep(e))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(0, index - listStep(e))); }
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
            <button ref={sourcesToggle} className="text-sm text-faint underline hover:text-ink" onClick={() => setEditSources(!editSources)}>
              {library.sources.length ? `From ${library.sources.map(repoName).join(', ')} · add a folder` : 'Pick the folder your repos are in'}
            </button>
          </div>
          {(editSources || (library.sources.length === 0 && !repos.length)) && (
            <div className="mb-3 rounded-xl border border-line p-3">
              <p className="mb-2 text-sm text-sub">Walk to the folder that holds your repos (for example D:\repos) and press <Key k="Space" size="sm" />. Every git repo inside it appears below.</p>
              <FolderPicker
                autoFocus={editSources}
                listClass="max-h-[26vh]"
                onEscape={() => (editSources ? doneWithSources() : close())}
                onUse={async (p) => { await setSources(addPath(library.sources, p)); doneWithSources(); }}
              />
            </div>
          )}
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
          {existing && <button className="btn btn-ghost ml-auto" onClick={() => exportWorkspace(existing.id)} title="Save this workspace and its workflows as a file to share (Shift+E on the Ticket Line)"><Icon name="file" size={16} />Export</button>}
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

function DeleteCardDialog({ id }: { id: string }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id));
  const doIt = () => { deleteCard(id); close(); };
  useDialogKeys((e) => {
    const k = e.key.toLowerCase();
    if (k === 'y' || k === 'enter') doIt();
    else if (k === 'n' || k === 'escape') close();
    else return false;
    return true;
  });
  return (
    <Overlay label="Remove card">
      <DialogTitle>Take {card ? `${card.key} ${card.title}` : 'this card'} off the line?</DialogTitle>
      <p className="text-sub">Only the card goes. Its terminal tab, session, branch and changes stay as they are.</p>
      <div className="mt-5 flex justify-end gap-2.5">
        <button className="btn" onClick={close}>Keep it<Key k="N" size="sm" /></button>
        <button className="btn btn-primary" onClick={doIt}>Remove<Key k="Y" size="sm" tone="ghost" /></button>
      </div>
    </Overlay>
  );
}

/** e in a card's drawer: the run recipe for its repo, one command per line, and where the app will be. */
function RecipeDialog({ repo }: { repo: string }) {
  const recipe = useStore((s) => recipeFor(s.recipes, repo));
  const [text, setText] = useState(() => recipe?.steps.join('\n') ?? '');
  const [url, setUrl] = useState(() => recipe?.url ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    saveRecipe(repo, parseSteps(text), url.trim() || undefined).then(close, (e: Error) => setError(e.message));
  };
  const keys = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  return (
    <Overlay label="Run recipe">
      <DialogTitle>Run recipe for {repoName(repo)}</DialogTitle>
      <p className="mb-3 text-sm text-sub">
        Try it runs these in the card’s folder, one after another. A step that keeps running and serves is the app: it stays up until you stop it, and the next step starts.
        {recipe ? ` Now: ${recipe.source}.` : ' Nothing was detected for this repo.'}
      </p>
      <label className="eyebrow mb-1.5 block" htmlFor="recipe-steps">Commands, one per line</label>
      <textarea id="recipe-steps" autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys} rows={5} spellCheck={false}
        placeholder={'pnpm install\npnpm dev'} className="field w-full resize-y font-mono text-[13px]" />
      <label className="eyebrow mb-1.5 mt-3 block" htmlFor="recipe-url">Where the app will be (optional; otherwise read from what it prints)</label>
      <input id="recipe-url" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={keys} placeholder="http://localhost:5173" className="field w-full font-mono text-[13px]" />
      {recipe?.edited && <p className="mt-2 text-[13px] text-faint">Empty the commands and save to go back to the detected recipe.</p>}
      {error && <div className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{error}</div>}
      <div className="mt-5 flex items-center justify-end gap-2.5">
        <button className="btn" onClick={close}>Cancel<Key k="Esc" size="sm" /></button>
        <button className="btn btn-primary" onClick={save}>Save<Key k="Ctrl Enter" size="sm" tone="ghost" /></button>
      </div>
    </Overlay>
  );
}

/** One source's state in the Tickets dialog. */
function SourceLine({ name, state, setup }: { name: string; state: SourceState | undefined; setup: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line px-3 py-2">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${state?.state === 'ok' ? 'bg-ok' : state?.state === 'error' ? 'bg-bad' : 'bg-faint'}`} />
      <div className="min-w-0 grow">
        <div className="font-semibold">{name}</div>
        <div className="text-sm text-sub">
          {state?.state === 'ok' ? `Connected: ${state.count} ticket${state.count === 1 ? '' : 's'}.`
            : state?.state === 'error' ? <span className="text-bad">{state.message}</span>
            : <>Not connected. {setup} Tokens stay on the server; the page never sees them.</>}
        </div>
      </div>
    </div>
  );
}

/**
 * Shift+T on the line: where tickets come from (Jira, Trello, the demo set) and which workspace
 * each project goes to. Read-only: nothing is ever written back to Jira or Trello.
 */
function TicketsDialog() {
  const sources = useStore((s) => s.ticketSources);
  const projects = useStore((s) => s.ticketProjects);
  const workspaces = useStore((s) => s.workspaces);
  const [index, setIndex] = useState(0);
  const at = Math.min(index, projects.length - 1);
  const map = (i: number, delta: number) => {
    const p = projects[i];
    if (!p) return;
    const opts = [null, ...workspaces.map((w) => w.id)];
    const next = opts[(opts.indexOf(p.workspaceId) + delta + opts.length) % opts.length];
    send({ type: 'tickets.map', project: p.id, workspaceId: next });
  };
  useDialogKeys((e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') setIndex(Math.min(projects.length - 1, at + 1));
    else if (e.key === 'ArrowUp') setIndex(Math.max(0, at - 1));
    else if (e.key === 'ArrowRight') map(at, 1);
    else if (e.key === 'ArrowLeft') map(at, -1);
    else if (e.key === 'd' || e.key === 'D') send({ type: 'tickets.demo', on: !sources?.demo });
    else if (e.key === 'r' || e.key === 'R') send({ type: 'tickets.refresh' });
    else return false;
    return true;
  });
  return (
    <Overlay label="Tickets" wide>
      <DialogTitle>Tickets</DialogTitle>
      <div className="grid gap-2">
        <SourceLine name="Jira" state={sources?.jira} setup="In ~/.cc-control/config.env: CC_CONTROL_JIRA_SITE and CC_CONTROL_JIRA_TOKEN (Data Center: a personal access token; Cloud: an API token, plus CC_CONTROL_JIRA_EMAIL). Restart the server; pnpm doctor checks it." />
        <SourceLine name="Trello" state={sources?.trello} setup="Set CC_CONTROL_TRELLO_KEY, CC_CONTROL_TRELLO_TOKEN and CC_CONTROL_TRELLO_BOARDS (board ids) where the server starts, and restart it." />
        <button onClick={() => send({ type: 'tickets.demo', on: !sources?.demo })} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-left hover:bg-raise">
          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border-[1.5px] border-line font-mono text-xs font-bold text-ok`}>{sources?.demo ? '✓' : ''}</span>
          <span className="grow"><span className="font-semibold">Demo tickets</span><span className="block text-sm text-sub">Made-up Jira and Trello tickets, to try the Inbox before a real site is connected.</span></span>
          <Key k="D" size="sm" />
        </button>
      </div>
      <h3 className="eyebrow mb-2 mt-5">Which workspace each project goes to</h3>
      {projects.length ? (
        <ul className="space-y-1" role="listbox" aria-label="Projects">
          {projects.map((p, i) => {
            const ws = workspaces.find((w) => w.id === p.workspaceId) ?? null;
            return (
              <li key={p.id} role="option" aria-selected={i === at} onMouseEnter={() => setIndex(i)}
                className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${i === at ? 'is-focus bg-raise' : ''}`}>
                <span className="w-14 shrink-0 text-xs text-faint">{p.source === 'jira' ? 'Jira' : 'Trello'}</span>
                <span className="min-w-0 grow truncate font-semibold">{p.name}<span className="ml-2 font-normal text-faint">{p.source === 'jira' ? p.id : ''} · {p.count} ticket{p.count === 1 ? '' : 's'}</span></span>
                <button className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:bg-surface hover:text-ink" onClick={() => map(i, -1)} aria-label="Previous workspace"><Icon name="back" size={14} /></button>
                <span className="flex w-40 items-center gap-2 truncate text-sm">{ws ? <><WsBadge ws={ws} size={18} />{ws.name}</> : <span className="text-faint">No workspace (All only)</span>}</span>
                <button className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:bg-surface hover:text-ink" onClick={() => map(i, 1)} aria-label="Next workspace"><Icon name="right" size={14} /></button>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-faint">No tickets yet, so no projects to map. Connect a source above, or switch on the demo tickets.</p>}
      <DialogKeys items={[['↑ ↓', 'Project'], ['← →', 'Workspace'], ['D', 'Demo tickets'], ['R', 'Fetch again'], ['Esc', 'Close']]} />
    </Overlay>
  );
}

const PICK_TITLE: Record<WorkspaceAction, string> = {
  addRepo: 'Add a repo to which workspace?',
  removeRepo: 'Remove a repo from which workspace?',
  edit: 'Edit which workspace?',
  share: 'Share which workspace?',
  delete: 'Delete which workspace?',
};

/** All is showing on the line and a workspace key was pressed: which workspace it is for. */
function PickWorkspaceDialog({ then }: { then: WorkspaceAction }) {
  const workspaces = useStore((s) => s.workspaces);
  const [index, setIndex] = useState(0);
  const pick = (i: number) => { const w = workspaces[i]; if (w) runWorkspaceAction(then, w.id); };
  useDialogKeys((e) => {
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (digit) pick(Number(digit[1]) - 1);
    else if (e.key === 'ArrowDown') setIndex((i) => Math.min(workspaces.length - 1, i + listStep(e)));
    else if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - listStep(e)));
    else if (e.key === 'Enter') pick(index);
    else if (e.key === 'Escape') close();
    else return false;
    return true;
  });
  return (
    <Overlay label={PICK_TITLE[then]}>
      <DialogTitle>{PICK_TITLE[then]}</DialogTitle>
      <ul className="space-y-1" role="listbox" aria-label="Workspaces">
        {workspaces.map((w, i) => (
          <li key={w.id} role="option" aria-selected={i === index} onClick={() => pick(i)} onMouseEnter={() => setIndex(i)}
            className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 ${i === index ? 'is-focus bg-raise' : 'hover:bg-raise/60'}`}>
            {i < 9 ? <Key k={String(i + 1)} size="sm" /> : <span className="w-5" />}
            <WsBadge ws={w} />
            <span className="grow font-semibold">{w.name}</span>
            <span className="text-sm text-faint">{w.repos.length} repo{w.repos.length === 1 ? '' : 's'}</span>
          </li>
        ))}
      </ul>
      <DialogKeys items={[['1–9', 'Pick'], ['↑ ↓', 'Choose'], ['Enter', 'This one'], ['Esc', 'Cancel']]} />
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
  const [browseFrom, setBrowseFrom] = useState<string | null>(null);
  const has = (p: string) => (ws ? ws.repos.some((r) => samePath(r, p)) : session ? samePath(session.cwd, p) || Boolean(session.extraDirs?.some((d) => samePath(d, p))) : false);
  const all = useMemo(() => {
    let paths = library.repos.map((r) => r.path);
    for (const d of knownDirs) paths = addPath(paths, d);
    return paths;
  }, [library.repos, knownDirs]);
  const needle = query.trim().toLowerCase();
  const typedPath = looksLikePath(query) ? query.trim() : '';
  const matches = typedPath ? [] : all.filter((p) => !needle || p.toLowerCase().includes(needle)).slice(0, 9);
  const anotherRow = matches.length;

  function add(path: string) {
    if (has(path)) { close(); return; }
    if (target.kind === 'workspace') send({ type: 'workspace.addRepo', id: target.id, path });
    else send({ type: 'session.addDir', id: target.id, path });
    close();
  }

  const title = target.kind === 'workspace' ? `Add a repo to ${ws?.name ?? 'the workspace'}` : 'Let this session work in another repo';
  if (browseFrom !== null) {
    return (
      <Overlay label={title}>
        <DialogTitle>{title}</DialogTitle>
        <FolderPicker start={browseFrom || undefined} useLabel="Add this folder" onUse={add} onEscape={() => setBrowseFrom(null)} />
      </Overlay>
    );
  }
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
          else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(anotherRow, index + listStep(e))); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(0, index - listStep(e))); }
          else if (e.key.toLowerCase() === 'o' && e.ctrlKey) { e.preventDefault(); setBrowseFrom(typedPath); }
          else if (/^[1-9]$/.test(e.key) && !query.trim() && matches[Number(e.key) - 1]) { e.preventDefault(); add(matches[Number(e.key) - 1]); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (typedPath || index >= anotherRow) setBrowseFrom(typedPath);
            else if (matches[index]) add(matches[index]);
          }
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
        {!matches.length && !typedPath && <li className="px-2.5 py-2 text-sm text-sub">{library.sources.length ? 'No repo matches.' : 'Your repo library is empty. Browse to the repo below, or press Esc and choose your repo folder (F in the library).'}</li>}
        <AnotherFolderRow
          active={index >= anotherRow}
          label={typedPath ? <>Open <span className="font-mono">{typedPath}</span> in the folder picker</> : 'Another folder…'}
          onHover={() => setIndex(anotherRow)}
          onClick={() => setBrowseFrom(typedPath)}
        />
      </ul>
      <DialogKeys items={[['↑ ↓', 'choose'], ['1–9', 'pick'], ['Enter', 'add'], ['Ctrl+O', 'another folder'], ['Esc', 'cancel']]} />
    </Overlay>
  );
}

/**
 * Take a repo out of a workspace (every session in it stops using it) or out of a session (only the
 * ones added to that session; its workspace's repos are removed from the workspace).
 */
function RepoRemover({ target }: { target: RepoTarget }) {
  const ws = useStore((s) => (target.kind === 'workspace' ? s.workspaces.find((w) => w.id === target.id) : undefined));
  const session = useStore((s) => (target.kind === 'session' ? s.sessions.find((x) => x.id === target.id) : undefined));
  const workspaces = useStore((s) => s.workspaces);
  const [index, setIndex] = useState(0);
  const fromWs = session?.workspaceDirs ?? [];
  const removable = ws ? ws.repos : (session?.extraDirs ?? []).filter((d) => !fromWs.some((w) => samePath(w, d)));
  const home = ws ? homeRepo(ws) : undefined;

  function remove(path: string | undefined) {
    if (!path) return;
    if (target.kind === 'workspace') send({ type: 'workspace.removeRepo', id: target.id, path });
    else send({ type: 'session.removeDir', id: target.id, path });
    close();
  }

  useDialogKeys((e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') setIndex(Math.min(removable.length - 1, index + listStep(e)));
    else if (e.key === 'ArrowUp') setIndex(Math.max(0, index - listStep(e)));
    else if (e.key === 'Enter' || e.key === 'Delete') remove(removable[index]);
    else if (/^[1-9]$/.test(e.key) && removable[Number(e.key) - 1]) remove(removable[Number(e.key) - 1]);
    else return false;
    return true;
  });

  const title = ws ? `Remove a repo from ${ws.name}` : 'Stop this session using a repo';
  return (
    <Overlay label={title}>
      <DialogTitle>{title}</DialogTitle>
      <p className="mb-3 text-sm text-sub">
        {ws
          ? 'Sessions in this workspace stop using it (a session that is working finishes first). Sessions that run in it leave the workspace. The repo itself is untouched.'
          : session?.live ? 'The session restarts in place without it; the conversation is kept.' : 'It takes effect the next time the session runs.'}
      </p>
      <ul className="space-y-0.5" role="listbox" aria-label="Repos">
        {removable.map((p, i) => (
          <li key={p} role="option" aria-selected={i === index} onMouseMove={() => { if (i !== index) setIndex(i); }} onClick={() => remove(p)} title={p} className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 ${i === index ? 'is-focus bg-raise' : ''}`}>
            <Key k={String(i + 1)} size="sm" />
            <Icon name="repo" size={16} className="text-faint" />
            <span className="shrink-0 whitespace-nowrap font-semibold">{repoName(p)}</span>
            {home && samePath(p, home) && <span className="shrink-0 rounded bg-acc-soft px-1.5 text-xs text-acc">home</span>}
            <span className="min-w-0 truncate font-mono text-xs text-faint">{p}</span>
          </li>
        ))}
        {session && fromWs.map((d) => {
          const owner = workspacesFor(session.cwd, workspaces).find((w) => w.repos.some((r) => samePath(r, d))) ?? null;
          return (
            <li key={d} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-faint" title={d}>
              <span className="w-5" />
              <WsBadge ws={owner} size={16} />
              <span className="shrink-0 whitespace-nowrap">{repoName(d)}</span>
              <span className="min-w-0 truncate text-xs">from {owner?.name ?? 'its workspace'}: remove it there (− on the Ticket Line)</span>
            </li>
          );
        })}
        {!removable.length && !fromWs.length && <li className="px-2.5 py-2 text-sm text-sub">{ws ? `${ws.name} has no repos.` : 'This session only uses its own repo.'}</li>}
        {!removable.length && fromWs.length > 0 && <li className="px-2.5 py-2 text-sm text-sub">Nothing was added to this session itself.</li>}
      </ul>
      <DialogKeys items={[['↑ ↓', 'choose'], ['1–9', 'remove'], ['Enter', 'remove'], ['Esc', 'cancel']]} />
    </Overlay>
  );
}

/** The last row of a repo list: walk the disk for any folder (Ctrl+O). */
function AnotherFolderRow({ active, label, onHover, onClick }: { active: boolean; label: ReactNode; onHover: () => void; onClick: () => void }) {
  return (
    <li role="option" aria-selected={active} onMouseEnter={onHover} onClick={onClick} className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-sub ${active ? 'is-focus bg-raise' : ''}`}>
      <Key k="Ctrl+O" size="sm" />
      <Icon name="folder" size={16} className="text-faint" />
      <span className="min-w-0 truncate">{label}</span>
    </li>
  );
}

/** The folders the repo library scans: pick one with the folder picker, Tab to yours and Delete to drop one. */
function SourcesDialog() {
  const library = useStore((s) => s.library);
  const [added, setAdded] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');
  const pickerInput = useRef<HTMLInputElement>(null);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const count = (src: string) => library.repos.filter((r) => isInside(r.path, src)).length;

  async function add(path: string) {
    if (!library.sources.some((s) => samePath(s, path))) await setSources([...library.sources, path]);
    setAdded(path);
  }

  function remove(i: number) {
    const src = library.sources[i];
    setRemoveError('');
    setAdded(null);
    // Move the keyboard to a neighbour now, before the focused row disappears and focus falls to the page.
    (rows.current[i + 1] ?? rows.current[i - 1] ?? pickerInput.current)?.focus();
    setSources(library.sources.filter((x) => !samePath(x, src))).catch((e: Error) => setRemoveError(e.message));
  }

  const rowKey = (e: ReactKeyboardEvent, i: number) => {
    const go = (el: HTMLElement | null | undefined) => { e.preventDefault(); e.stopPropagation(); el?.focus(); };
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(i); }
    else if (e.key === 'ArrowDown') go(rows.current[Math.min(library.sources.length - 1, i + listStep(e))]);
    else if (e.key === 'ArrowUp') go(rows.current[Math.max(0, i - listStep(e))]);
    else if (e.key === 'Tab' || e.key === 'Escape') go(pickerInput.current);
  };

  return (
    <Overlay label="Repo folders" wide>
      <DialogTitle>Where are your repos?</DialogTitle>
      <p className="mb-4 text-sub">Pick the folder (or folders) that hold your projects. Every git repo directly inside shows up in the repo library, ready to drag into a workspace.</p>
      {library.sources.length > 0 && (
        <div className="mb-4">
          <div className="eyebrow mb-1.5 flex items-center gap-2">Your folders<span className="font-normal normal-case tracking-normal text-faint">· <Key k="Tab" size="sm" /> then <Key k="Delete" size="sm" /> removes one</span></div>
          <ul className="space-y-1.5" aria-label="Your repo folders">
            {library.sources.map((src, i) => (
              <li
                key={src}
                ref={(el) => { rows.current[i] = el; }}
                tabIndex={0}
                onKeyDown={(e) => rowKey(e, i)}
                className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 outline-none focus:border-transparent focus:ring-2 focus:ring-ring"
              >
                <Icon name="folder" size={16} className="text-faint" />
                <span className="grow truncate font-mono text-sm">{src}</span>
                <span className="shrink-0 text-xs text-faint">{count(src)} repo{count(src) === 1 ? '' : 's'}</span>
                <button className="flex shrink-0 items-center gap-1.5 text-sm text-faint hover:text-bad" onClick={() => remove(i)}>Remove<Key k="Del" size="sm" /></button>
              </li>
            ))}
          </ul>
          {removeError && <p className="mt-2 text-sm text-bad" role="alert">{removeError}</p>}
        </div>
      )}
      {added && (
        <p className="mb-3 flex items-center gap-2 rounded-xl bg-ok-bg px-3 py-2 text-sm text-ok" role="status">
          <Icon name="check" size={15} />
          <span><span className="font-mono">{added}</span> is in your library: {count(added)} repo{count(added) === 1 ? '' : 's'}. Add another, or press <Key k="Esc" size="sm" /> when you’re done.</span>
        </p>
      )}
      <FolderPicker onUse={add} onEscape={close} inputRef={pickerInput} onTab={library.sources.length ? () => rows.current[0]?.focus() : undefined} />
    </Overlay>
  );
}
