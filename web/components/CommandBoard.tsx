import type { Command, CommandMode } from '../../shared/protocol.ts';
import { cycleGroup, exportPack, fireSlot, importPack } from '../commands.ts';
import { currentGroup, groupKeyOf, set, useStore } from '../store.ts';

// Laid out like a numpad, so the tile under your finger is the key you press.
const ROWS = [[7, 8, 9], [4, 5, 6], [1, 2, 3]];
const MODE_ICON: Record<CommandMode, [string, string]> = {
  send: ['↵', 'Sends immediately'],
  insert: ['✎', 'Drops into the composer'],
  template: ['{ }', 'Asks for the blanks first'],
};
const SCOPE_TAG = { global: 'mine', repo: 'repo', auto: 'slash' } as const;

export function CommandBoard({ focused }: { focused: boolean }) {
  const board = useStore((s) => s.board);
  const groupKey = useStore((s) => s.groupKey);
  const boardSlot = useStore((s) => s.boardSlot);
  const openId = useStore((s) => s.openId);
  const groups = board?.sessionId === openId ? board.groups : [];
  const { group, index } = currentGroup({ board, groupKey });

  return (
    <aside
      aria-label="Command board"
      onClick={() => set({ zone: 'board' })}
      className={`flex w-80 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950/40 ${focused ? 'ring-1 ring-inset ring-sky-800' : ''}`}
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-xs text-zinc-500">
        <button onClick={() => cycleGroup(-1)} title="Previous group (Numpad − or [)"><kbd>−</kbd></button>
        <div className="min-w-0 flex-1 text-center">
          {group ? (
            <>
              <span className="font-medium text-zinc-200">{group.name}</span>
              <span className="ml-1.5 rounded bg-zinc-800 px-1 text-[10px] uppercase text-zinc-400">{SCOPE_TAG[group.scope]}</span>
              <span className="ml-1.5 text-zinc-600">{index + 1}/{groups.length}</span>
            </>
          ) : board ? 'No commands' : 'Loading…'}
        </div>
        <button onClick={() => cycleGroup(1)} title="Next group (Numpad + or ])"><kbd>+</kbd></button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-zinc-800 px-3 py-1.5">
        {groups.map((g) => (
          <button
            key={groupKeyOf(g)}
            onClick={() => set({ groupKey: groupKeyOf(g) })}
            className={`truncate rounded px-1.5 py-0.5 text-[11px] ${g === group ? 'bg-sky-900 text-sky-100' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            {g.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5 p-3">
        {ROWS.flat().map((slot) => (
          <Tile
            key={slot}
            slot={slot}
            command={group?.commands.find((c) => c.slot === slot)}
            focused={focused && boardSlot === slot}
            onFire={() => { set({ boardSlot: slot }); fireSlot(slot); }}
          />
        ))}
      </div>

      <div className="mt-auto space-y-1 border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-500">
        <div><kbd>Numpad 1–9</kbd> fire · <kbd>Alt+1–9</kbd> fire anywhere</div>
        <div><kbd>E</kbd> edit · <kbd>Del</kbd> remove · <kbd>Ctrl+←→</kbd> move</div>
        <div>
          <button className="hover:text-zinc-300" onClick={exportPack}><kbd>Shift+E</kbd> export</button>
          {' · '}
          <button className="hover:text-zinc-300" onClick={importPack}><kbd>Shift+I</kbd> import</button>
        </div>
      </div>
    </aside>
  );
}

function Tile({ slot, command, focused, onFire }: { slot: number; command?: Command; focused: boolean; onFire: () => void }) {
  const [icon, iconTitle] = command ? MODE_ICON[command.mode] : ['', ''];
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onFire(); }}
      title={command?.body}
      className={`relative flex h-20 flex-col rounded border p-1.5 text-left ${
        command ? 'border-zinc-700 bg-zinc-900 hover:border-zinc-500' : 'border-dashed border-zinc-800 text-zinc-700'
      } ${focused ? 'ring-2 ring-sky-500' : ''}`}
    >
      <span className="flex items-center justify-between">
        <kbd>{slot}</kbd>
        {command && <span className="text-[10px] text-zinc-500" title={iconTitle}>{icon}</span>}
      </span>
      <span className={`mt-1 line-clamp-2 text-xs leading-tight ${command ? 'text-zinc-200' : 'text-[10px]'}`}>
        {command ? command.label : focused ? 'E to add' : ''}
      </span>
    </button>
  );
}
