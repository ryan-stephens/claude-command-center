// ↑ in an empty message box recalls earlier messages, like Claude Code. Pure (prompt-history.test.ts).

import type { TranscriptItem } from '../shared/protocol.ts';

const KEY = 'cc-control.prompts';
const MAX = 100;

/** Newest first: this session's own messages, then ones sent elsewhere; each once. */
export function historyFor(items: TranscriptItem[], stored: string[]): string[] {
  const own = items.filter((i) => i.kind === 'user').map((i) => (i as { text: string }).text.replace(/(\n\[image\])+$/, '')).reverse();
  const out: string[] = [];
  for (const t of [...own, ...stored]) if (t.trim() && !out.includes(t)) out.push(t);
  return out;
}

/** Add a sent message to the front of the stored list, without repeats, capped. */
export function remembered(stored: string[], text: string, max = MAX): string[] {
  return [text, ...stored.filter((t) => t !== text)].slice(0, max);
}

export function loadPrompts(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

export function rememberPrompt(text: string): void {
  if (!text.trim()) return;
  try { localStorage.setItem(KEY, JSON.stringify(remembered(loadPrompts(), text))); } catch { /* private window */ }
}
