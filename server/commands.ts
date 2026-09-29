import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type { Command, CommandGroup, CommandPack, SlotRef } from '../shared/protocol.ts';
import { autoGroups, clearSlot, mergePack, readRepoPack, setSlot, swapSlots, toGroups, emptyPack, validatePack, writeRepoPack } from './packs.ts';
import type { Store } from './store.ts';

/** Builds a session's board (repo → global → auto) and applies edits to the editable scopes. */
export class CommandService {
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  board(cwd: string | undefined, slash: SlashCommand[] | undefined): CommandGroup[] {
    const repo = cwd ? readRepoPack(cwd) : null;
    return [
      ...(repo ? toGroups(repo, 'repo') : []),
      ...toGroups(this.store.loadGlobalPack(), 'global'),
      ...(slash ? autoGroups(slash) : []),
    ];
  }

  save(ref: SlotRef, command: Omit<Command, 'slot'>): void {
    if (!command.label.trim() || !command.body.trim()) throw new Error('A command needs a label and a body.');
    this.mutate(ref, (pack) => setSlot(pack, ref.group.trim(), { ...command, slot: ref.slot }));
  }

  delete(ref: SlotRef): void {
    this.mutate(ref, (pack) => clearSlot(pack, ref.group, ref.slot));
  }

  swap(ref: SlotRef, otherSlot: number): void {
    this.mutate(ref, (pack) => swapSlots(pack, ref.group, ref.slot, otherSlot));
  }

  importPack(raw: unknown): void {
    const pack = this.store.loadGlobalPack();
    mergePack(pack, validatePack(raw));
    this.store.saveGlobalPack(pack);
  }

  exportPack(): CommandPack {
    return this.store.loadGlobalPack();
  }

  private mutate(ref: SlotRef, fn: (pack: CommandPack) => void): void {
    if (!Number.isInteger(ref.slot) || ref.slot < 1 || ref.slot > 9) throw new Error('Slots are 1–9.');
    if (!ref.group?.trim()) throw new Error('A command needs a group.');
    if (ref.scope === 'global') {
      const pack = this.store.loadGlobalPack();
      fn(pack);
      this.store.saveGlobalPack(pack);
    } else if (ref.scope === 'repo') {
      if (!ref.cwd) throw new Error('Repo commands need a session directory.');
      const pack = readRepoPack(ref.cwd) ?? emptyPack();
      fn(pack);
      writeRepoPack(ref.cwd, pack);
    } else {
      throw new Error('Slash commands are read-only. Press E to copy one into your own group.');
    }
  }
}
