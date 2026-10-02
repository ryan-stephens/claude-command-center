import { listStep } from '../list-step.ts';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { addPath, homeRepo, isInside, removePath, repoName, samePath, WORKSPACE_COLORS, workspaceRepos, workspacesFor } from '../../shared/workspaces.ts';
import { WORKFLOW_TEMPLATES } from '../../shared/templates.ts';
import type { SourceState } from '../../shared/tickets.ts';
import { parseSteps, recipeFor, wsRecipeKey } from '../../shared/recipes.ts';
import { stackDraft, stackWarnings, unknownStackRepos, validateStack, type Stack } from '../../shared/stack.ts';
import type { Finding } from '../../shared/stack-detect.ts';
import { StackTable } from './StackTable.tsx';
import { exportWorkspace } from '../commands.ts';
import { looksLikePath } from '../folder-model.ts';
import { keymap, openSession, toggleHints } from '../keys.ts';
import { deleteCard, openWorktrees, runWorkspaceAction, updateComposer } from '../line-keys.ts';
import { addFolder } from '../line-model.ts';
import { isClean, ownFolders, type CardWorktree } from '../../shared/cards.ts';
import { flash, get, NO_BINDINGS, sessionById, set, setFilter as showWorkspace, useStore, type RepoTarget, type WorkspaceAction } from '../store.ts';
import { cardWorktrees, createSession, detectStack, removeCardWorktrees, saveRecipe, saveStack, send, setSources } from '../ws.ts';
import { BindingsDialog } from './BindingsDialog.tsx';
import { ChangesSheet } from './ChangesSheet.tsx';
import { DeleteDialog, EditDialog, TemplateDialog, VoiceMatchDialog } from './CommandDialogs.tsx';
import { FolderPicker } from './FolderPicker.tsx';
import { Palette } from './Palette.tsx';
import { ReportSheet } from './ReportSheet.tsx';
import { ShipSheet } from './ShipSheet.tsx';
import { TryPick } from './TryPick.tsx';
import { Welcome } from './Welcome.tsx';
import { close, DialogKeys, DialogTitle, Overlay, useDialogKeys } from './Overlay.tsx';
import { Icon, Key, SWATCH, TicketKey, WsBadge } from './ui.tsx';

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
    case 'worktrees': return <WorktreesDialog id={modal.id} thenDelete={modal.thenDelete === true} />;
    case 'recipe': return <RecipeDialog repo={modal.repo} workspaceId={modal.workspaceId} initial={modal.scope} />;
    case 'tryPick': return <TryPick id={modal.id} detect={modal.detect === true} />;
    case 'ship': return <ShipSheet id={modal.id} />;
    case 'report': return <ReportSheet id={modal.id} />;
    case 'changes': return <ChangesSheet id={modal.id} />;
    case 'addFolder': return <AddFolderDialog />;
    case 'pickWorkspace': return <PickWorkspaceDialog then={modal.then} />;
    case 'tickets': return <TicketsDialog />;
  }
}

