// The Launchpad's ticket picker: your tickets that are still yours to work on (assigned to you, not
// done, not past the work: "Ready for PO" by default), and what a search finds elsewhere in Jira.
// Pure, so the page and the server share it.

import type { TicketPick } from './types.ts';

/** Statuses that are past the work, though Jira doesn't count them as done. CCV2_JIRA_SKIP replaces them. */
export const SKIP_DEFAULT = ['Ready for PO'];

/** The statuses to leave out of your list: a comma list, or the default; "none" leaves nothing out. */
export function skipStatuses(setting: string | undefined): string[] {
  const s = setting?.trim();
  if (!s) return SKIP_DEFAULT;
  if (s.toLowerCase() === 'none') return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

/** Still yours to work on: not done and not in a status that is past the work. */
export function workable(t: { status: string; done: boolean }, skip: string[]): boolean {
  if (t.done) return false;
  const st = t.status.trim().toLowerCase();
  return !skip.some((x) => x.toLowerCase() === st);
}

/** Does a ticket match the text: its key, or every word in its key, title or status. */
export function pickMatches(p: TicketPick, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  if (p.key.toLowerCase().startsWith(s)) return true;
  const hay = `${p.key} ${p.title} ${p.status}`.toLowerCase();
  return s.split(/\s+/).every((w) => hay.includes(w));
}

/** What the picker shows for the text: your matching tickets first, then what Jira found that isn't one of them. */
export function suggest(mine: TicketPick[], found: TicketPick[], q: string, max = 15): TicketPick[] {
  const out = mine.filter((p) => pickMatches(p, q));
  if (q.trim()) for (const f of found) if (!out.some((p) => p.key === f.key)) out.push(f);
  return out.slice(0, max);
}
