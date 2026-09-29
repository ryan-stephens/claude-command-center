import type { ReactNode } from 'react';
import type { Command, CommandGroup, CommandScope } from '../../shared/protocol.ts';
import { cycleGroup, exportPack, fireSlot, importPack } from '../commands.ts';
import { backToList } from '../keys.ts';
import { startVoice, stopVoice, voiceSupported } from '../voice.ts';
import { currentGroup, groupKeyOf, set, toggleFold, useStore } from '../store.ts';
import { Icon, Key } from './ui.tsx';

/** What each kind of group is, in words. */
export const SCOPE_WORD: Record<CommandScope, string> = { workspace: 'Workspace', repo: 'Shared in the repo', global: 'Yours', auto: 'Skills' };

/**
 * The command board, drawn as a real number pad (Num / * − · 7 8 9 + · 4 5 6 · 1 2 3 Enter · 0 .),
 * so what is on screen is what is under your hand.
 */
export function NumPad({ focused, compact = false }: { focused: boolean; compact?: boolean }) {
  const board = useStore((s) => s.board);
  const groupKey = useStore((s) => s.groupKey);
  const boardSlot = useStore((s) => s.boardSlot);
  const openId = useStore((s) => s.openId);
  const groups = board?.sessionId === openId ? board.groups : [];
  const { group } = currentGroup({ board, groupKey });
  const cmd = (slot: number) => group?.commands.find((c) => c.slot === slot);
  const tile = (slot: number) => (
    <Tile key={slot} slot={slot} command={cmd(slot)} focused={focused && boardSlot === slot} onFire={() => { set({ boardSlot: slot }); fireSlot(slot); }} />
  );

  return (
    <aside
      aria-label="Number pad: workflows"
      onClick={() => set({ zone: 'board' })}
      className={`flex shrink-0 flex-col gap-3 bg-col p-4 ${compact ? 'w-full' : 'w-[24rem] border-l border-line'} ${focused && !compact ? 'shadow-[inset_0_3px_0_var(--c-acc)]' : ''}`}
    >
      <div className="flex items-center gap-2">
        <h2 className={`eyebrow ${focused ? '!text-ink' : ''}`}>Number pad</h2>
        <span className="ml-auto truncate text-sm text-sub">{group ? group.name : board ? 'No workflows' : 'Loading…'}</span>
        {group && <span className="shrink-0 rounded bg-raise px-1.5 text-[11px] text-faint">{SCOPE_WORD[group.scope]}</span>}
        {!compact && (
          <button onClick={(e) => { e.stopPropagation(); toggleFold('pad'); set({ zone: 'composer' }); }} aria-label="Fold the number pad away" title="Fold the number pad away (C on the pad)" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint hover:bg-raise hover:text-ink">
            <Icon name="right" size={15} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2" style={{ gridTemplateRows: `repeat(5, ${compact ? 70 : 68}px)` }}>
        <Fn label="Num" text="" disabled />
        <Fn label="/" text="Type a message" onClick={() => set({ zone: 'composer' })} />
        <Fn label="*" text="Search" onClick={() => set({ modal: { kind: 'palette' } })} />
        <Fn label="−" text="Prev group" onClick={() => cycleGroup(-1)} />
        {tile(7)}{tile(8)}{tile(9)}
        <Fn label="+" text="Next group" onClick={() => cycleGroup(1)} tall />
        {tile(4)}{tile(5)}{tile(6)}
        {tile(1)}{tile(2)}{tile(3)}
        <Fn label="Enter" text="Run focused" onClick={() => fireSlot(useStoreSlot())} tall />
        <Fn label="0" text="Back to home" onClick={backToList} wide />
        <TalkKey />
      </div>

      <GroupChips groups={groups} group={group} />

      {!compact && (
        <div className="mt-auto space-y-1.5 text-[12.5px] text-faint">
          <div className="flex flex-wrap items-center gap-1.5">No number pad? <Key k="Alt 0–9" size="sm" /> does the same.</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1"><Key k="E" size="sm" />edit a key</span>
            <button className="flex items-center gap-1 hover:text-ink" onClick={exportPack}><Key k="⇧E" size="sm" />export</button>
            <button className="flex items-center gap-1 hover:text-ink" onClick={importPack}><Key k="⇧I" size="sm" />import</button>
          </div>
        </div>
      )}
    </aside>
  );
}

const useStoreSlot = () => useStore.getState().boardSlot;

function GroupChips({ groups, group }: { groups: CommandGroup[]; group: CommandGroup | null }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map((g) => (
        <button
          key={groupKeyOf(g)}
          onClick={(e) => { e.stopPropagation(); set({ groupKey: groupKeyOf(g) }); }}
          className={`max-w-full truncate rounded-full px-2.5 py-0.5 text-[12.5px] ${g === group ? 'bg-acc-soft font-semibold text-acc' : 'bg-raise text-sub hover:text-ink'}`}
        >
          {g.name}
        </button>
      ))}
    </div>
  );
}

