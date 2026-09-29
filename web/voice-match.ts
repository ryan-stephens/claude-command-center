// Decides whether a spoken utterance is a command ("code review", "slot three") or text to send.
// Pure functions, no DOM, so it can be tested directly under Node.

import type { Command, CommandGroup } from '../shared/protocol.ts';

export type VoiceMatch =
  | { kind: 'text' }
  | { kind: 'command'; command: Command; confident: boolean };

/** Only short utterances can be commands; longer dictation is always sent as text. */
const MAX_COMMAND_WORDS = 5;
const CONFIDENT = 0.85;
const POSSIBLE = 0.6;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  won: 1, to: 2, too: 2, for: 4, ate: 8, // common mis-hearings
};

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[…]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/-/g, ' ')
    .replace(/\b(please|now|thanks|thank you)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s: string): string[] {
  const t = s.replace(/\s/g, '');
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice similarity over character bigrams, 0..1. Forgiving of small recognition errors. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.length || !y.length) return 0;
  const counts = new Map<string, number>();
  for (const g of x) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of y) {
    const n = counts.get(g) ?? 0;
    if (n > 0) { overlap++; counts.set(g, n - 1); }
  }
  return (2 * overlap) / (x.length + y.length);
}

/**
 * Match against the board. The current group is searched first, so a label that exists in
 * several groups resolves to the one you're looking at. "slot N" / "command N" fires slot N.
 */
export function matchUtterance(utterance: string, groups: CommandGroup[], current: CommandGroup | null): VoiceMatch {
  const said = normalize(utterance).replace(/^(run|fire|do)\s+/, '');
  if (!said || said.split(' ').length > MAX_COMMAND_WORDS) return { kind: 'text' };

  const slotMatch = /^(?:slot|command|number|key)\s+(\w+)$/.exec(said);
  if (slotMatch && current) {
    const n = NUMBER_WORDS[slotMatch[1]] ?? Number(slotMatch[1]);
    const command = current.commands.find((c) => c.slot === n);
    if (command) return { kind: 'command', command, confident: true };
  }

  const ordered = current ? [current, ...groups.filter((g) => g !== current)] : groups;
  let best: { command: Command; score: number } | null = null;
  for (const g of ordered) {
    for (const c of g.commands) {
      const score = similarity(said, normalize(c.label));
      if (!best || score > best.score) best = { command: c, score };
    }
  }
  if (!best || best.score < POSSIBLE) return { kind: 'text' };
  return { kind: 'command', command: best.command, confident: best.score >= CONFIDENT };
}
