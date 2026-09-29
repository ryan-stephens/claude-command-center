// Firing commands from the board: send, insert into the composer, or fill a {{template}} first.

import type { Command, CommandPack } from '../shared/protocol.ts';
import { currentGroup, flash, get, set, setDraft } from './store.ts';
import { requestExport, send } from './ws.ts';

const PLACEHOLDER = /\{\{\s*([\w .-]+?)\s*\}\}/g;

export function placeholders(body: string): string[] {
  return [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

export function fillTemplate(body: string, values: Record<string, string>): string {
  return body.replace(PLACEHOLDER, (_, name: string) => values[name] ?? '');
}

export function fireCommand(sessionId: string, command: Command): void {
  if (command.mode === 'template' && placeholders(command.body).length) {
    set({ modal: { kind: 'template', sessionId, command } });
    return;
  }
  if (command.mode === 'insert') {
    const draft = get().drafts[sessionId] ?? '';
    setDraft(sessionId, draft ? `${draft}${draft.endsWith(' ') ? '' : ' '}${command.body}` : command.body);
    set({ zone: 'composer' });
    return;
  }
  send({ type: 'session.send', id: sessionId, text: command.body });
  flash(`Sent: ${command.label}`);
}

/** Fire slot N of the current group. Returns false if the slot is empty. */
export function fireSlot(slot: number): boolean {
  const s = get();
  if (!s.openId || s.board?.sessionId !== s.openId) return false; // board still loading for this session
  const { group, exact } = currentGroup(s);
  // Never fire from a fallback group: if the selected one is gone, the board is mid-refresh.
  if (!exact) return false;
  const command = group?.commands.find((c) => c.slot === slot);
  if (!command) {
    flash(group ? `Slot ${slot} is empty. Focus it on the board and press E to add one.` : 'No commands yet.');
    return false;
  }
  fireCommand(s.openId, command);
  return true;
}

export function cycleGroup(delta: number): void {
  const s = get();
  const groups = s.board?.groups ?? [];
  if (!groups.length) return;
  const { index } = currentGroup(s);
  const g = groups[(index + delta + groups.length) % groups.length];
  set({ groupKey: `${g.scope}:${g.name}` });
}

export async function exportPack(): Promise<void> {
  const pack = await requestExport().catch(() => null);
  if (!pack) return;
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(pack, null, 2)}\n`], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'cc-control-commands.json' });
  a.click();
  URL.revokeObjectURL(url);
  flash(`Exported ${pack.groups.length} group(s)`);
}

export function importPack(): void {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const pack = JSON.parse(await file.text()) as CommandPack;
      send({ type: 'pack.import', pack });
      flash(`Imported ${file.name}`);
    } catch {
      set({ lastError: `${file.name} is not valid JSON.` });
    }
  };
  input.click();
}
