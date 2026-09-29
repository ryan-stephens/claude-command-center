import { useEffect, useState } from 'react';
import type { PermissionRequest } from '../../shared/protocol.ts';
import { approvalDetails, respondPermission } from '../keys.ts';
import { lineDiff } from '../diff.ts';
import { explainPermission, RISK_LABEL, type Risk } from '../plain.ts';
import { useStore } from '../store.ts';
import { Icon, Key } from './ui.tsx';

const RISK_STYLE: Record<Risk, { pill: string; border: string; icon: 'shield' | 'edit' | 'warn' }> = {
  safe: { pill: 'bg-ok-bg text-ok', border: 'border-line', icon: 'shield' },
  changes: { pill: 'bg-busy-bg text-busy', border: 'border-line', icon: 'edit' },
  careful: { pill: 'bg-bad-bg text-bad', border: 'border-bad', icon: 'warn' },
};

function useDetailsOpen(): boolean {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    approvalDetails.listeners.add(l);
    return () => { approvalDetails.listeners.delete(l); };
  }, []);
  return approvalDetails.open;
}

/**
 * "Claude wants to …": what, how risky, what it touches, then Allow / Always / Don't allow.
 * The raw command or edit sits behind Details (D). `sessionId` answers for that session
 * (the home preview), otherwise for the open one.
 */
export function ApprovalCard({ p, cwd, compact = false, sessionId }: { p: PermissionRequest; cwd?: string; compact?: boolean; sessionId?: string }) {
  const typing = useStore((s) => s.screen === 'session' && s.zone === 'composer');
  const details = useDetailsOpen();
  const x = explainPermission(p, cwd);
  const style = RISK_STYLE[x.risk];
  const answer = (d: 'allow' | 'always' | 'deny') => respondPermission(d, sessionId ?? p.sessionId);
  const edit = p.fields?.edit;
  return (
    <div
      className={`rounded-2xl border-2 bg-surface ${compact ? 'p-4' : 'p-5'} ${style.border} ${x.risk === 'careful' ? 'shadow-[0_0_0_6px_color-mix(in_srgb,var(--c-bad)_14%,transparent)]' : 'shadow-[0_0_0_6px_color-mix(in_srgb,var(--c-attn)_16%,transparent)]'}`}
      role="alertdialog"
      aria-label={`Claude wants to ${x.want}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold ${style.pill}`}>
          <Icon name={style.icon} size={14} />{RISK_LABEL[x.risk]} · {x.reason}
        </span>
        {x.touches && <span className="text-sm text-faint">Touches {x.touches}</span>}
        <button className="ml-auto flex items-center gap-1.5 text-sm text-sub hover:text-ink" onClick={() => { approvalDetails.open = !approvalDetails.open; approvalDetails.listeners.forEach((l) => l()); }}>
          {details ? 'Hide details' : 'Details'} <Key k="D" size="sm" />
        </button>
      </div>
      <div className={`mt-2 font-semibold leading-snug ${compact ? 'text-[16px]' : 'text-[19px]'}`}>Claude wants to {x.want}</div>
      {details && (
        <div className="mt-3 space-y-2">
          <div className="text-xs text-faint">{p.tool}</div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-2.5 font-mono text-[12.5px]">{p.fields?.command ?? p.input}</pre>
          {edit && <DiffView before={edit.before} after={edit.after} />}
        </div>
      )}
      <div className={`mt-4 flex flex-wrap gap-2.5 ${compact ? '' : 'md:gap-3'}`}>
        <Choice k="Y" title="Allow once" sub="just this time" onClick={() => answer('allow')} primary={x.risk !== 'careful'} />
        {p.canAlways && <Choice k="A" title="Always allow" sub={x.always} onClick={() => answer('always')} />}
        <Choice k="N" title="Don’t allow" sub="Claude tries another way" onClick={() => answer('deny')} primary={x.risk === 'careful'} />
      </div>
      {typing && !compact && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-attn">
          You’re in the message box: press <Key k="Tab" size="sm" tone="attn" /> to answer with keys, or type a different instruction.
        </p>
      )}
    </div>
  );
}

function Choice({ k, title, sub, onClick, primary }: { k: string; title: string; sub: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex min-w-0 max-w-full items-center gap-2.5 rounded-xl border py-1.5 pl-1.5 pr-3.5 text-left hover:bg-raise ${primary ? 'border-2 border-acc' : 'border-line bg-raise/60'}`}
    >
      <Key k={k} size="lg" tone={primary ? 'acc' : undefined} />
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="block truncate text-xs text-faint">{sub}</span>
      </span>
    </button>
  );
}

/** An edit as a line diff: only what changed, with a little context. */
export function DiffView({ before, after }: { before: string; after: string }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-bg py-2 font-mono text-[12.5px] leading-relaxed">
      {lineDiff(before, after).map((l, i) => (l.kind === 'gap'
        ? <div key={i} className="px-2.5 text-faint">⋯ {l.count} unchanged line{l.count === 1 ? '' : 's'}</div>
        : <div key={i} className={`px-2.5 ${l.kind === 'add' ? 'bg-ok-bg text-ok' : l.kind === 'del' ? 'bg-bad-bg text-bad' : 'text-sub'}`}>{l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  '}{l.text}</div>))}
    </pre>
  );
}
