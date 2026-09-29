import { useEffect, useRef, type DragEvent, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SessionSummary, TranscriptItem, Workspace } from '../../shared/protocol.ts';
import { repoName, samePath, workspacesFor } from '../../shared/workspaces.ts';
import { activityShort, turnClock } from '../activity-label.ts';
import { age, BUCKET_TITLE, sessionsIn, statusLabel } from '../home-model.ts';
import { askStop, newSession, openSession } from '../keys.ts';
import {
  attention, currentWorkspace, get, useFlags, pendingFor, sameScope, scopes, sessionGroups, set, setScope, useStore, visibleSessions,
  type HomeCol,
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

function WorkspaceColumn() {
  const workspaces = useStore((s) => s.workspaces);
  const scope = useStore((s) => s.scope);
  const sessions = useStore((s) => s.sessions);
  const active = useStore((s) => s.homeCol === 'workspaces');
  const dragging = useStore((s) => s.dragging);
  const needIds = useStore((s) => attention(s).map((x) => x.id).join(','));
  const need = new Set(needIds.split(','));
  const all = scopes({ workspaces });

  return (
    <Column col="workspaces" title="Workspaces" right={workspaces.length > 0 && <Key k="1–9" size="sm" />} className="hidden w-64 shrink-0 md:flex">
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-3" role="listbox" aria-label="Workspaces">
        {all.map((sc, i) => {
          const ws = sc.kind === 'workspace' ? workspaces.find((w) => w.id === sc.id) ?? null : null;
          const list = sessionsIn(sc, sessions, workspaces);
          const needs = list.some((x) => need.has(x.id));
          const working = list.some((x) => x.live && (x.status === 'running' || x.background));
          const selected = sameScope(sc, scope);
          const digit = sc.kind === 'rest' ? '0' : i < 9 ? String(i + 1) : '';
          return (
            <li
              key={ws?.id ?? 'rest'}
              role="option"
              aria-selected={selected}
              onClick={() => setScope(sc)}
              onDoubleClick={() => ws && set({ modal: { kind: 'workspace', id: ws.id } })}
              {...(ws ? dropProps((path) => { send({ type: 'workspace.addRepo', id: ws.id, path }); }) : {})}
              className={`mx-2 flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 ${selected ? (active ? 'is-focus bg-raise' : 'bg-raise') : 'hover:bg-raise/60'} ${dragging && ws ? 'outline-2 outline-dashed outline-acc/60' : ''}`}
            >
              {digit ? <Key k={digit} size="sm" /> : <span className="w-5" />}
              <WsBadge ws={ws} />
              <span className="min-w-0 grow">
                <span className="block truncate font-semibold">{ws?.name ?? (workspaces.length ? 'Everything else' : 'All sessions')}</span>
                <span className="block truncate text-xs text-faint">
                  {ws ? `${ws.repos.length} repo${ws.repos.length === 1 ? '' : 's'} · ${list.length} session${list.length === 1 ? '' : 's'}` : `${list.length} session${list.length === 1 ? '' : 's'}`}
                </span>
              </span>
              {needs ? <span className="h-2.5 w-2.5 rounded-full bg-attn" title="Something here needs you" /> : working ? <span className="spinner text-busy" title="Working" /> : null}
            </li>
          );
        })}
      </ul>
      <div className="space-y-2 border-t border-line p-3">
        {!workspaces.length && (
          <p className="text-sm text-sub">Group the repos you work on together into a workspace, like “Storefront” or “Payments”.</p>
        )}
        <button className={`btn w-full justify-start ${workspaces.length ? 'btn-ghost' : 'btn-primary'}`} onClick={() => set({ modal: { kind: 'workspace', id: null } })}>
          <Icon name="plus" size={16} />New workspace<Key k="W" size="sm" className="ml-auto" />
        </button>
      </div>
    </Column>
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
      <button onClick={() => newSession()} className="btn btn-primary ml-auto shrink-0 rounded-full"><Icon name="plus" size={16} />New</button>
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
  const now = useNow(Object.values(activity).some((a) => a.phase !== 'idle'));
  const ws = currentWorkspace({ workspaces, scope });
  const groups = sessionGroups({ sessions, workspaces, scope, filter, permissions, unread });
  const list = groups.flatMap((g) => g.sessions);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (filterFocused) filterRef.current?.focus();
    else filterRef.current?.blur();
  }, [filterFocused]);

  // Keep a valid selection when the scope or filter hides the selected row.
  useEffect(() => {
    if (list.length && !list.some((s) => s.id === selectedId)) set({ selectedId: list[0].id });
  }, [list, selectedId]);

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
        {groups.map((g) => (
          <div key={g.bucket} className="mb-1">
            <div className={`px-5 pb-1 pt-2 text-[13px] font-semibold ${g.bucket === 'needs' ? 'text-attn' : 'text-faint'}`}>
              {BUCKET_TITLE[g.bucket]} <span className="font-normal">· {g.sessions.length}</span>
            </div>
            {g.sessions.map((s) => (
              <SessionRow key={s.id} s={s} selected={s.id === selectedId} focused={active && s.id === selectedId} now={now} />
            ))}
          </div>
        ))}
      </div>
    </Column>
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
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-line" />;
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
  const last = [...items].reverse().find((i) => i.kind === 'assistant');
  const ws = workspacesFor(s.cwd, workspaces)[0] ?? null;
  return (
    <Column
      col="preview"
      title="Preview"
      className="hidden flex-1 border-r-0 lg:flex"
      right={<button className="btn btn-ghost min-h-0 py-1 text-sm" onClick={() => openSession(s.id)}>Open<Key k="Enter" size="sm" /></button>}
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
        {!request && last?.kind === 'assistant' && (
          <div>
            <div className="eyebrow mb-1.5">Last from Claude</div>
            <div className="md line-clamp-[12] text-[14.5px] text-sub"><Markdown remarkPlugins={[remarkGfm]}>{last.text.slice(0, 1500)}</Markdown></div>
          </div>
        )}
        {!request && !last && <p className="text-sub">{loaded ? 'No replies yet.' : 'Loading…'}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button className="btn" onClick={() => set({ modal: { kind: 'rename', id: s.id } })}>Rename<Key k="R" size="sm" /></button>
          {s.live && <button className="btn" onClick={() => askStop(s.id)}>End session<Key k="X" size="sm" /></button>}
        </div>
      </div>
    </Column>
  );
}

/** The repos a session works in, as chips; drop a repo card here to add one. */
export function ContextChips({ s, ws, onAdd, removable = false }: { s: SessionSummary; ws: Workspace | null; onAdd?: () => void; removable?: boolean }) {
  const dragging = useStore((st) => st.dragging);
  return (
    <div className="flex flex-wrap items-center gap-2" {...dropProps((path) => { send({ type: 'session.addDir', id: s.id, path }); })}>
      <span className="text-sm text-faint">Works in</span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raise py-0.5 pl-1 pr-3 text-sm" title={s.cwd}>
        <WsBadge ws={ws} size={20} />{repoName(s.cwd)}<span className="text-faint">{s.branch && s.branch !== 'HEAD' ? s.branch : 'home'}</span>
      </span>
      {s.extraDirs?.map((d) => (
        <span key={d} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raise py-0.5 pl-2.5 pr-1.5 text-sm" title={d}>
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
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) listRef.current?.querySelector(`[data-i="${libIndex}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, libIndex]);

  const memberOf = (path: string) => workspaces.filter((w) => w.repos.some((r) => samePath(r, path)));
  return (
    <section
      aria-label="Repo library"
      onMouseDown={() => { if (!active) set({ homeCol: 'library' }); }}
      className={`hidden border-t border-line px-4 pb-3 pt-2.5 md:block ${active ? 'bg-surface shadow-[inset_0_3px_0_var(--c-acc)]' : 'bg-col'}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className={`eyebrow ${active ? '!text-ink' : ''}`}>Repo library</h2>
        <span className="truncate font-mono text-xs text-faint">{library.sources.join('  ·  ')}</span>
        {library.sources.length > 0 && <span className="text-xs text-faint">· {library.repos.length} repos</span>}
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
