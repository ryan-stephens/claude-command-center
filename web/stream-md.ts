// What Claude is writing right now, as blocks (PLAN §96): the text so far split at blank lines
// outside code fences. Every block but the last is finished, so the chat parses each once; only the
// last, still growing, is parsed again as more arrives. Pure, tested.

/** Blocks of streaming markdown: finished ones first, the one being written last ('' when none yet). */
export function streamBlocks(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let fenced = false;
  let at = 0;
  while (at < text.length) {
    const end = text.indexOf('\n', at);
    const line = end < 0 ? text.slice(at) : text.slice(at, end);
    if (/^\s{0,3}(```|~~~)/.test(line)) fenced = !fenced;
    if (end < 0) break;
    // A blank line outside a fence ends the block before it (once the line after it has begun).
    if (!fenced && !line.trim() && end + 1 < text.length && start < at) {
      out.push(text.slice(start, at));
      start = end + 1;
    }
    at = end + 1;
  }
  out.push(text.slice(start));
  return out;
}