const MODE_MARK: Record<string, [ReactNode, string]> = {
  insert: [<Icon key="i" name="edit" size={12} />, 'Puts the text in the message box to finish'],
  template: ['{ }', 'Asks you to fill in a blank first'],
};

function Tile({ slot, command, focused, onFire }: { slot: number; command?: Command; focused: boolean; onFire: () => void }) {
  const mark = command ? MODE_MARK[command.mode] : undefined;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onFire(); }}
      title={command ? `${command.body}${mark ? `\n\n${mark[1]}` : ''}` : `Key ${slot} is empty. Focus it and press E to add a workflow.`}
      className={`relative flex min-w-0 flex-col justify-between rounded-[10px] border p-2 text-left shadow-[0_3px_0_var(--c-kc-edge)] ${
        command ? 'border-[var(--c-kc-line)] bg-[var(--c-kc-top)] hover:brightness-105' : 'border-dashed border-line bg-transparent shadow-none'
      } ${focused ? 'outline-2 outline-offset-1 outline-ring' : ''}`}
    >
      <span className="flex items-center justify-between font-mono text-[13px] font-bold text-faint">{slot}{mark && <span className="text-[11px] font-normal" title={mark[1]}>{mark[0]}</span>}</span>
      <span className={`line-clamp-2 break-words text-[12.5px] font-semibold leading-tight ${command ? '' : 'font-normal text-faint'}`}>
        {command ? command.label : focused ? 'Empty · E to add' : 'Empty'}
      </span>
    </button>
  );
}

function Fn({ label, text, onClick, disabled, tall, wide }: { label: string; text: string; onClick?: () => void; disabled?: boolean; tall?: boolean; wide?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className={`flex min-w-0 flex-col justify-between rounded-[10px] border border-[var(--c-kc-line)] bg-raise p-2 text-left shadow-[0_3px_0_var(--c-kc-edge)] disabled:opacity-50 ${tall ? 'row-span-2' : ''} ${wide ? 'col-span-2' : ''}`}
    >
      <span className="font-mono text-[13px] font-bold text-faint">{label}</span>
      <span className="text-[12px] leading-tight text-sub">{text}</span>
    </button>
  );
}

/** Numpad . : hold to talk (pointer), like the key. */
function TalkKey() {
  const openId = useStore((s) => s.openId);
  const listening = useStore((s) => s.voice?.state === 'listening');
  const ok = voiceSupported() && openId;
  return (
    <button
      disabled={!ok}
      onPointerDown={(e) => { if (!openId) return; e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); startVoice(openId); }}
      onPointerUp={stopVoice}
      onPointerCancel={stopVoice}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex min-w-0 touch-none select-none flex-col justify-between rounded-[10px] border p-2 text-left shadow-[0_3px_0_var(--c-kc-edge)] disabled:opacity-50 ${listening ? 'border-bad bg-bad-bg text-bad' : 'border-[var(--c-kc-line)] bg-raise'}`}
    >
      <span className="font-mono text-[13px] font-bold text-faint">.</span>
      <span className="text-[12px] leading-tight text-sub">{listening ? 'Listening…' : 'Hold to talk'}</span>
    </button>
  );
}
