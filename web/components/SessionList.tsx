import { useEffect, useRef, type ReactNode } from 'react';
import type { SessionSummary, TranscriptItem } from '../../shared/protocol.ts';
import { openSession, respondPermission } from '../keys.ts';
import { attention, set, TABS, useStore, visibleSessions } from '../store.ts';
import { activityShort } from '../activity-label.ts';
import { useNow } from './ActivityBar.tsx';
import { CtxMeter, relativeTime, shortPath, StatusBadge } from './StatusBadge.tsx';

export function SessionList() {
  const sessions = useStore((s) => s.sessions);
  const permissions = useStore((s) => s.permissions);
  const unread = useStore((s) => s.unread);
  const tab = useStore((s) => s.tab);
  const filter = useStore((s) => s.filter);
  const filterFocused = useStore((s) => s.filterFocused);
  const selectedId = useStore((s) => s.selectedId);
  const list = visibleSessions({ sessions, tab, filter, permissions, unread });
  const activity = useStore((s) => s.activity);
  const now = useNow(Object.values(activity).some((a) => a.phase !== 'idle'));
  const counts = {
    inbox: attention({ sessions, permissions, unread }).length,
    live: sessions.filter((s) => s.live).length,
    history: sessions.length,
  };
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (filterFocused) filterRef.current?.focus();
    else filterRef.current?.blur();
  }, [filterFocused]);

  // Keep a valid selection when the tab or filter hides the selected row.
  useEffect(() => {
    if (list.length && !list.some((s) => s.id === selectedId)) set({ selectedId: list[0].id });
  }, [list, selectedId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-2 py-2 md:gap-3 md:px-4">
        <div className="flex gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => set({ tab: t })}
              className={`rounded px-3 py-1 text-sm capitalize ${tab === t ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'} ${
                t === 'inbox' && counts.inbox ? 'text-amber-300' : ''
              }`}
            >
              {t} {counts[t]}
            </button>
          ))}
          <span className="hidden self-center pl-1 text-xs text-zinc-600 md:inline"><kbd>Tab</kbd></span>
        </div>
        <input
          ref={filterRef}
          value={filter}
          onChange={(e) => set({ filter: e.target.value })}
          onFocus={() => set({ filterFocused: true })}
          onBlur={() => set({ filterFocused: false })}
          placeholder="Filter  ( / )"
          className="ml-auto w-28 min-w-0 rounded border md:w-72 border-zinc-800 bg-zinc-900 px-2 py-1 text-sm outline-none focus:border-sky-600"
        />
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Sessions">
        {list.length === 0 && <EmptyState tab={tab} filtered={Boolean(filter.trim())} />}
        {list.map((s) => (
          <li
            key={s.id}
            id={`row-${s.id}`}
            role="option"
            aria-selected={s.id === selectedId}
            // Mouse: click selects, double-click opens. Touch/pen: a tap opens straight away.
            onPointerUp={(e) => (e.pointerType === 'mouse' ? set({ selectedId: s.id }) : openSession(s.id))}
            onDoubleClick={() => openSession(s.id)}
            className={`cursor-default border-l-2 px-2 py-2 text-sm md:px-4 ${
              s.id === selectedId ? 'border-sky-500 bg-zinc-800/70' : 'border-transparent hover:bg-zinc-900'
            } ${s.status === 'requires_action' ? 'bg-amber-950/40' : ''}`}
          >
            <div className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-2 md:grid-cols-[7.5rem_1fr_16rem_3rem] md:gap-3">
              <StatusBadge s={s} />
              <span className="flex min-w-0 items-center gap-2">
                {unread[s.id] && <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400" title="Finished while you were away" />}
                <span className={`truncate ${unread[s.id] ? 'font-medium text-white' : 'text-zinc-100'}`} title={s.title}>{s.title}</span>
                {s.live && activityShort(activity[s.id], now) && (
                  <span className="shrink-0 text-xs text-sky-400/80">{activityShort(activity[s.id], now)}</span>
                )}
              </span>
              <span className="hidden min-w-0 items-center gap-2 text-zinc-500 md:flex" title={s.cwd}>
                <span className="truncate">{shortPath(s.cwd)}{s.branch && <span className="text-zinc-600"> · {s.branch}</span>}</span>
                <CtxMeter pct={s.ctxPct} />
              </span>
              <span className="text-right text-zinc-600">{relativeTime(s.lastModified)}</span>
            </div>
            {tab === 'inbox' && <InboxDetail s={s} selected={s.id === selectedId} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ tab, filtered }: { tab: string; filtered: boolean }) {
  let body: ReactNode = 'No sessions match.';
  if (!filtered && tab === 'inbox') body = <>Nothing needs you. Approvals and finished turns land here; <kbd>Alt+N</kbd> jumps to them from anywhere.</>;
  else if (!filtered && tab === 'live') body = <>No live sessions. Press <kbd>N</kbd> to start one, or <kbd>Tab</kbd> for history.</>;
  return <li className="p-8 text-center text-zinc-500">{body}</li>;
}

const EMPTY: TranscriptItem[] = [];

/** Inbox rows show what's being asked (answerable in place) or how the turn ended. */
function InboxDetail({ s, selected }: { s: SessionSummary; selected: boolean }) {
  const request = useStore((st) => Object.values(st.permissions).find((p) => p.sessionId === s.id));
  const items = useStore((st) => st.transcripts[s.id] ?? EMPTY);
  if (request) {
    return (
      <div className="mt-1.5 flex md:ml-[8.25rem] items-center gap-3 text-xs">
        <span className="shrink-0 text-amber-200">Allow <span className="font-mono">{request.tool}</span>?</span>
        <span className="truncate font-mono text-zinc-400">{request.input}</span>
        <span className={`ml-auto flex shrink-0 gap-1.5 ${selected ? '' : 'opacity-50'}`}>
          <button className="btn" onClick={() => respondPermission('allow', s.id)}><kbd>Y</kbd></button>
          {request.canAlways && <button className="btn" onClick={() => respondPermission('always', s.id)}><kbd>A</kbd></button>}
          <button className="btn" onClick={() => respondPermission('deny', s.id)}><kbd>N</kbd></button>
        </span>
      </div>
    );
  }
  const last = [...items].reverse().find((i) => i.kind === 'assistant');
  return (
    <div className="mt-1 truncate md:ml-[8.25rem] text-xs text-zinc-500">
      {last?.kind === 'assistant' ? last.text.replace(/\s+/g, ' ').slice(0, 200) : 'Finished its turn.'}
    </div>
  );
}
