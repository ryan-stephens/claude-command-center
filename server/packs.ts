import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command, CommandGroup, CommandMode, CommandPack, CommandScope } from '../shared/protocol.ts';

// Both editable scopes are plain CommandPacks (global lives in SQLite, repo in JSON),
// so every mutation is written once here against the pack shape.

const MODES: CommandMode[] = ['send', 'insert', 'template'];

export function emptyPack(): CommandPack {
  return { version: 1, groups: [] };
}

/** Parse untrusted JSON into a pack, dropping anything malformed rather than failing the whole file. */
export function validatePack(raw: unknown): CommandPack {
  const groups = (raw as { groups?: unknown })?.groups;
  if (!Array.isArray(groups)) throw new Error('Not a command pack: expected { "groups": [...] }');
  const pack = emptyPack();
  for (const g of groups) {
    if (typeof g?.name !== 'string' || !g.name.trim() || !Array.isArray(g.commands)) continue;
    const bySlot = new Map<number, Command>();
    for (const c of g.commands) {
      if (!Number.isInteger(c?.slot) || c.slot < 1 || c.slot > 9) continue;
      if (typeof c.label !== 'string' || typeof c.body !== 'string') continue;
      bySlot.set(c.slot, { slot: c.slot, label: c.label, body: c.body, mode: MODES.includes(c.mode) ? c.mode : 'send' });
    }
    pack.groups.push({ name: g.name.trim(), commands: sortSlots([...bySlot.values()]) });
  }
  return pack;
}

function sortSlots<T extends { slot: number }>(commands: T[]): T[] {
  return commands.sort((a, b) => a.slot - b.slot);
}

export function setSlot(pack: CommandPack, group: string, command: Command): void {
  let g = pack.groups.find((x) => x.name === group);
  if (!g) pack.groups.push((g = { name: group, commands: [] }));
  g.commands = sortSlots([...g.commands.filter((c) => c.slot !== command.slot), command]);
}

export function clearSlot(pack: CommandPack, group: string, slot: number): void {
  const g = pack.groups.find((x) => x.name === group);
  if (!g) return;
  g.commands = g.commands.filter((c) => c.slot !== slot);
  if (!g.commands.length) pack.groups = pack.groups.filter((x) => x !== g);
}

export function swapSlots(pack: CommandPack, group: string, a: number, b: number): void {
  const g = pack.groups.find((x) => x.name === group);
  if (!g) return;
  for (const c of g.commands) c.slot = c.slot === a ? b : c.slot === b ? a : c.slot;
  sortSlots(g.commands);
}

/** Import merges by group name; imported slots overwrite existing ones. */
export function mergePack(into: CommandPack, from: CommandPack): void {
  for (const g of from.groups) for (const c of g.commands) setSlot(into, g.name, { ...c, mode: c.mode ?? 'send' });
}

export function toGroups(pack: CommandPack, scope: CommandScope): CommandGroup[] {
  return pack.groups.map((g) => ({ name: g.name, scope, commands: g.commands.map((c) => ({ ...c, mode: c.mode ?? 'send' })) }));
}

// ---- Repo packs: <cwd>/.cc-control/commands.json, meant to be committed ----

export function repoPackPath(cwd: string): string {
  return join(cwd, '.cc-control', 'commands.json');
}

export function readRepoPack(cwd: string): CommandPack | null {
  let text: string;
  try { text = readFileSync(repoPackPath(cwd), 'utf8'); } catch { return null; }
  try {
    return validatePack(JSON.parse(text));
  } catch (e) {
    console.warn(`commands: ignoring ${repoPackPath(cwd)}: ${(e as Error).message}`);
    return null;
  }
}

export function writeRepoPack(cwd: string, pack: CommandPack): void {
  mkdirSync(join(cwd, '.cc-control'), { recursive: true });
  writeFileSync(repoPackPath(cwd), `${JSON.stringify(pack, null, 2)}\n`);
}

// ---- Auto groups from the session's slash commands ----

// Built-ins that make sense to fire from a button in an SDK session, in board order.
const USEFUL_BUILTINS = ['compact', 'context', 'usage', 'cost', 'review', 'security-review', 'init', 'pr-comments', 'release-notes', 'todos'];

export function autoGroups(commands: SlashCommand[]): CommandGroup[] {
  const toCommand = (c: SlashCommand, slot: number): Command => ({
    slot,
    label: c.name,
    // Commands that take arguments go to the composer so you can type them.
    body: c.argumentHint ? `/${c.name} ` : `/${c.name}`,
    mode: c.argumentHint ? 'insert' : 'send',
  });
  const skills = commands.filter((c) => !c.builtin).sort((a, b) => a.name.localeCompare(b.name));
  const groups: CommandGroup[] = [];
  for (let i = 0; i < skills.length; i += 9) {
    groups.push({
      name: i === 0 ? 'Skills' : `Skills ${i / 9 + 1}`,
      scope: 'auto',
      commands: skills.slice(i, i + 9).map((c, n) => toCommand(c, n + 1)),
    });
  }
  const builtins = USEFUL_BUILTINS.map((name) => commands.find((c) => c.builtin && c.name === name)).filter((c): c is SlashCommand => Boolean(c)).slice(0, 9);
  if (builtins.length) groups.push({ name: 'Built-in', scope: 'auto', commands: builtins.map((c, n) => toCommand(c, n + 1)) });
  return groups;
}

/** Seeded into the global scope on first run. Generic on purpose; repo packs carry the specific ones. */
export const STARTER_PACK: CommandPack = {
  version: 1,
  groups: [
    {
      name: 'Everyday',
      commands: [
        { slot: 1, label: 'Continue', body: 'Continue.', mode: 'send' },
        { slot: 2, label: 'Summarise', body: 'Summarise what you did in 3 bullets.', mode: 'send' },
        { slot: 3, label: 'Unpushed?', body: 'Run `git status` and `git log origin/HEAD..HEAD --oneline`. What is uncommitted or unpushed?', mode: 'send' },
        { slot: 4, label: 'Build errors', body: 'Run the build and report errors only.', mode: 'send' },
        { slot: 5, label: 'Test failures', body: 'Run the tests covering what you touched and summarise any failures.', mode: 'send' },
        { slot: 6, label: 'Explain…', body: 'Explain {{what}} in this codebase: where it lives and how it works.', mode: 'template' },
        { slot: 7, label: 'Code review', body: '/code-review high', mode: 'send' },
        { slot: 8, label: 'Simplify', body: '/simplify', mode: 'send' },
        { slot: 9, label: 'Commit', body: 'Commit your changes with a conventional commit message. Stage named paths only.', mode: 'send' },
      ],
    },
  ],
};
