// Line diff for "See change": shows only the lines that changed, with a little context.
// Pure (tested in diff.test.ts). Inputs are already trimmed to ~1.5k chars by the server.

export type DiffLine = { kind: 'same' | 'del' | 'add'; text: string } | { kind: 'gap'; count: number };

/** Longest-common-subsequence line diff, then long unchanged runs fold down to `context` lines each side. */
export function lineDiff(before: string, after: string, context = 2): DiffLine[] {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: { kind: 'same' | 'del' | 'add'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { ops.push({ kind: 'same', text: a[i] }); i++; j++; }
    // On a tie, removals come before additions, so a changed line reads - old / + new.
    else if (i < a.length && (j >= b.length || lcs[i + 1][j] >= lcs[i][j + 1])) { ops.push({ kind: 'del', text: a[i] }); i++; }
    else { ops.push({ kind: 'add', text: b[j] }); j++; }
  }
  // Fold unchanged runs that are far from any change.
  const out: DiffLine[] = [];
  const near = (k: number) => ops.slice(Math.max(0, k - context), k + context + 1).some((o) => o.kind !== 'same');
  let skipped = 0;
  ops.forEach((o, k) => {
    if (o.kind === 'same' && !near(k)) { skipped++; return; }
    if (skipped) { out.push({ kind: 'gap', count: skipped }); skipped = 0; }
    out.push(o);
  });
  if (skipped) out.push({ kind: 'gap', count: skipped });
  return out;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === 'add') added++;
    else if (l.kind === 'del') removed++;
  }
  return { added, removed };
}
