import { useEffect, useRef, type DragEvent, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SessionSummary, TranscriptItem, Workspace } from '../../shared/protocol.ts';
import { homeRepo, repoName, samePath, workspacesFor } from '../../shared/workspaces.ts';
import { activityShort, turnClock } from '../activity-label.ts';
import { age, BUCKET_TITLE, sessionsIn, statusLabel } from '../home-model.ts';
import { askStop, newSession, openSession } from '../keys.ts';
import { unfolded } from '../folds.ts';
import {
  attention, currentWorkspace, get, useFlags, pendingFor, sameScope, scopes, sessionGroups, set, setScope, toggleBucket, toggleFold, useStore,
  visibleSessions, type HomeCol,
} from '../store.ts';
import { send } from '../ws.ts';
import { useNow } from './ActivityBar.tsx';
import { ApprovalCard } from './Approval.tsx';
import { Icon, Key, Pill, WsBadge } from './ui.tsx';

export const REPO_MIME = 'text/x-cc-repo';

/** Drop a dragged repo card here: `onRepo` gets its path. */
export function dropProps(onRepo: (path: string) => void) {
  return {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(REPO_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDrop: (e: DragEvent) => {
      const path = e.dataTransfer.getData(REPO_MIME);
      if (!path) return;
      e.preventDefault();
      set({ dragging: null });
      onRepo(path);
    },
  };
}

export function Home() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PhoneScopes />
      <div className="flex min-h-0 flex-1">
        <WorkspaceColumn />
        <SessionColumn />
        <PreviewColumn />
      </div>
      <RepoLibrary />
    </div>
  );
}

