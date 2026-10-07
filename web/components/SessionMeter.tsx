import type { SessionSummary } from '../../shared/protocol.ts';
import { ctxTone, fmtCost, fmtTokens, meterTitle } from '../meter.ts';

const BAR = { ok: 'bg-ok', attn: 'bg-attn', bad: 'bg-bad' } as const;

/**
 * The session meter (PLAN §115): the branch, how full Claude's context window is (tokens of the
 * window, and the share), and what the session has cost so far. Each part shows once the session
 * has said it: the context and cost after its first turn, the branch as soon as it starts.
 */
export function SessionMeter({ s, branch, className = '' }: { s?: Pick<SessionSummary, 'ctxPct' | 'ctxTokens' | 'ctxMax' | 'costUsd' | 'branch'>; branch?: string; className?: string }) {
  const b = s?.branch ?? branch;
  const m = { ...s, ...(b ? { branch: b } : {}) };
  if (!b && s?.ctxPct === undefined && s?.costUsd === undefined) return null;
  return (
    <span className={`flex min-w-0 items-center gap-2.5 text-[12px] text-faint ${className}`} title={meterTitle(m)} aria-label={meterTitle(m)} data-meter>
      {b && <span className="flex min-w-0 items-center gap-1 font-mono"><span aria-hidden>⎇</span><span className="truncate max-w-[12rem]" data-meter-branch>{b}</span></span>}
      {s?.ctxPct !== undefined && (
        <span className="flex shrink-0 items-center gap-1.5 tabular-nums" data-meter-ctx>
          <span className="h-1.5 w-12 overflow-hidden rounded-full bg-raise"><span className={`block h-full ${BAR[ctxTone(s.ctxPct)]}`} style={{ width: `${Math.min(100, s.ctxPct)}%` }} /></span>
          {s.ctxTokens !== undefined && s.ctxMax ? `${fmtTokens(s.ctxTokens)} / ${fmtTokens(s.ctxMax)} · ` : ''}{Math.round(s.ctxPct)}%
        </span>
      )}
      {s?.costUsd !== undefined && <span className="shrink-0 tabular-nums" data-meter-cost>{fmtCost(s.costUsd)}</span>}
    </span>
  );
}
