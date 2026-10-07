// The session meter (PLAN §115): how much of Claude's context window a session uses, what it has
// cost so far, and the branch its folder is on. Pure, so it is tested on its own.

/** 850, 42k, 1.2M: tokens as people read them. */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${n < 10_000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') : Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** $0.84, $12.30, <$0.01: an estimate, so cents are enough. */
export function fmtCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** The colour the context bar takes: calm until it fills, a warning near compacting, red at the top. */
export function ctxTone(pct: number): 'ok' | 'attn' | 'bad' {
  return pct >= 85 ? 'bad' : pct >= 70 ? 'attn' : 'ok';
}

/** What the meter says, for its title and screen readers. */
export function meterTitle(m: { ctxPct?: number; ctxTokens?: number; ctxMax?: number; costUsd?: number; branch?: string }): string {
  const parts: string[] = [];
  if (m.ctxPct !== undefined) {
    const of = m.ctxTokens !== undefined && m.ctxMax ? ` (${fmtTokens(m.ctxTokens)} of ${fmtTokens(m.ctxMax)} tokens)` : '';
    parts.push(`Context ${Math.round(m.ctxPct)}% full${of}. Near the top, /compact tidies it.`);
  }
  if (m.costUsd !== undefined) parts.push(`About ${fmtCost(m.costUsd)} so far this session (an estimate at list price, not a bill).`);
  if (m.branch) parts.push(`On branch ${m.branch}.`);
  return parts.join(' ');
}