function Column({ col, title, right, children, className = '' }: { col: HomeCol; title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  const active = useStore((s) => s.homeCol === col);
  return (
    <section
      aria-label={typeof title === 'string' ? title : undefined}
      onMouseDown={() => { if (get().homeCol !== col) set({ homeCol: col }); }}
      className={`flex min-h-0 min-w-0 flex-col border-r border-line ${active ? 'bg-surface shadow-[inset_0_3px_0_var(--c-acc)]' : 'bg-col'} ${className}`}
    >
      <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <h2 className={`eyebrow grow truncate ${active ? '!text-ink' : ''}`}>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

// ---- Workspaces ----------------------------------------------------------------------------

/** The fold button in a column or section header: `folded` points the chevron the way it will open. */
function FoldButton({ folded, onClick, label }: { folded: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-expanded={!folded} aria-label={label} title={`${label} (C)`} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint hover:bg-raise hover:text-ink">
      <Icon name={folded ? 'right' : 'back'} size={15} />
    </button>
  );
}

function WorkspaceColumn() {
  const workspaces = useStore((s) => s.workspaces);
  const scope = useStore((s) => s.scope);
  const sessions = useStore((s) => s.sessions);
  const active = useStore((s) => s.homeCol === 'workspaces');
  const dragging = useStore((s) => s.dragging);
  const folded = useStore((s) => s.folds.workspaces);
  const needIds = useStore((s) => attention(s).map((x) => x.id).join(','));
  const need = new Set(needIds.split(','));
  const all = scopes({ workspaces });
  const rows = all.map((sc, i) => {
    const ws = sc.kind === 'workspace' ? workspaces.find((w) => w.id === sc.id) ?? null : null;
    const list = sessionsIn(sc, sessions, workspaces);
    return {
      sc, ws, list,
      name: ws?.name ?? (workspaces.length ? 'Everything else' : 'All sessions'),
      needs: list.some((x) => need.has(x.id)),
      working: list.some((x) => x.live && (x.status === 'running' || x.background)),
      selected: sameScope(sc, scope),
      digit: sc.kind === 'rest' ? '0' : i < 9 ? String(i + 1) : '',
      drop: ws ? dropProps((path) => { send({ type: 'workspace.addRepo', id: ws.id, path }); }) : {},
    };
  });

  if (folded) {
    return (
      <section
        aria-label="Workspaces"
        onMouseDown={() => { if (!active) set({ homeCol: 'workspaces' }); }}
        className={`hidden w-[4.5rem] shrink-0 flex-col items-center border-r border-line md:flex ${active ? 'bg-surface shadow-[inset_0_3px_0_var(--c-acc)]' : 'bg-col'}`}
      >
        <div className="pb-2 pt-3"><FoldButton folded onClick={() => toggleFold('workspaces')} label="Show the workspace column" /></div>
        <ul className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden pb-3 pt-1" role="listbox" aria-label="Workspaces">
          {rows.map((r) => (
            <li
              key={r.ws?.id ?? 'rest'}
              role="option"
              aria-selected={r.selected}
              aria-label={r.name}
              title={`${r.name}${r.digit ? ` (${r.digit})` : ''} · ${r.list.length} sessions`}
              onClick={() => setScope(r.sc)}
              {...r.drop}
              className={`relative cursor-pointer rounded-xl p-1.5 ${r.selected ? (active ? 'is-focus bg-raise' : 'bg-raise') : 'hover:bg-raise/60'} ${dragging && r.ws ? 'outline-2 outline-dashed outline-acc/60' : ''}`}
            >
              <WsBadge ws={r.ws} size={34} />
              {r.digit && <span className="absolute bottom-0 right-0"><Key k={r.digit} size="sm" /></span>}
              {r.needs ? <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-attn ring-2 ring-col" /> : r.working ? <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-busy ring-2 ring-col" /> : null}
            </li>
          ))}
        </ul>
        <button className="mb-3 grid h-9 w-9 place-items-center rounded-xl text-faint hover:bg-raise hover:text-ink" onClick={() => set({ modal: { kind: 'workspace', id: null } })} title="New workspace (W)" aria-label="New workspace">
          <Icon name="plus" size={18} />
        </button>
      </section>
    );
  }

  return (
    <Column
      col="workspaces"
      title="Workspaces"
      right={<>{workspaces.length > 0 && <Key k="1–9" size="sm" />}<FoldButton folded={false} onClick={() => toggleFold('workspaces')} label="Fold the workspace column" /></>}
      className="hidden w-64 shrink-0 md:flex"
    >
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-3" role="listbox" aria-label="Workspaces">
        {rows.map((r) => (
          <li key={r.ws?.id ?? 'rest'} role="none">
            <div
              role="option"
              aria-selected={r.selected}
              onClick={() => setScope(r.sc)}
              onDoubleClick={() => r.ws && set({ modal: { kind: 'workspace', id: r.ws.id } })}
              {...r.drop}
              className={`mx-2 flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 ${r.selected ? (active ? 'is-focus bg-raise' : 'bg-raise') : 'hover:bg-raise/60'} ${dragging && r.ws ? 'outline-2 outline-dashed outline-acc/60' : ''}`}
            >
              {r.digit ? <Key k={r.digit} size="sm" /> : <span className="w-5" />}
              <WsBadge ws={r.ws} />
              <span className="min-w-0 grow">
                <span className="block truncate font-semibold">{r.name}</span>
                <span className="block truncate text-xs text-faint">
                  {r.ws ? `${r.ws.repos.length} repo${r.ws.repos.length === 1 ? '' : 's'} · ${r.list.length} session${r.list.length === 1 ? '' : 's'}` : `${r.list.length} session${r.list.length === 1 ? '' : 's'}`}
                </span>
              </span>
              {r.needs ? <span className="h-2.5 w-2.5 rounded-full bg-attn" title="Something here needs you" /> : r.working ? <span className="spinner text-busy" title="Working" /> : null}
            </div>
            {r.selected && r.ws && <WorkspaceRepoList ws={r.ws} />}
          </li>
        ))}
      </ul>
      <div className="space-y-2 border-t border-line p-3">
        {!workspaces.length && (
          <p className="text-sm text-sub">Group the repos you work on together into a workspace, like “Storefront” or “Payments”. Every session in it can use all of them.</p>
        )}
        <button className={`btn w-full justify-start ${workspaces.length ? 'btn-ghost' : 'btn-primary'}`} onClick={() => set({ modal: { kind: 'workspace', id: null } })}>
          <Icon name="plus" size={16} />New workspace<Key k="W" size="sm" className="ml-auto" />
        </button>
      </div>
    </Column>
  );
}

/** Under the selected workspace: its repos, which every session in it can use. */
function WorkspaceRepoList({ ws }: { ws: Workspace }) {
  const home = homeRepo(ws);
  const dragging = useStore((s) => s.dragging);
  return (
    <div className={`mx-2 mb-1.5 ml-[3.1rem] mt-1 rounded-lg pl-2.5 ${dragging ? 'outline-1 outline-dashed outline-acc/60' : ''}`} {...dropProps((path) => { send({ type: 'workspace.addRepo', id: ws.id, path }); })}>
      <div className="mb-1 text-xs text-faint" title="Every session in this workspace can read and change all of these repos">Sessions here can use</div>
      <ul className="space-y-0.5" aria-label={`Repos in ${ws.name}`}>
        {ws.repos.map((r) => {
          const isHome = samePath(r, home ?? '');
          return (
            <li key={r} className="group flex items-center gap-1.5 rounded-md py-0.5 text-sm text-sub" title={isHome ? `${r}\nHome: new sessions start here` : r}>
              <Icon name={isHome ? 'home' : 'repo'} size={13} className={isHome ? 'text-acc' : 'text-faint'} />
              <span className="min-w-0 grow truncate">{repoName(r)}</span>
              <button
                className="rounded p-0.5 text-faint opacity-0 hover:bg-surface hover:text-bad focus:opacity-100 group-hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); send({ type: 'workspace.removeRepo', id: ws.id, path: r }); }}
                aria-label={`Remove ${repoName(r)} from ${ws.name}`}
                title="Remove from the workspace (−)"
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 flex items-center gap-3 text-xs text-faint">
        <button className="flex items-center gap-1 hover:text-ink" onClick={() => set({ modal: { kind: 'repoPicker', target: { kind: 'workspace', id: ws.id } } })}>
          <Icon name="plus" size={12} />{dragging ? 'Drop to add' : 'Add'}<Key k="+" size="sm" />
        </button>
        {ws.repos.length > 0 && (
          <button className="flex items-center gap-1 hover:text-ink" onClick={() => set({ modal: { kind: 'repoRemove', target: { kind: 'workspace', id: ws.id } } })}>
            Remove<Key k="−" size="sm" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Phones: the workspace column becomes a row of chips. */
function PhoneScopes() {
  const workspaces = useStore((s) => s.workspaces);
  const scope = useStore((s) => s.scope);
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-line bg-col px-3 py-2 md:hidden">
      {scopes({ workspaces }).map((sc) => {
        const ws = sc.kind === 'workspace' ? workspaces.find((w) => w.id === sc.id) ?? null : null;
        return (
          <button key={ws?.id ?? 'rest'} onClick={() => setScope(sc)} className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${sameScope(sc, scope) ? 'border-acc bg-acc-soft font-semibold' : 'border-line bg-surface'}`}>
            <WsBadge ws={ws} size={20} />{ws?.name ?? (workspaces.length ? 'Everything else' : 'All sessions')}
          </button>
        );
      })}
    </div>
  );
}

// ---- Sessions ------------------------------------------------------------------------------

function SessionColumn() {
  const sessions = useStore((s) => s.sessions);
  const workspaces = useStore((s) => s.workspaces);
  const scope = useStore((s) => s.scope);
  const filter = useStore((s) => s.filter);
  const filterFocused = useStore((s) => s.filterFocused);
  const permissions = useStore((s) => s.permissions);
  const unread = useStore((s) => s.unread);
  const selectedId = useStore((s) => s.selectedId);
  const active = useStore((s) => s.homeCol === 'sessions');
  const activity = useStore((s) => s.activity);
  const folds = useStore((s) => s.folds);
  const now = useNow(Object.values(activity).some((a) => a.phase !== 'idle'));
  const ws = currentWorkspace({ workspaces, scope });
  const groups = sessionGroups({ sessions, workspaces, scope, filter, permissions, unread });
  const list = groups.flatMap((g) => g.sessions);
  const reachable = unfolded(groups, folds);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (filterFocused) filterRef.current?.focus();
    else filterRef.current?.blur();
  }, [filterFocused]);

  // Keep a valid selection when the scope, the filter or a folded group hides the selected row.
  useEffect(() => {
    if (reachable.length && !reachable.some((s) => s.id === selectedId)) set({ selectedId: reachable[0].id });
  }, [reachable, selectedId]);

  const title = ws ? `${ws.name} · sessions` : workspaces.length ? 'Sessions outside your workspaces' : 'All sessions';
  return (
    <Column
      col="sessions"
      title={title}
      className="flex-1 md:w-[27rem] md:flex-none"
      right={
        <button className="btn btn-primary min-h-0 py-1 pl-2.5 pr-1.5 text-sm" onClick={() => newSession()} title="New session in this workspace">
          <Icon name="plus" size={15} />New<Key k="N" size="sm" tone="ghost" />
        </button>
      }
    >
      {ws && <div className="md:hidden"><WorkspaceRepos ws={ws} /></div>}
      {(filterFocused || filter) && (
        <div className="px-3 pb-2">
          <input
            ref={filterRef}
            value={filter}
            onChange={(e) => set({ filter: e.target.value })}
            onFocus={() => set({ filterFocused: true })}
            onBlur={() => set({ filterFocused: false })}
            placeholder="Filter by title, repo or branch"
            aria-label="Filter sessions"
            className="field py-1.5 text-sm"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pb-3" role="listbox" aria-label="Sessions">
        {list.length === 0 && <EmptySessions ws={ws} filtered={Boolean(filter.trim())} />}
        {groups.map((g) => {
          const shut = Boolean(folds.buckets[g.bucket]);
          return (
            <div key={g.bucket} className="mb-1">
              <button
                onClick={() => toggleBucket(g.bucket)}
                aria-expanded={!shut}
                title={shut ? 'Show these sessions' : 'Fold this group (C on a session in it)'}
                className={`mx-2 flex w-[calc(100%-1rem)] items-center gap-1.5 rounded-lg px-3 pb-1 pt-2 text-left text-[13px] font-semibold hover:bg-raise/60 ${g.bucket === 'needs' ? 'text-attn' : 'text-faint'}`}
              >
                <Icon name={shut ? 'right' : 'down'} size={13} />
                {BUCKET_TITLE[g.bucket]} <span className="font-normal">· {g.sessions.length}</span>
                {shut && <span className="ml-auto font-normal text-faint">folded</span>}
              </button>
              {!shut && g.sessions.map((s) => (
                <SessionRow key={s.id} s={s} selected={s.id === selectedId} focused={active && s.id === selectedId} now={now} />
              ))}
            </div>
          );
        })}
      </div>
    </Column>
  );
}

/** The workspace's repos: every session in it can use all of them. Drop a repo card here to add one. */
function WorkspaceRepos({ ws }: { ws: Workspace }) {
  const dragging = useStore((s) => s.dragging);
  const home = homeRepo(ws);
  if (!ws.repos.length) return null; // the empty state below says how to add some
  return (
    <div className={`mx-3 mb-2 flex flex-wrap items-center gap-1.5 rounded-xl px-1.5 py-1 ${dragging ? 'outline-1 outline-dashed outline-acc/60' : ''}`} {...dropProps((path) => { send({ type: 'workspace.addRepo', id: ws.id, path }); })}>
      <span className="text-xs text-faint" title="Every session in this workspace can read and change all of these repos">Sessions here can use</span>
      {ws.repos.map((r) => (
        <span key={r} title={samePath(r, home ?? '') ? `${r}\nHome: new sessions start here` : r} className="inline-flex items-center gap-1 rounded-full border border-line bg-raise py-0.5 pl-2 pr-0.5 text-xs">
          {samePath(r, home ?? '') && <Icon name="home" size={12} className="text-acc" />}{repoName(r)}
          <button className="rounded-full p-0.5 text-faint hover:bg-surface hover:text-bad" onClick={() => send({ type: 'workspace.removeRepo', id: ws.id, path: r })} aria-label={`Remove ${repoName(r)} from ${ws.name}`}>
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
      <button className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2 py-0.5 text-xs text-faint hover:text-ink" onClick={() => set({ modal: { kind: 'repoPicker', target: { kind: 'workspace', id: ws.id } } })}>
        <Icon name="plus" size={11} />{dragging ? 'Drop to add' : 'Add'}<Key k="+" size="sm" />
      </button>
      <button className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs text-faint hover:text-ink" onClick={() => set({ modal: { kind: 'repoRemove', target: { kind: 'workspace', id: ws.id } } })}>
        Remove<Key k="−" size="sm" />
      </button>
    </div>
  );
}

function EmptySessions({ ws, filtered }: { ws: Workspace | null; filtered: boolean }) {
  if (filtered) return <p className="px-5 py-6 text-sub">No sessions match. <Key k="Esc" size="sm" /> clears the filter.</p>;
  if (ws && !ws.repos.length) {
    return (
      <div className="m-4 space-y-3 rounded-xl border border-dashed border-line p-4 text-sub">
        <p><strong className="text-ink">{ws.name}</strong> has no repos yet. Drag some in from the repo library below, or press <Key k="+" size="sm" />.</p>
        <button className="btn" onClick={() => set({ modal: { kind: 'repoPicker', target: { kind: 'workspace', id: ws.id } } })}><Icon name="plus" size={16} />Add a repo</button>
      </div>
    );
  }
  return (
    <div className="m-4 space-y-3 rounded-xl border border-dashed border-line p-4 text-sub">
      <p>No sessions {ws ? `in ${ws.name}` : 'here'} yet.</p>
      <button className="btn btn-primary" onClick={() => newSession()}><Icon name="plus" size={16} />Start a session<Key k="N" size="sm" tone="ghost" /></button>
    </div>
  );
}

function StatusIcon({ s, needs }: { s: SessionSummary; needs: boolean }) {
  if (needs) return <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-attn" />;
  if (s.live && (s.status === 'running' || s.background)) return <span className="spinner text-busy" />;
  if (s.live && s.status === 'idle') return <Icon name="check" size={16} className="text-ok" />;
  return <span className="w-2.5 shrink-0" />;
}

/** "web-app", or "web-app + cdn-worker" when the session works in more repos. */
export function reposLabel(s: SessionSummary): string {
  const extra = s.extraDirs?.length ?? 0;
  return `${repoName(s.cwd) || 'no folder'}${extra ? ` + ${extra === 1 ? repoName(s.extraDirs![0]) : `${extra} more`}` : ''}`;
}

function SessionRow({ s, selected, focused, now }: { s: SessionSummary; selected: boolean; focused: boolean; now: number }) {
  const flags = useFlags(s.id);
  const activity = useStore((st) => st.activity[s.id]);
  const dragging = useStore((st) => st.dragging);
  const status = statusLabel(s, flags);
  const needs = flags.pending || flags.unread || s.status === 'requires_action';
  const doing = s.live ? activityShort(activity, s.cwd) : null;
  const clock = s.live ? turnClock(activity, now) : null;
  return (
    <div
      id={`row-${s.id}`}
      role="option"
      aria-selected={selected}
      // Mouse: click selects, double-click opens. Touch/pen: a tap opens straight away.
      onPointerUp={(e) => (e.pointerType === 'mouse' ? set({ selectedId: s.id, homeCol: 'sessions' }) : openSession(s.id))}
      onDoubleClick={() => openSession(s.id)}
      {...dropProps((path) => { send({ type: 'session.addDir', id: s.id, path }); })}
      className={`mx-2 flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ${focused ? 'is-focus bg-raise' : selected ? 'bg-raise' : 'hover:bg-raise/60'} ${dragging ? 'outline-1 outline-dashed outline-line' : ''}`}
    >
      <StatusIcon s={s} needs={needs} />
      <span className="min-w-0 grow">
        <span className={`block truncate ${needs ? 'font-semibold' : 'font-medium'}`}>{s.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-faint">
          <Icon name="repo" size={13} />
          <span className="truncate">{reposLabel(s)}{doing ? ` · ${doing}` : status.text && !needs && status.tone !== 'green' ? ` · ${status.text}` : ''}</span>
        </span>
      </span>
      {needs ? <Pill tone="amber">{flags.pending || s.status === 'requires_action' ? 'Your OK' : 'Your turn'}</Pill>
        : clock ? <span className="font-mono text-[13px] tabular-nums text-busy">{clock}</span>
        : <span className="text-[13px] tabular-nums text-faint">{age(s.lastModified)}</span>}
    </div>
  );
}

// ---- Preview -------------------------------------------------------------------------------

const EMPTY: TranscriptItem[] = [];

function PreviewColumn() {
  const selectedId = useStore((s) => {
    const visible = visibleSessions(s);
    return visible.some((x) => x.id === s.selectedId) ? s.selectedId : null;
  });
  const s = useStore((st) => st.sessions.find((x) => x.id === selectedId));
  const items = useStore((st) => (selectedId ? st.transcripts[selectedId] ?? EMPTY : EMPTY));
  const loaded = useStore((st) => Boolean(selectedId && st.transcripts[selectedId]));
  const request = useStore((st) => Object.values(st.permissions).find((p) => p.sessionId === selectedId));
  const flags = useFlags(selectedId);
  const workspaces = useStore((st) => st.workspaces);

  // Load the transcript of whatever is selected, after the selection settles.
  useEffect(() => {
    if (!selectedId || loaded) return;
    const t = setTimeout(() => send({ type: 'session.open', id: selectedId }), 200);
    return () => clearTimeout(t);
  }, [selectedId, loaded]);

  if (!s) {
    return (
      <Column col="preview" title="Preview" className="hidden flex-1 border-r-0 lg:flex">
        <p className="px-5 text-sub">Select a session to see where it is up to.</p>
      </Column>
    );
  }
  const status = statusLabel(s, flags);
  const talk = recentExchanges(items, 3);
  const ws = workspacesFor(s.cwd, workspaces)[0] ?? null;
  return (
    <Column
      col="preview"
      title="Preview"
      className="hidden flex-1 border-r-0 lg:flex"
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
        <div>
          <h3 className="text-[22px] font-bold leading-tight tracking-tight">{s.title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-faint">
            {status.text && <Pill tone={status.tone} spin={status.tone === 'blue'}>{status.text}</Pill>}
            <span>{s.branch && s.branch !== 'HEAD' ? `${s.branch} · ` : ''}{age(s.lastModified)} ago</span>
          </div>
        </div>
        <ContextChips s={s} ws={ws} />
        {request && <ApprovalCard p={request} cwd={s.cwd} compact sessionId={s.id} />}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => openSession(s.id)}>{s.live ? 'Open' : 'Open and continue'}<Key k="Enter" size="sm" tone="ghost" /></button>
          <button className="btn" onClick={() => set({ modal: { kind: 'rename', id: s.id } })}>Rename<Key k="R" size="sm" /></button>
          {s.live && <button className="btn" onClick={() => askStop(s.id)}>End session<Key k="X" size="sm" /></button>}
        </div>
        {!request && talk.length > 0 && (
          <div className="space-y-4 border-t border-line pt-4">
            <div className="eyebrow">Recent conversation</div>
            {talk.map((t, i) => (
              <div key={t.key} className="space-y-1.5">
                {t.you && <p className="line-clamp-2 rounded-xl bg-acc-soft/60 px-3 py-1.5 text-sm text-sub"><span className="font-semibold text-ink">You: </span>{t.you}</p>}
                {t.claude && (
                  <div className={`md text-[14.5px] text-sub ${i === talk.length - 1 ? 'line-clamp-[14]' : 'line-clamp-4'}`}>
                    <Markdown remarkPlugins={[remarkGfm]}>{t.claude.slice(0, 1500)}</Markdown>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {!request && !talk.length && <p className="text-sub">{loaded ? 'Nothing said yet.' : 'Loading…'}</p>}
      </div>
    </Column>
  );
}

/** The last `n` turns as (your message, Claude's last reply to it), oldest first, for the preview. */
function recentExchanges(items: TranscriptItem[], n: number): { key: string; you?: string; claude?: string }[] {
  const out: { key: string; you?: string; claude?: string }[] = [];
  for (const it of items) {
    if (it.kind === 'user') out.push({ key: it.uuid, you: it.text });
    else if (it.kind === 'assistant') {
      if (!out.length) out.push({ key: it.uuid });
      out[out.length - 1].claude = it.text;
    }
  }
  return out.slice(-n);
}

/**
 * The repos a session can use, as chips: its own, its workspace's (removed from the workspace),
 * and ones added to it alone (× takes them out). Drop a repo card here to add one.
 */
export function ContextChips({ s, ws, onAdd, removable = false }: { s: SessionSummary; ws: Workspace | null; onAdd?: () => void; removable?: boolean }) {
  const dragging = useStore((st) => st.dragging);
  const workspaces = useStore((st) => st.workspaces);
  const fromWs = s.workspaceDirs ?? [];
  const own = (s.extraDirs ?? []).filter((d) => !fromWs.some((w) => samePath(w, d)));
  const ownerOf = (d: string) => workspacesFor(s.cwd, workspaces).find((w) => w.repos.some((r) => samePath(r, d))) ?? null;
  return (
    <div className="flex flex-wrap items-center gap-2" {...dropProps((path) => { send({ type: 'session.addDir', id: s.id, path }); })}>
      <span className="text-sm text-faint">Claude can use</span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raise py-0.5 pl-1 pr-3 text-sm" title={s.cwd}>
        <WsBadge ws={ws} size={20} />{repoName(s.cwd)}<span className="text-faint">{s.branch && s.branch !== 'HEAD' ? s.branch : 'home'}</span>
      </span>
      {fromWs.map((d) => {
        const owner = ownerOf(d);
        return (
          <span key={d} className="inline-flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-1.5 pr-3 text-sm" title={`${d}\nFrom the ${owner?.name ?? ''} workspace: every session there can use it. Remove it from the workspace (− on home).`}>
            <WsBadge ws={owner} size={16} />{repoName(d)}
          </span>
        );
      })}
      {own.map((d) => (
        <span key={d} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raise py-0.5 pl-2.5 pr-1.5 text-sm" title={`${d}\nAdded to this session only.`}>
          <Icon name="link" size={13} className="text-faint" />{repoName(d)}
          {removable && (
            <button className="rounded-full p-0.5 text-faint hover:bg-surface hover:text-bad" onClick={() => send({ type: 'session.removeDir', id: s.id, path: d })} aria-label={`Stop working in ${repoName(d)}`}>
              <Icon name="x" size={13} />
            </button>
          )}
        </span>
      ))}
      <button
        onClick={onAdd ?? (() => set({ modal: { kind: 'repoPicker', target: { kind: 'session', id: s.id } } }))}
        className={`inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-0.5 text-sm ${dragging ? 'border-acc bg-acc-soft text-acc' : 'border-line text-faint hover:text-ink'}`}
      >
        <Icon name="plus" size={13} />{dragging ? 'Drop here to add' : 'Add a repo'}<Key k="+" size="sm" />
      </button>
    </div>
  );
}

// ---- Repo library ---------------------------------------------------------------------------

function RepoLibrary() {
  const library = useStore((s) => s.library);
  const workspaces = useStore((s) => s.workspaces);
  const libIndex = useStore((s) => s.libIndex);
  const active = useStore((s) => s.homeCol === 'library');
  const folded = useStore((s) => s.folds.library);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) listRef.current?.querySelector(`[data-i="${libIndex}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, libIndex]);

  const memberOf = (path: string) => workspaces.filter((w) => w.repos.some((r) => samePath(r, path)));
  const sources = library.sources.map(repoName).join(', ');
  if (folded && !active && library.sources.length > 0) {
    return (
      <section aria-label="Repo library" className="hidden items-center gap-2 border-t border-line bg-col px-4 py-1.5 md:flex">
        <FoldButton folded onClick={() => toggleFold('library')} label="Show the repo library" />
        <button className="eyebrow hover:!text-ink" onClick={() => set({ homeCol: 'library' })}>Repo library</button>
        <span className="text-xs text-faint" title={library.sources.join('\n')}>{library.repos.length} repos from {sources}</span>
        <span className="ml-auto flex items-center gap-1.5 text-sm text-faint"><Key k="Tab" size="sm" />opens it</span>
      </section>
    );
  }
  return (
    <section
      aria-label="Repo library"
      onMouseDown={() => { if (!active) set({ homeCol: 'library' }); }}
      className={`hidden border-t border-line px-4 pb-3 pt-2.5 md:block ${active ? 'bg-surface shadow-[inset_0_3px_0_var(--c-acc)]' : 'bg-col'}`}
    >
      <div className="mb-2 flex items-center gap-2">
        {library.sources.length > 0 && <FoldButton folded={false} onClick={() => { toggleFold('library'); set({ homeCol: 'sessions' }); }} label="Fold the repo library" />}
        <h2 className={`eyebrow ${active ? '!text-ink' : ''}`}>Repo library</h2>
        {library.sources.length > 0 && <span className="truncate text-xs text-faint" title={library.sources.join('\n')}>{library.repos.length} repos from {sources}</span>}
        <span className="ml-auto hidden text-sm text-faint lg:inline">Drag a repo onto a workspace or a session</span>
        <button className="btn btn-ghost min-h-0 py-1 text-sm" onClick={() => set({ modal: { kind: 'sources' } })}><Icon name="folder" size={15} />Folders<Key k="F" size="sm" /></button>
        <Key k="Tab" size="sm" />
      </div>
      {library.sources.length === 0 ? (
        <button onClick={() => set({ modal: { kind: 'sources' } })} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3 text-left text-sub hover:bg-raise">
          <Icon name="folder" size={20} />
          <span><strong className="text-ink">Where do you keep your repos?</strong> Pick the folder (for example <span className="font-mono text-sm">{library.suggested[0] ?? 'C:\\repos'}</span>) and every repo in it shows up here, ready to drag into a workspace.</span>
        </button>
      ) : (
        <div ref={listRef} className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Repos">
          {library.repos.map((r, i) => {
            const member = memberOf(r.path);
            const focused = active && i === libIndex;
            return (
              <div
                key={r.path}
                data-i={i}
                role="option"
                aria-selected={focused}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData(REPO_MIME, r.path); e.dataTransfer.effectAllowed = 'copy'; set({ dragging: r.path }); }}
                onDragEnd={() => set({ dragging: null })}
                onClick={() => set({ libIndex: i, homeCol: 'library' })}
                onDoubleClick={() => newSession(r.path)}
                title={`${r.path}\nDrag onto a workspace or session · double-click for a new session`}
                className={`flex w-48 shrink-0 cursor-grab items-center gap-2 rounded-xl border bg-surface px-2.5 py-2 active:cursor-grabbing ${focused ? 'is-focus border-transparent' : 'border-line hover:bg-raise'}`}
              >
                <Icon name="grip" size={15} className="text-faint" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{r.name}</span>
                  <span className="flex items-center gap-1 truncate text-xs text-faint">
                    {member.length ? member.map((w) => <WsBadge key={w.id} ws={w} size={12} />) : null}
                    <span className="truncate">{member.length ? member.map((w) => w.name).join(', ') : r.branch ?? 'not in a workspace'}</span>
                  </span>
                </span>
              </div>
            );
          })}
          {library.repos.length === 0 && <p className="py-2 text-sm text-sub">No git repos found in those folders.</p>}
        </div>
      )}
    </section>
  );
}
