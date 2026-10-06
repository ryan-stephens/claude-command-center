// Opening a session the page has seen (PLAN §97): it says how much of the transcript it holds, the
// server sends only what follows, and the page keeps the items it had. Without this a warm card
// switch drew the cached chat, then drew it all again when the server's identical copy arrived (new
// objects, so nothing memoised held). Pure, tested.

import type { TranscriptItem } from '../shared/protocol.ts';

/** What the page holds of a session's transcript, for `session.open`'s `have`. */
export function haveOf(items: TranscriptItem[] | undefined): { count: number; last: string } | undefined {
  const last = items?.at(-1);
  return last ? { count: items!.length, last: last.uuid } : undefined;
}

/**
 * The transcript after the server's answer: `from` set, its items follow the first `from` the page
 * has; absent, they are all of it, and the page's own objects are kept for items with the same uuid.
 * Returns `before` itself when nothing changed, so nothing redraws; undefined when a tail doesn't fit
 * what the page holds now (it was replaced meanwhile): the page asks for all of it again.
 */
export function mergeTranscript(before: TranscriptItem[] | undefined, items: TranscriptItem[], from?: number): TranscriptItem[] | undefined {
  if (from !== undefined) {
    if (!before || before.length < from) return undefined;
    if (!items.length && before.length === from) return before;
    const next = [...before.slice(0, from), ...kept(before, items)];
    return sameItems(before, next) ? before : next;
  }
  if (!before?.length) return items;
  const next = kept(before, items);
  return sameItems(before, next) ? before : next;
}

/** The page's own object for each item it already has (by uuid), the server's for the rest. */
function kept(before: TranscriptItem[], items: TranscriptItem[]): TranscriptItem[] {
  const old = new Map(before.map((i) => [i.uuid, i]));
  return items.map((i) => old.get(i.uuid) ?? i);
}

function sameItems(a: TranscriptItem[], b: TranscriptItem[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
