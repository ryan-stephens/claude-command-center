import type { SessionSummary } from '../../shared/protocol.ts';

export function StatusBadge({ s }: { s: SessionSummary }) {
  if (s.live) {
    switch (s.status) {
      case 'running':
        return <span className="badge text-sky-300" title="Running"><span className="spinner" /> running</span>;
      case 'requires_action':
        return <span className="badge text-amber-300 animate-pulse" title="Needs you">● needs you</span>;
      case 'stopped':
        return <span className="badge text-zinc-500">■ stopped</span>;
      default:
        return <span className="badge text-emerald-400" title="Idle, ready for input">✓ idle</span>;
    }
  }
  if (s.activeElsewhere) return <span className="badge text-orange-300" title="Written recently by another process, probably a terminal">◐ elsewhere</span>;
  return <span className="badge text-zinc-600">·</span>;
}

export function relativeTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/') || p;
}

/** Context-window usage bar; amber from 70%, red from 85% (time to /compact). */
export function CtxMeter({ pct }: { pct?: number }) {
  if (pct === undefined) return null;
  const color = pct >= 85 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500" title={`Context window ${pct.toFixed(1)}% used`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-zinc-800">
        <span className={`block h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      {Math.round(pct)}%
    </span>
  );
}
