// Firing commands from the board: send, insert into the composer, or fill a {{template}} first.

import type { Command, CommandPack } from '../shared/protocol.ts';
import { currentGroup, flash, get, set, setDraft } from './store.ts';
import { requestExport, requestWorkspaceFile, send } from './ws.ts';

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

function download(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/** Pick a JSON file and hand it over parsed. */
function pickJson(onJson: (json: unknown, name: string) => void): void {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      onJson(JSON.parse(await file.text()), file.name);
    } catch {
      set({ lastError: `${file.name} is not valid JSON.` });
    }
  };
  input.click();
}

export async function exportPack(): Promise<void> {
  const pack = await requestExport().catch(() => null);
  if (!pack) return;
  download('cc-control-commands.json', pack);
  flash(`Exported ${pack.groups.length} group(s)`);
}

export function importPack(): void {
  pickJson((json, name) => {
    send({ type: 'pack.import', pack: json as CommandPack });
    flash(`Imported ${name}`);
  });
}

/** A workspace and its workflows as one shareable file (repos by name, not path). */
export async function exportWorkspace(id: string): Promise<void> {
  const file = await requestWorkspaceFile(id).catch(() => null);
  if (!file) return;
  download(`${file.name.replace(/[^\w.-]+/g, '-').toLowerCase()}.workspace.json`, file);
  flash(`Exported ${file.name}`);
}

export function importWorkspace(): void {
  pickJson((json) => send({ type: 'workspace.import', file: json }));
}