function HelpOverlay() {
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  const hints = useStore((s) => s.settings.keyHints ?? 'always');
  return (
    <Overlay label="Every key" wide="xl" keepKeys>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="grow text-[19px] font-bold tracking-tight">Every key</h2>
        <button role="switch" aria-checked={hints !== 'never'} onClick={toggleHints} title="Show the shortcut keycaps on every screen, or hide them all (this list always has them). H switches."
          className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1 text-sm hover:bg-raise">
          <span className={`relative inline-block h-4 w-7 rounded-full transition-colors ${hints !== 'never' ? 'bg-acc' : 'bg-line'}`} aria-hidden="true">
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${hints !== 'never' ? 'left-3.5' : 'left-0.5'}`} />
          </span>
          <span className="text-sub">Shortcut hints on the page</span>
          <b>{hints === 'never' ? 'Off' : hints === 'hover' ? 'On hover' : 'On'}</b>
          <Key k="H" size="sm" />
        </button>
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
              return <span key={d} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5" title={`${d}\nFrom the ${owner?.name ?? ''} lane`}><WsBadge ws={owner} size={14} />{repoName(d)}</span>;
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
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [testing, setTesting] = useState(existing?.testing ?? '');
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
    if (!name.trim()) { setError('Give the lane a name.'); return; }
    const workspaceId = existing?.id ?? crypto.randomUUID();
    const homePath = home && repos.some((r) => samePath(r, home)) ? home : undefined;
    send({ type: 'workspace.save', workspace: { id: workspaceId, name: name.trim(), color, repos, home: homePath, notes, testing }, template: existing ? undefined : template });
    showWorkspace(workspaceId);
    set({ modal: null });
  }

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && (e.ctrlKey || !(e.target instanceof HTMLTextAreaElement)) && !(e.target instanceof HTMLElement && e.target.dataset.list)) { e.preventDefault(); save(); }
  };

  const listKey = (e: ReactKeyboardEvent) => {
    const p = shown[index];
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(shown.length - 1, index + listStep(e))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(0, index - listStep(e))); }
    else if ((e.key === ' ' || e.key === 'Enter') && p) { e.preventDefault(); e.stopPropagation(); toggle(p); }
    else if (e.key.toLowerCase() === 'h' && p) { e.preventDefault(); if (!picked(p)) toggle(p); setHome(p); }
  };

  return (
    <Overlay label={existing ? 'Edit lane' : 'New lane'} wide>
      <div onKeyDown={onKey}>
        <DialogTitle>{existing ? 'Edit lane' : 'New lane'}</DialogTitle>
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
              <p className="mb-2 text-sm text-sub">Walk to the folder that holds your repos (for example D:\repos) and press <Key k="Space" size="sm" inline />. Every git repo inside it appears below.</p>
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

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="eyebrow">Notes for Claude · every card</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="field resize-y text-[13.5px] leading-snug"
              placeholder="e.g. The UI proxies to your Okteto namespace. Run okteto up in the API repo first." />
          </label>
          <label className="grid gap-1.5">
            <span className="eyebrow">How this team tests · QA cards</span>
            <textarea value={testing} onChange={(e) => setTesting(e.target.value)} rows={4} className="field resize-y text-[13.5px] leading-snug"
              placeholder="e.g. Test data comes from our scenario tool (npm start in its repo): make one in the state the ticket needs, then check it in the admin." />
          </label>
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
          <DialogKeys items={[['Tab', 'next part'], ['↑ ↓', 'choose repo'], ['Space', 'pick'], ['H', 'home repo'], ['Ctrl Enter', 'save from a note']]} />
          {existing && <button className="btn btn-ghost ml-auto" onClick={() => exportWorkspace(existing.id)} title="Save this lane and its workflows as a file to share (Shift+E on the Ticket Line)"><Icon name="file" size={16} />Export</button>}
          <button className={`btn btn-primary ${existing ? '' : 'ml-auto'}`} onClick={save}>{existing ? 'Save' : 'Create lane'}<Key k="Enter" size="sm" tone="ghost" /></button>
        </div>
      </div>
    </Overlay>
  );
}

/** The new-card screen's Folders tab: any folder on disk, added to the card like an extra repo (--add-dir). */
function AddFolderDialog() {
  const add = async (path: string) => {
    const c = get().composer;
    if (!c) { close(); return; }
    const r = addFolder(c, path);
    if (typeof r === 'string') throw new Error(r);
    updateComposer(() => ({ ...r, tab: 'folders', pane: 'src' }));
    close();
  };
  return (
    <Overlay label="Add a folder" wide>
      <DialogTitle>Add a folder as context</DialogTitle>
      <p className="mb-3 text-sm text-sub">Any folder, git repo or not: specs, docs, a tool’s folder. Claude gets it with --add-dir, so it can read and edit what is inside.</p>
      <FolderPicker useLabel="Add this folder" onUse={add} onEscape={close} />
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
    <Overlay label="Delete lane">
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
  const worktrees = card ? ownFolders(card) : [];
  const doIt = () => { deleteCard(id); close(); };
  useDialogKeys((e) => {
    const k = e.key.toLowerCase();
    if (k === 'y' || k === 'enter') doIt();
    else if (k === 'w' && worktrees.length) openWorktrees(id, true);
    else if (k === 'n' || k === 'escape') close();
    else return false;
    return true;
  });
  return (
    <Overlay label="Remove card">
      <DialogTitle>Take {card ? `${card.key} ${card.title}` : 'this card'} off the line?</DialogTitle>
      <p className="text-sub">Only the card goes. Its terminal tab, session, branch and changes stay as they are.</p>
      {worktrees.length > 0 && <p className="mt-2 text-sub">Its {worktrees.length === 1 ? 'worktree' : `${worktrees.length} worktrees`} ({worktrees.map((f) => repoName(f.dir)).join(', ')}) stay too. <Key k="w" size="sm" inline /> shows what each holds and removes them with the card.</p>}
      <div className="mt-5 flex justify-end gap-2.5">
        <button className="btn" onClick={close}>Keep it<Key k="N" size="sm" /></button>
        {worktrees.length > 0 && <button className="btn" onClick={() => openWorktrees(id, true)}>Worktrees too<Key k="w" size="sm" /></button>}
        <button className="btn btn-primary" onClick={doIt}>Remove<Key k="Y" size="sm" tone="ghost" /></button>
      </div>
    </Overlay>
  );
}

/**
 * Shift+X on a card (or w in the Delete dialog): its worktrees, what each still holds, and
 * removing them with their branch. Clean ones go on Enter; ones with uncommitted or unpushed work
 * need f, after this has said what would be lost. A card still in flight only shows them.
 */
function WorktreesDialog({ id, thenDelete }: { id: string; thenDelete: boolean }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id));
  const [rows, setRows] = useState<CardWorktree[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canRemove = Boolean(card && (card.stage === 'done' || thenDelete));
  useEffect(() => {
    let on = true;
    cardWorktrees(id).then((r) => { if (on) setRows(r.worktrees); }, (e: Error) => { if (on) setError(e.message); });
    return () => { on = false; };
  }, [id]);
  const dirty = rows?.filter((w) => !isClean(w)) ?? [];
  const clean = rows?.filter(isClean) ?? [];
  function remove(force: boolean) {
    if (!rows || busy || !canRemove) return;
    if (!force && !clean.length) { flash(dirty.length ? 'They all hold work: f removes them anyway' : 'Nothing to remove'); return; }
    setBusy(true);
    removeCardWorktrees(id, force, thenDelete).then((r) => {
      if (thenDelete && !r.kept.length) { deleteCard(id); close(); flash(`Removed ${r.removed.length === 1 ? 'the worktree' : `${r.removed.length} worktrees`} and ${card?.key ?? 'the card'}`); return; }
      flash(r.removed.length ? `Removed ${r.removed.map((w) => repoName(w.dir)).join(', ')}` : 'Nothing removed');
      if (r.kept.length) { setRows(r.kept); setBusy(false); } else close();
    }, (e: Error) => { setError(e.message); setBusy(false); });
  }
  useDialogKeys((e) => {
    const k = e.key.toLowerCase();
    if (k === 'enter') remove(false);
    else if (k === 'f') remove(true);
    else if (k === 'escape') close();
    else return false;
    return true;
  });
  const what = (w: CardWorktree) => w.missing ? 'already gone' : [w.changed ? 'uncommitted changes' : '', w.unpushed ? `${w.unpushed} unpushed commit${w.unpushed === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ') || 'clean';
  return (
    <Overlay label="Worktrees" wide>
      <DialogTitle>{card?.key ?? 'The card'}’s worktrees{thenDelete ? ', then the card' : ''}</DialogTitle>
      {error && <p className="mb-3 rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{error}</p>}
      {!rows && !error && <p className="text-sm text-faint">Looking at each folder…</p>}
      {rows && (
        <ul className="grid gap-1.5 text-sm">
          {rows.map((w) => (
            <li key={w.dir} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-line bg-raise px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-mono text-[12.5px]" title={w.dir}>{w.dir}</div>
                <div className="text-xs text-faint">of {repoName(w.repo)}{w.branch ? ` · on ${w.branch}` : ' · detached'}</div>
              </div>
              <span className={`whitespace-nowrap rounded-full px-2 text-[11px] font-semibold ${isClean(w) ? 'bg-ok-bg text-ok' : 'bg-attn-bg text-attn'}`}>{what(w)}</span>
            </li>
          ))}
        </ul>
      )}
      {rows && (
        <p className="mt-3 text-sm text-sub">
          {!canRemove ? <>{card?.key} is still in flight and its session works in these folders. They can go once it is Done, or with the card (<Key k="Delete" size="sm" inline /> then <Key k="w" size="sm" inline />).</>
            : <>Removing a worktree deletes its folder{card?.launch.branch === 'worktree' && card.branchName ? <> and the branch <span className="font-mono text-[12.5px]">{card.branchName}</span> in that repo</> : null}. {dirty.length ? <b>{dirty.length === 1 ? 'One holds' : `${dirty.length} hold`} work that isn’t anywhere else; <Key k="f" size="sm" inline /> removes {dirty.length === 1 ? 'it' : 'them'} anyway.</b> : 'Nothing here is unsaved.'}</>}
        </p>
      )}
      <DialogKeys items={canRemove ? [['Enter', `remove the clean ${clean.length === 1 ? 'one' : 'ones'}`], ['f', 'remove all of them, work and all'], ['Esc', 'keep them']] : [['Esc', 'back']]} />
    </Overlay>
  );
}

/**
 * e in a card's drawer: the run recipe, for its repo or for its whole workspace, one step per line;
 * or the workspace's stack (the APIs t can start and the UI pointed at them), as JSON. Alt+W
 * goes through the three.
 */
function RecipeDialog({ repo, workspaceId, initial }: { repo: string; workspaceId?: string; initial?: 'repo' | 'workspace' | 'table' | 'stack' }) {
  const repoRecipe = useStore((s) => recipeFor(s.recipes, repo));
  const wsEntry = useStore((s) => (workspaceId ? s.recipes[wsRecipeKey(workspaceId)] : undefined));
  const wsName = useStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.name);
  // The workspace's entry is its stack when it has one; its plain recipe is then not in use.
  const stack = wsEntry?.stack;
  const wsRecipe = stack ? undefined : wsEntry;
  // The stack has two tabs: the table (each part a row, e changes it) and the same stack as JSON.
  type Scope = 'repo' | 'workspace' | 'table' | 'stack';
  // Opens on what the card runs: the stack (its table), else the workspace's recipe, else the repo's (or where it was asked to).
  const [scope, setScope] = useState<Scope>(() => (initial && (initial === 'repo' || workspaceId) ? initial : stack ? 'table' : wsRecipe ? 'workspace' : 'repo'));
  // What the workspace's repos say the stack is, read when a stack tab opens: no stack yet, it is the starting point; with one, the table says where they differ.
  const [found, setFound] = useState<Finding[] | null>(null);
  const [detected, setDetected] = useState<Stack | undefined>(undefined);
  const recipe = scope === 'workspace' ? wsRecipe : scope === 'repo' ? repoRecipe : undefined;
  // The stored list (stable), mapped outside the selector: a new array from a selector re-renders forever.
  const wsRepos = useStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.repos);
  const wsRepoNames = (wsRepos ?? []).map(repoName);
  const libNames = useStore((s) => s.library.repos);
  // The stack being edited: the saved one, else a draft from the workspace's own repos (never made-up names) until the repos are read.
  const [draft, setDraft] = useState<Stack>(() => stack ?? stackDraft(wsRepoNames));
  const [touched, setTouched] = useState(false);
  const stackText = (st = draft) => JSON.stringify(st, null, 2);
  // A stack naming repos that aren't here (the old example's orders-api, say) says so.
  const shown = scope === 'table' ? draft : stack;
  const strangers = shown ? unknownStackRepos(shown, [...wsRepoNames, ...libNames.map((r) => r.name)]) : [];
  const warnings = shown ? stackWarnings(shown) : [];
  const textFor = (sc: Scope) => (sc === 'stack' ? stackText() : sc === 'table' ? '' : (sc === 'workspace' ? wsRecipe : repoRecipe)?.steps.join('\n') ?? '');
  const [text, setText] = useState(() => textFor(scope));
  const [url, setUrl] = useState(() => recipe?.url ?? '');
  const [error, setError] = useState<string | null>(null);
  const order: Scope[] = workspaceId ? ['repo', 'workspace', 'table', 'stack'] : ['repo'];
  useEffect(() => {
    if ((scope !== 'stack' && scope !== 'table') || !workspaceId || found) return;
    let on = true;
    detectStack(workspaceId).then((d) => {
      if (!on) return;
      setFound(d.findings);
      setDetected(d.stack);
      // No stack saved: what was found is the starting point, unless something was changed already.
      if (d.stack && !stack && !touched) {
        setDraft(d.stack);
        setText((t) => (t === stackText() ? JSON.stringify(d.stack, null, 2) : t));
      }
    }, () => { if (on) setFound([]); });
    return () => { on = false; };
  }, [scope, stack, workspaceId, found]);
  const switchTo = (next: Scope) => {
    if (next === scope || !order.includes(next)) return;
    // Leaving the JSON: what it says becomes the stack the table shows, if it reads.
    if (scope === 'stack') {
      if (text.trim()) {
        try { setDraft(validateStack(JSON.parse(text))); setTouched(true); } catch (e) { setError(`The JSON can’t be read as a stack: ${(e as Error).message}`); return; }
      }
    }
    // Untouched text follows the switch; edited step text stays, so a repo's recipe can become the workspace's.
    const untouched = text === textFor(scope);
    if (untouched || next === 'stack' || next === 'table' || scope === 'stack' || scope === 'table') { setText(textFor(next)); setUrl((next === 'workspace' ? wsRecipe : next === 'repo' ? repoRecipe : undefined)?.url ?? ''); }
    setError(null);
    setScope(next);
  };
  const save = () => {
    if (scope === 'table' && workspaceId) {
      saveStack(workspaceId, draft).then(close, (e: Error) => setError(e.message));
      return;
    }
    if (scope === 'stack' && workspaceId) {
      let parsed: unknown = null;
      if (text.trim()) {
        try { parsed = JSON.parse(text); } catch (e) { setError(`That isn’t valid JSON: ${(e as Error).message}`); return; }
      }
      saveStack(workspaceId, parsed).then(close, (e: Error) => setError(e.message));
      return;
    }
    const target = scope === 'workspace' && workspaceId ? { workspaceId } : { repo };
    saveRecipe(target, parseSteps(text), url.trim() || undefined).then(close, (e: Error) => setError(e.message));
  };
  const keys = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.altKey && e.key.toLowerCase() === 'w') { e.preventDefault(); switchTo(order[(order.indexOf(scope) + 1) % order.length]); }
  };
  const tab = (id: Scope, label: string, off = false) => (
    <button disabled={off} onClick={() => switchTo(id)} onKeyDown={keys}
      className={`rounded-lg border px-2.5 py-1 text-[13px] ${scope === id ? 'border-ring bg-surface font-semibold text-ink shadow-[0_0_0_2px_color-mix(in_srgb,var(--c-ring)_22%,transparent)]' : 'border-line bg-raise text-sub'} disabled:opacity-50`}>{label}</button>
  );
  return (
    <Overlay label="Run recipe" wide={scope === 'table' ? 'xl' : true}>
      <DialogTitle>Run recipe</DialogTitle>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="eyebrow mr-1">For</span>
        {tab('repo', `This repo: ${repoName(repo)}`)}
        {tab('workspace', workspaceId ? `The whole lane: ${wsName ?? 'this one'}` : 'The whole lane (the card has none)', !workspaceId)}
        {tab('table', workspaceId ? 'The lane’s stack: APIs + UI' : 'A stack (the card has no lane)', !workspaceId)}
        {tab('stack', 'as JSON', !workspaceId)}
        <Key k="Alt W" size="sm" />
      </div>
      <p className="mb-3 text-sm text-sub">
        {scope === 'table'
          ? <>{!stack && <b className="text-ink">{found ? `What ${wsName ?? 'the lane'}’s repos say the stack is: check it and save. ` : `Reading ${wsName ?? 'the lane'}’s repos… `}</b>}Every {wsName ?? ''} card’s <Key k="t" size="sm" inline /> asks the values in the first row and which APIs to run, runs the template’s steps in each picked API’s repo with that API’s values filled in (each on a local port picked for the run), then starts the UI with its proxy file pointed at them. <Key k="e" size="sm" inline /> on a row changes it; the last column says which files it was read from{stack ? ', and where the repos now say otherwise' : ''}.{stack ? ` Now: ${wsEntry?.source}.` : ''}</>
          : scope === 'stack'
          ? <>{!stack && <b className="text-ink">A draft from {wsName ?? 'the lane'}’s repos: change the commands and the proxy file to yours before saving. </b>}Every {wsName ?? ''} card’s <Key k="t" size="sm" inline /> asks which values to use (<code>choose</code>: dev or uat) and which APIs to run. It runs <code>api.steps</code> in each picked API’s repo, with <code>{'{{env}}'}</code>, <code>{'{{branch}}'}</code>, <code>{'{{deployment}}'}</code> (name-branch, cut to 50) and the API’s <code>values</code> filled in. <code>{'{{port}}'}</code> is a local port picked for that run and <code>{'{{uiPort}}'}</code> the UI’s, so two cards can run the same stack at once; <code>{'{{appPort}}'}</code> is the port the API listens on in its container. Then it starts the UI with <code>{'{{proxy}}'}</code>: a copy of <code>ui.proxyFile</code> with each picked API’s proxy rules put first. The repo’s file isn’t touched (<code>"proxyMode": "edit"</code> changes it in place and puts it back on stop). <code>stop:</code> steps run when you stop it.{stack ? ` Now: ${wsEntry?.source}.` : ''}</>
          : scope === 'workspace'
            ? <>Every {wsName ?? ''} card runs this instead of its repo’s, so it can start several repos: a backend, then the UI pointed at it.{stack ? ' The lane has a stack, which is what its cards run; this recipe is kept but not used.' : ''}</>
            : 'Try it runs these in the card’s folder.'}
        {scope !== 'stack' && scope !== 'table' && <>{' '}Steps run one after another; a step that keeps running and serves is the app, and the next step starts.
        {recipe ? ` Now: ${recipe.source}.` : scope === 'repo' ? ' Nothing was detected for this repo.' : ' The lane has none yet.'}</>}
      </p>
      {(scope === 'stack' || scope === 'table') && strangers.length > 0 && (
        <div className="mb-3 rounded-lg bg-attn-bg px-3 py-2 text-[13px] text-attn" role="alert">
          This stack names {strangers.join(', ')}, which {strangers.length === 1 ? 'isn’t a repo' : 'aren’t repos'} in {wsName ?? 'the lane'} or the library{/orders-api|web-ui/.test(strangers.join(' ')) ? ': they are the example’s made-up names' : ''}. Put in your own repos’ folder names{wsRepoNames.length ? ` (${wsRepoNames.join(', ')})` : ''}, or empty the box and save to start again from a draft of your repos.
        </div>
      )}
      {(scope === 'stack' || scope === 'table') && warnings.length > 0 && (
        <ul className="mb-3 grid gap-1 rounded-lg bg-attn-bg px-3 py-2 text-[13px] text-attn" aria-label="Before two cards can run this at once">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {scope === 'stack' && !stack && found && <Findings findings={found} />}
      {scope === 'table' && workspaceId && (
        <StackTable stack={draft} findings={found} detected={stack ? detected : undefined} onChange={(next) => { setDraft(next); setTouched(true); }} onSave={save} onNext={() => switchTo('stack')} />
      )}
      {scope !== 'table' && <>
      <label className="eyebrow mb-1.5 block" htmlFor="recipe-steps">{scope === 'stack' ? 'The stack, as JSON' : 'Steps, one per line'}</label>
      <textarea id="recipe-steps" autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys} rows={scope === 'stack' ? 18 : 7} spellCheck={false}
        placeholder={scope === 'workspace'
          ? '@api okteto deploy --wait\n@web API_URL=https://api-you.okteto.example npm run dev\n! Sign in as a test borrower\nstop: @api okteto destroy'
          : scope === 'stack' ? 'Empty: save to remove the stack' : 'pnpm install\npnpm dev'}
        className="field w-full resize-y font-mono text-[13px]" />
      <div className="mt-1.5 grid gap-0.5 text-[12.5px] text-faint">
        <span><code>@repo</code> runs a step in that repo (by folder name) · <code>NAME=value</code> before the command sets a variable for that step · <code>! …</code> is something to do by hand (shown, not run) · <code>stop: …</code> runs when the app is stopped · <code># …</code> is a comment.</span>
        <span><code>ps:</code> runs the step in PowerShell · <code>wait:"Now listening on"</code>, <code>wait:port:8080</code> or <code>wait:http:8080/health</code> (answers below 500) says when a step that keeps running is ready · <code>answers:"y,n"</code> answers the questions it asks, in order{scope === 'stack' ? <> · an <code>okteto up</code> line runs with a copy of the folder’s okteto.yml forwarding the picked <code>{'{{port}}'}</code> to <code>{'{{appPort}}'}</code> (the copy is never committed); <code>{'forward:{{port}}:{{appPort}}'}</code> says so in so many words, <code>forward:no</code> keeps the manifest’s own forward</> : ''}.</span>
      </div>
      </>}
      {scope !== 'stack' && scope !== 'table' && <>
        <label className="eyebrow mb-1.5 mt-3 block" htmlFor="recipe-url">Where the app will be (optional; otherwise read from what it prints)</label>
        <input id="recipe-url" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={keys} placeholder="http://localhost:5173" className="field w-full font-mono text-[13px]" />
      </>}
      {scope === 'table' ? null : scope === 'stack' ? stack && <p className="mt-2 text-[13px] text-faint">Empty the box and save to remove the stack (cards go back to the workspace’s or the repo’s recipe).</p>
        : recipe?.edited && <p className="mt-2 text-[13px] text-faint">{scope === 'workspace' ? 'Empty the steps and save to remove the lane’s recipe (cards go back to their repo’s).' : 'Empty the steps and save to go back to the detected recipe.'}</p>}
      {error && <div className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{error}</div>}
      <div className="mt-5 flex items-center justify-end gap-2.5">
        <button className="btn" onClick={close}>Cancel<Key k="Esc" size="sm" /></button>
        <button className="btn btn-primary" onClick={save}>Save{scope === 'workspace' ? ' for the lane' : scope === 'stack' || scope === 'table' ? ' the stack' : ''}<Key k={scope === 'table' ? 'Enter' : 'Ctrl Enter'} size="sm" tone="ghost" /></button>
      </div>
    </Overlay>
  );
}

