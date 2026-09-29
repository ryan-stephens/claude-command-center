import { listStep } from '../list-step.ts';
import { useMemo, useRef, useState } from 'react';
import { repoName } from '../../shared/workspaces.ts';
import { exportPack, exportWorkspace, fireCommand, importPack, importWorkspace } from '../commands.ts';
import { fuzzyScore } from '../fuzzy.ts';
import { askStop, cycleTheme, hop, interrupt, jumpToAttention, newSession, openSession } from '../keys.ts';
import { taskKind, taskRunning } from '../activity-label.ts';
import { currentWorkspace, get, set, setScope, toggleSound, useStore } from '../store.ts';
import { send } from '../ws.ts';
import { close, DialogKeys, Overlay } from './Overlay.tsx';

interface Item {
  key: string;
  kind: 'Action' | 'Workflow' | 'Session' | 'Workspace';
  label: string;
  detail?: string;
  run: () => void;
}

const MAX_RESULTS = 12;
const home = () => set({ screen: 'list', openId: null, homeCol: 'sessions' });

/** Ctrl+K: fuzzy search over actions, workspaces, the open session's workflows, and every session. */
export function Palette() {
  const sessions = useStore((s) => s.sessions);
  const workspaces = useStore((s) => s.workspaces);
  const board = useStore((s) => s.board);
  const openId = useStore((s) => s.openId);
  const activity = useStore((s) => (s.openId ? s.activity[s.openId] : undefined));
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo<Item[]>(() => {
    const open = sessions.find((s) => s.id === openId);
    const ws = currentWorkspace(get());
    const action = (key: string, label: string, run: () => void, detail?: string): Item => ({ key: `a:${key}`, kind: 'Action', label, detail, run });
    const actions: Item[] = [
      action('new', 'New session', () => newSession(), ws ? `in ${ws.name}` : undefined),
      action('attention', 'Jump to the next session that needs you', jumpToAttention),
      action('workspace', 'New workspace', () => set({ modal: { kind: 'workspace', id: null } })),
    ];
    if (ws) {
      actions.push(
        action('addrepo', `Add a repo to ${ws.name}`, () => set({ modal: { kind: 'repoPicker', target: { kind: 'workspace', id: ws.id } } })),
        action('editws', `Edit workspace ${ws.name}`, () => set({ modal: { kind: 'workspace', id: ws.id } })),
        action('exportws', `Export workspace ${ws.name} to share it`, () => exportWorkspace(ws.id)),
      );
    }
    actions.push(
      action('importws', 'Import a workspace file', importWorkspace),
      action('sources', 'Choose the folders the repo library lists', () => set({ modal: { kind: 'sources' } })),
      action('home', 'Go home', home),
      action('theme', 'Switch theme (match Windows, light, dark)', cycleTheme),
      action('sound', `Turn sound ${get().sound ? 'off' : 'on'}`, toggleSound),
      action('help', 'Show every key', () => set({ modal: { kind: 'help' } })),
      action('bindings', 'Change keyboard shortcuts', () => set({ modal: { kind: 'bindings' } })),
      action('welcome', 'Show the welcome tour', () => set({ modal: { kind: 'welcome' } })),
      action('export', 'Export my workflows (JSON)', exportPack),
      action('import', 'Import workflows (JSON)', importPack),
    );
    if (open) {
      actions.push(
        action('prev', 'Previous session', () => hop(-1)),
        action('next', 'Next session', () => hop(1)),
        action('rename', 'Rename this session', () => set({ modal: { kind: 'rename', id: open.id } }), open.title),
        action('adddir', 'Let this session work in another repo', () => set({ modal: { kind: 'repoPicker', target: { kind: 'session', id: open.id } } }), open.title),
      );
      for (const d of open.extraDirs ?? []) {
        actions.push(action(`rmdir:${d}`, `Stop working in ${repoName(d)}`, () => send({ type: 'session.removeDir', id: open.id, path: d }), open.title));
      }
      if (open.live) {
        actions.push(
          action('interrupt', 'Stop Claude now (Esc)', () => interrupt(open.id), open.title),
          action('background', 'Let the running step continue in the background (Ctrl+B)', () => send({ type: 'session.background', id: open.id }), open.title),
          action('stop', 'End this session', () => askStop(open.id), open.title),
        );
        const running = (activity?.tasks ?? []).filter(taskRunning);
        for (const t of running) {
          actions.push(action(`task:${t.id}`, `Stop ${taskKind(t)}: ${t.description}`, () => send({ type: 'task.stop', id: open.id, taskId: t.id })));
        }
        if (running.length > 1) {
          actions.push(action('tasks:all', `Stop all ${running.length} running helpers and commands`, () => running.forEach((t) => send({ type: 'task.stop', id: open.id, taskId: t.id }))));
        }
      }
    }
    const wsItems: Item[] = [
      ...workspaces.map((w, i): Item => ({ key: `w:${w.id}`, kind: 'Workspace', label: w.name, detail: `key ${i + 1}`, run: () => { setScope({ kind: 'workspace', id: w.id }); home(); } })),
      { key: 'w:rest', kind: 'Workspace', label: workspaces.length ? 'Everything else' : 'All sessions', detail: 'key 0', run: () => { setScope({ kind: 'rest' }); home(); } },
    ];
    const commands: Item[] = open && board?.sessionId === open.id
      ? board.groups.flatMap((g) => g.commands.map((c) => ({
        key: `c:${g.scope}:${g.workspaceId ?? ''}:${g.name}:${c.slot}`,
        kind: 'Workflow' as const,
        label: c.label,
        detail: `${g.name} · key ${c.slot}`,
        run: () => fireCommand(open.id, c),
      })))
      : [];
    const sessionItems: Item[] = sessions.map((s) => ({
      key: `s:${s.id}`,
      kind: 'Session',
      label: s.title,
      detail: repoName(s.cwd),
      run: () => openSession(s.id),
    }));
    return [...actions, ...commands, ...wsItems, ...sessionItems];
  }, [sessions, workspaces, board, openId, activity]);

  const results = useMemo(() => {
    if (!query.trim()) return items.slice(0, MAX_RESULTS);
    // Longer queries must match reasonably well; scattered one-letter hits are noise.
    const q = query.replace(/\s+/g, '');
    const minScore = q.length >= 3 ? q.length * 2 : 0;
    return items
      .map((item) => {
        // The label decides; the detail (repo, group) only counts when the label doesn't match at all.
        const label = fuzzyScore(query, item.label);
        return { item, score: label >= 0 ? label : fuzzyScore(query, `${item.label} ${item.detail ?? ''}`) - 1 };
      })
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((r) => r.item);
  }, [items, query]);

  function run(item: Item | undefined) {
    if (!item) return;
    close();
    item.run();
  }

  return (
    <Overlay label="Search">
      <input
        autoFocus
        value={query}
        onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); close(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(results.length - 1, index + listStep(e))); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(0, index - listStep(e))); }
          else if (e.key === 'Enter') { e.preventDefault(); run(results[index]); }
        }}
        placeholder="Search actions, workflows, workspaces and sessions…"
        aria-label="Search"
        className="field text-[16px]"
      />
      <ul ref={listRef} className="mt-2 max-h-[52vh] space-y-0.5 overflow-y-auto" role="listbox">
        {results.map((r, i) => (
          <li
            key={r.key}
            role="option"
            aria-selected={i === index}
            onMouseEnter={() => setIndex(i)}
            onClick={() => run(r)}
            className={`flex cursor-pointer items-baseline gap-3 rounded-xl px-3 py-2 ${i === index ? 'is-focus bg-raise' : ''}`}
          >
            <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-faint">{r.kind}</span>
            <span className="truncate">{r.label}</span>
            {r.detail && <span className="ml-auto shrink-0 truncate pl-2 text-sm text-faint">{r.detail}</span>}
          </li>
        ))}
        {results.length === 0 && <li className="px-3 py-2 text-sub">Nothing matches.</li>}
      </ul>
      <DialogKeys items={[['↑ ↓', 'choose'], ['Enter', 'run'], ['Esc', 'close']]} />
    </Overlay>
  );
}
