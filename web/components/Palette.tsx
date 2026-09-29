import { useMemo, useRef, useState } from 'react';
import { exportPack, fireCommand, importPack } from '../commands.ts';
import { fuzzyScore } from '../fuzzy.ts';
import { askStop, hop, jumpToAttention, openSession } from '../keys.ts';
import { get, set, toggleSound, useStore } from '../store.ts';
import { send } from '../ws.ts';
import { close, Overlay } from './Overlay.tsx';
import { shortPath } from './StatusBadge.tsx';

interface Item {
  key: string;
  kind: 'Action' | 'Command' | 'Session';
  label: string;
  detail?: string;
  run: () => void;
}

const MAX_RESULTS = 12;

/** Ctrl+K: fuzzy search over actions, the open session's commands, and every session. */
export function Palette() {
  const sessions = useStore((s) => s.sessions);
  const board = useStore((s) => s.board);
  const openId = useStore((s) => s.openId);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo<Item[]>(() => {
    const open = sessions.find((s) => s.id === openId);
    const action = (key: string, label: string, run: () => void, detail?: string): Item => ({ key: `a:${key}`, kind: 'Action', label, detail, run });
    const actions: Item[] = [
      action('new', 'New session', () => set({ modal: { kind: 'new' } })),
      action('attention', 'Jump to the next session that needs you', jumpToAttention),
      action('inbox', 'Go to Inbox', () => set({ screen: 'list', openId: null, tab: 'inbox' })),
      action('live', 'Go to Live sessions', () => set({ screen: 'list', openId: null, tab: 'live' })),
      action('history', 'Go to History', () => set({ screen: 'list', openId: null, tab: 'history' })),
      action('sound', `Turn sound ${get().sound ? 'off' : 'on'}`, toggleSound),
      action('help', 'Keyboard help', () => set({ modal: { kind: 'help' } })),
      action('bindings', 'Change keyboard shortcuts', () => set({ modal: { kind: 'bindings' } })),
      action('welcome', 'Show the welcome tour', () => set({ modal: { kind: 'welcome' } })),
      action('export', 'Export my commands (JSON)', exportPack),
      action('import', 'Import commands (JSON)', importPack),
    ];
    if (open) {
      actions.push(
        action('prev', 'Previous session', () => hop(-1)),
        action('next', 'Next session', () => hop(1)),
        action('rename', 'Rename this session', () => set({ modal: { kind: 'rename', id: open.id } }), open.title),
      );
      if (open.live) {
        actions.push(
          action('interrupt', 'Interrupt this session', () => send({ type: 'session.interrupt', id: open.id }), open.title),
          action('stop', 'Stop this session', () => askStop(open.id), open.title),
        );
      }
    }
    const commands: Item[] = open && board?.sessionId === open.id
      ? board.groups.flatMap((g) => g.commands.map((c) => ({
        key: `c:${g.scope}:${g.name}:${c.slot}`,
        kind: 'Command' as const,
        label: c.label,
        detail: `${g.name} · ${c.slot}`,
        run: () => fireCommand(open.id, c),
      })))
      : [];
    const sessionItems: Item[] = sessions.map((s) => ({
      key: `s:${s.id}`,
      kind: 'Session',
      label: s.title,
      detail: `${shortPath(s.cwd)}${s.live ? ` · ${s.status}` : ''}`,
      run: () => openSession(s.id),
    }));
    return [...actions, ...commands, ...sessionItems];
  }, [sessions, board, openId]);

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
    <Overlay label="Command palette">
      <input
        autoFocus
        value={query}
        onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); close(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(results.length - 1, index + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(0, index - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); run(results[index]); }
        }}
        placeholder="Type an action, a command, or a session…"
        className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-sky-600"
      />
      <ul ref={listRef} className="mt-2 max-h-[50vh] overflow-y-auto">
        {results.map((r, i) => (
          <li
            key={r.key}
            onMouseEnter={() => setIndex(i)}
            onClick={() => run(r)}
            className={`flex cursor-default items-baseline gap-3 rounded px-2 py-1.5 text-sm ${i === index ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300'}`}
          >
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">{r.kind}</span>
            <span className="truncate">{r.label}</span>
            {r.detail && <span className="ml-auto shrink-0 truncate pl-2 text-xs text-zinc-500">{r.detail}</span>}
          </li>
        ))}
        {results.length === 0 && <li className="px-2 py-2 text-sm text-zinc-500">No matches.</li>}
      </ul>
      <p className="mt-2 text-xs text-zinc-500"><kbd>↑ ↓</kbd> pick · <kbd>Enter</kbd> run · <kbd>Esc</kbd> close</p>
    </Overlay>
  );
}
