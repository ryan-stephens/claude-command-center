// Slash-command suggestions in the message box, like Claude Code: type "/cl" and /clear is offered.
// Pure (tested in slash.test.ts); the list comes from the session's CLI (SDK supportedCommands).

import type { SlashInfo } from '../shared/protocol.ts';
import { fuzzyScore } from './fuzzy.ts';

/** What is being typed after "/" at the very start of the message, or null when no command is being typed. */
export function slashQuery(text: string): string | null {
  const m = /^\/([^\s/]*)$/.exec(text);
  return m ? m[1] : null;
}

/** The command a finished "/name" (or "/name args") refers to, by name or alias. */
export function exactCommand(text: string, commands: SlashInfo[]): SlashInfo | undefined {
  const m = /^\/(\S+)(\s|$)/.exec(text);
  if (!m) return undefined;
  const name = m[1].toLowerCase();
  return commands.find((c) => c.name.toLowerCase() === name || c.aliases?.some((a) => a.toLowerCase() === name));
}

/** Enter runs it straight away: it takes no arguments, or only optional ones ("[name]", "<optional …>"). */
export function runsAlone(c: SlashInfo): boolean {
  const hint = c.argumentHint?.trim();
  return !hint || hint.startsWith('[') || /optional/i.test(hint);
}

/**
 * Commands matching the query, best first: names that start with it, then aliases that do,
 * then fuzzy matches on the name or an alias. An empty query lists everything by name.
 */
export function matchSlash(commands: SlashInfo[], query: string, max = 8): SlashInfo[] {
  const q = query.toLowerCase();
  if (!q) return [...commands].sort((a, b) => a.name.localeCompare(b.name)).slice(0, max);
  const scored: { c: SlashInfo; score: number }[] = [];
  for (const c of commands) {
    const names = [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase());
    let score: number;
    if (names[0].startsWith(q)) score = 1000 - names[0].length;
    else if (names.slice(1).some((n) => n.startsWith(q))) score = 900 - names[0].length;
    else score = Math.max(...names.map((n) => fuzzyScore(q, n)));
    if (score >= 0) scored.push({ c, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name)).slice(0, max).map((x) => x.c);
}

/** An "@file" being typed at the caret: the text after "@" and where the "@" is. */
export function fileQuery(text: string, caret: number): { query: string; start: number } | null {
  const m = /(^|\s)@([^\s@"]*)$/.exec(text.slice(0, caret));
  return m ? { query: m[2], start: caret - m[2].length - 1 } : null;
}

/** How a file goes into a message: @path, quoted when it has spaces. */
export function mention(path: string): string {
  const p = path.replace(/\\/g, '/');
  return /\s/.test(p) ? `@"${p}"` : `@${p}`;
}