/**
 * What the workspace's repos said the stack is: one line per thing read (✓, with the file) or
 * assumed (?, to check). Shown over the stack editor's box and in t's offer of the found stack.
 */
export function Findings({ findings, title = 'Found in your repos' }: { findings: Finding[]; title?: string }) {
  if (!findings.length) return <p className="mb-3 text-[13px] text-faint">Nothing in the repos says how they run (no okteto.yml, .csproj, angular.json, project.json or package.json). Below is a draft to change.</p>;
  const groups = [...new Set(findings.map((f) => f.repo))];
  return (
    <div className="mb-3 rounded-lg border border-line bg-bg px-3 py-2" aria-label={title}>
      <div className="eyebrow mb-1">{title}</div>
      <ul className="grid gap-0.5 text-[12.5px]">
        {groups.map((g) => (
          <li key={g || '*'} className="grid grid-cols-[7rem_1fr] gap-x-2">
            <span className="truncate font-mono text-[12px] text-sub">{g || 'the stack'}</span>
            <ul className="grid gap-0.5">
              {findings.filter((f) => f.repo === g).map((f, i) => (
                <li key={i} className={f.asked ? 'text-attn' : ''}>
                  <span className={`mr-1.5 font-mono font-bold ${f.asked ? 'text-attn' : 'text-ok'}`}>{f.asked ? '?' : '✓'}</span>{f.text}{f.from && <span className="text-faint"> · {f.from}</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[12px] text-faint">✓ read from that file · ? assumed: check it</p>
    </div>
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
  // Filtered outside the selector: a new array from the selector each time would re-render forever.
  const allTickets = useStore((s) => s.tickets);
  const hidden = useMemo(() => allTickets.filter((t) => t.hidden), [allTickets]);
  const [index, setIndex] = useState(0);
  // ↑ ↓ walk the projects, then the hidden tickets.
  const rows = projects.length + hidden.length;
  const at = Math.max(0, Math.min(index, rows - 1));
  const showAgain = (i: number) => {
    const t = hidden[i - projects.length];
    if (t) send({ type: 'tickets.hide', key: t.key, hidden: false });
  };
  const map = (i: number, delta: number) => {
    const p = projects[i];
    if (!p) return;
    const opts = [null, ...workspaces.map((w) => w.id)];
    const next = opts[(opts.indexOf(p.workspaceId) + delta + opts.length) % opts.length];
    send({ type: 'tickets.map', project: p.id, workspaceId: next });
  };
  useDialogKeys((e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') setIndex(Math.min(rows - 1, at + 1));
    else if (e.key === 'ArrowUp') setIndex(Math.max(0, at - 1));
    else if (e.key === 'ArrowRight') map(at, 1);
    else if (e.key === 'ArrowLeft') map(at, -1);
    else if (e.key === 'd' || e.key === 'D') send({ type: 'tickets.demo', on: !sources?.demo });
    else if (e.key === 'r' || e.key === 'R') send({ type: 'tickets.refresh' });
    else if ((e.key === 'Enter' || e.key === ' ' || e.key === 'Delete') && at >= projects.length) showAgain(at);
    else return false;
    return true;
  });
  return (
    <Overlay label="Tickets" wide>
      <DialogTitle>Tickets</DialogTitle>
      <div className="grid gap-2">
        <SourceLine name="Jira" state={sources?.jira} setup="In ~/.cc-control/config.env: CC_CONTROL_JIRA_SITE and CC_CONTROL_JIRA_TOKEN (Data Center: a personal access token; Cloud: an API token, plus CC_CONTROL_JIRA_EMAIL). Restart the server; pnpm run doctor checks it." />
        <SourceLine name="Trello" state={sources?.trello} setup="In ~/.cc-control/config.env: CC_CONTROL_TRELLO_KEY, CC_CONTROL_TRELLO_TOKEN and CC_CONTROL_TRELLO_BOARDS (board ids). Restart the server." />
        <button onClick={() => send({ type: 'tickets.demo', on: !sources?.demo })} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-left hover:bg-raise">
          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border-[1.5px] border-line font-mono text-xs font-bold text-ok`}>{sources?.demo ? '✓' : ''}</span>
          <span className="grow"><span className="font-semibold">Demo tickets</span><span className="block text-sm text-sub">Made-up Jira and Trello tickets, to try the Inbox before a real site is connected.</span></span>
          <Key k="D" size="sm" />
        </button>
      </div>
      <h3 className="eyebrow mb-2 mt-5">Which lane each project goes to</h3>
      {projects.length ? (
        <ul className="space-y-1" role="listbox" aria-label="Projects">
          {projects.map((p, i) => {
            const ws = workspaces.find((w) => w.id === p.workspaceId) ?? null;
            return (
              <li key={p.id} role="option" aria-selected={i === at} onMouseEnter={() => setIndex(i)}
                className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${i === at ? 'is-focus bg-raise' : ''}`}>
                <span className="w-14 shrink-0 text-xs text-faint">{p.source === 'jira' ? 'Jira' : 'Trello'}</span>
                <span className="min-w-0 grow truncate font-semibold">{p.name}<span className="ml-2 font-normal text-faint">{p.source === 'jira' ? p.id : ''} · {p.count} ticket{p.count === 1 ? '' : 's'}</span></span>
                <button className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:bg-surface hover:text-ink" onClick={() => map(i, -1)} aria-label="Previous lane"><Icon name="back" size={14} /></button>
                <span className="flex w-40 items-center gap-2 truncate text-sm">{ws ? <><WsBadge ws={ws} size={18} />{ws.name}</> : <span className="text-faint">No workspace (All only)</span>}</span>
                <button className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:bg-surface hover:text-ink" onClick={() => map(i, 1)} aria-label="Next lane"><Icon name="right" size={14} /></button>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-faint">No tickets yet, so no projects to map. Connect a source above, or switch on the demo tickets.</p>}
      <h3 className="eyebrow mb-2 mt-5">Hidden from the Inbox</h3>
      {hidden.length ? (
        <ul className="space-y-1" role="listbox" aria-label="Hidden tickets">
          {hidden.map((t, j) => {
            const i = projects.length + j;
            return (
              <li key={t.key} role="option" aria-selected={i === at} onMouseEnter={() => setIndex(i)}
                className={`flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 ${i === at ? 'is-focus bg-raise' : ''}`}>
                <TicketKey k={t.key} source={t.source} />
                <span className="min-w-0 grow truncate text-sm">{t.title}<span className="ml-2 text-faint">{t.status}</span></span>
                <button className="btn py-0.5 text-[13px]" onClick={() => showAgain(i)}>Show in the Inbox<Key k="Enter" size="sm" /></button>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-faint">None. Delete on a ticket in the Inbox hides it here; nothing changes in Jira or Trello. To leave whole groups out, narrow CC_CONTROL_JIRA_JQL instead.</p>}
      <DialogKeys items={[['↑ ↓', 'Project or hidden ticket'], ['← →', 'Workspace'], ['Enter', 'Show a hidden ticket again'], ['D', 'Demo tickets'], ['R', 'Fetch again'], ['Esc', 'Close']]} />
    </Overlay>
  );
}

const PICK_TITLE: Record<WorkspaceAction, string> = {
  addRepo: 'Add a repo to which lane?',
  removeRepo: 'Remove a repo from which lane?',
  edit: 'Edit which lane?',
  share: 'Share which lane?',
  delete: 'Delete which lane?',
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

  const title = target.kind === 'workspace' ? `Add a repo to ${ws?.name ?? 'the lane'}` : 'Let this session work in another repo';
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
          ? 'Sessions in this lane stop using it (a session that is working finishes first). Sessions that run in it leave the lane. The repo itself is untouched.'
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
              <span className="min-w-0 truncate text-xs">from {owner?.name ?? 'its lane'}: remove it there (− on the Ticket Line)</span>
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
          <div className="eyebrow mb-1.5 flex items-center gap-2">Your folders<span className="font-normal normal-case tracking-normal text-faint">· <Key k="Tab" size="sm" inline /> then <Key k="Delete" size="sm" inline /> removes one</span></div>
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
          <span><span className="font-mono">{added}</span> is in your library: {count(added)} repo{count(added) === 1 ? '' : 's'}. Add another, or press <Key k="Esc" size="sm" inline /> when you’re done.</span>
        </p>
      )}
      <FolderPicker onUse={add} onEscape={close} inputRef={pickerInput} onTab={library.sources.length ? () => rows.current[0]?.focus() : undefined} />
    </Overlay>
  );
}
