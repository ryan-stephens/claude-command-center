/**
 * Fuzzy score for the command palette: every query character must appear in order.
 * Rewards matches at word starts and consecutive runs. Returns -1 for no match.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    const wordStart = found === 0 || /[\s\-_/:.]/.test(t[found - 1]);
    run = found === ti ? run + 1 : 0;
    score += 1 + (wordStart ? 3 : 0) + run * 2 - Math.min(found - ti, 5) * 0.2;
    ti = found + 1;
  }
  // Prefer shorter texts when scores tie, so "Stop" beats "Stop and restart everything".
  return score - t.length * 0.01;
}
