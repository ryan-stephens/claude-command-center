import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PermissionRequest, Question } from '../../shared/protocol.ts';
import { approvalChoices, approvalDetails, approvalIndex, openSession, respondPermission, submitAnswers } from '../keys.ts';
import { answered, freshQa, pick, typeOther, type QaState } from '../questions.ts';
import { set } from '../store.ts';
import { lineDiff } from '../diff.ts';
import { explainPermission, RISK_LABEL, type Risk } from '../plain.ts';
import { activeSession, useStore } from '../store.ts';
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
  if (p.questions?.length) return <QuestionCard p={p} compact={compact} />;
  if (p.plan !== undefined) return <PlanCard p={p} compact={compact} sessionId={sessionId} />;
  return <ToolApproval p={p} cwd={cwd} compact={compact} sessionId={sessionId} />;
}

function TabHint() {
  const typing = useStore((s) => activeSession(s) !== null && s.zone === 'composer');
  if (!typing) return null;
  return (
    <p className="mt-3 flex items-center gap-1.5 text-sm text-attn">
      You’re in the message box: press <Key k="Tab" size="sm" tone="attn" /> to answer with keys, or type a different instruction.
    </p>
  );
}

const CARD = 'rounded-2xl border-2 border-line bg-surface shadow-[0_0_0_6px_color-mix(in_srgb,var(--c-attn)_16%,transparent)]';

/** Claude asks you something with choices (AskUserQuestion): pick with 1–4, your own with O, Enter sends. */
function QuestionCard({ p, compact }: { p: PermissionRequest; compact: boolean }) {
  const questions = p.questions!;
  const stored = useStore((s) => (s.qa?.reqId === p.reqId ? s.qa : null));
  const qa: QaState = stored ?? freshQa(p.reqId, questions.length);
  const update = (next: QaState) => set({ qa: next });
  const done = questions.every((_, i) => answered(qa, i));
  return (
    <div className={`${CARD} ${compact ? 'p-4' : 'p-5'}`} role="alertdialog" aria-label="Claude has a question">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-attn-bg px-2.5 py-0.5 text-[12.5px] font-semibold text-attn">
          <Icon name="plan" size={14} />Claude has {questions.length === 1 ? 'a question' : `${questions.length} questions`}
        </span>
        {compact && <button className="btn ml-auto min-h-0 py-1 text-sm" onClick={() => openSession(p.sessionId)}>Open to answer<Key k="Enter" size="sm" /></button>}
      </div>
      <div className="mt-3 space-y-4">
        {questions.map((q, qi) => (
          <QuestionBlock key={q.question} q={q} qi={qi} qa={qa} current={qi === qa.at && !compact} readOnly={compact} onChange={update} />
        ))}
      </div>
      {!compact && (
        <div className="mt-4 flex flex-wrap gap-2.5">
          <Choice k="Enter" title="Send answers" sub={done ? 'Claude carries on with them' : 'answer each question first'} onClick={submitAnswers} primary={done} />
          <Choice k="N" title="Skip" sub="Claude decides for itself" onClick={() => { if (respondPermission('deny', p.sessionId)) set({ qa: null }); }} />
        </div>
      )}
      {!compact && <TabHint />}
    </div>
  );
}

function QuestionBlock({ q, qi, qa, current, readOnly, onChange }: { q: Question; qi: number; qa: QaState; current: boolean; readOnly: boolean; onChange: (s: QaState) => void }) {
  const picked = qa.picks[qi] ?? [];
  const keyboard = useStore((s) => s.zone === 'board') && current;
  const lit = (row: number) => keyboard && qa.hl === row;
  return (
    <section className={`rounded-xl ${current ? 'bg-raise/50 p-3 outline-2 outline-acc/50' : readOnly ? '' : 'p-3 opacity-80'}`} onClick={() => !readOnly && onChange({ ...qa, at: qi })}>
      <div className="mb-1.5 flex items-center gap-2">
        {q.header && <span className="rounded bg-raise px-1.5 text-xs font-semibold text-sub">{q.header}</span>}
        {q.multiSelect && <span className="text-xs text-faint">pick any</span>}
        {answered(qa, qi) && <Icon name="check" size={14} className="text-ok" />}
      </div>
      <div className="mb-2 font-semibold leading-snug">{q.question}</div>
      <ul className="space-y-1">
        {q.options.map((o, oi) => {
          const on = picked.includes(o.label);
          return (
            <li key={o.label}>
              <button
                disabled={readOnly}
                onClick={(e) => { e.stopPropagation(); onChange({ ...pick(qa, q, qi, o.label), at: qi, hl: oi }); }}
                className={`flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-1.5 text-left ${on ? 'border-acc bg-acc-soft' : 'border-line hover:bg-raise'} ${lit(oi) ? 'is-focus' : ''}`}
              >
                {!readOnly && <Key k={String(oi + 1)} size="sm" tone={on ? 'acc' : undefined} />}
                <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center border ${q.multiSelect ? 'rounded' : 'rounded-full'} ${on ? 'border-acc bg-acc text-acc-ink' : 'border-line'}`}>{on && <Icon name="check" size={11} />}</span>
                <span className="min-w-0">
                  <span className="block font-medium">{o.label}</span>
                  {o.description && <span className="block text-sm text-sub">{o.description}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!readOnly && (
        <label className={`mt-1.5 flex items-center gap-2.5 rounded-xl px-1 py-0.5 ${lit(q.options.length) ? 'is-focus' : ''}`} onClick={(e) => e.stopPropagation()}>
          <Key k="O" size="sm" />
          <input
            id={`qa-other-${qi}`}
            value={qa.other[qi] ?? ''}
            onChange={(e) => onChange({ ...typeOther(qa, q, qi, e.target.value), at: qi })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submitAnswers(); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); }
            }}
            placeholder="Something else: type your own answer"
            className="field py-1 text-sm"
          />
        </label>
      )}
    </section>
  );
}

/** Claude proposes a plan (plan mode's ExitPlanMode): read it, then start it or keep planning. */
function PlanCard({ p, compact, sessionId }: { p: PermissionRequest; compact: boolean; sessionId?: string }) {
  const answer = (d: 'allow' | 'always' | 'deny') => respondPermission(d, sessionId ?? p.sessionId);
  const lit = useLit(p, compact);
  return (
    <div className={`${CARD} ${compact ? 'p-4' : 'p-5'}`} role="alertdialog" aria-label="Claude has a plan">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-calm-bg px-2.5 py-0.5 text-[12.5px] font-semibold text-calm">
        <Icon name="plan" size={14} />Plan ready · nothing has changed yet
      </span>
      <div className={`md mt-3 overflow-y-auto rounded-xl border border-line bg-bg px-4 py-3 text-[14.5px] ${compact ? 'max-h-60' : 'max-h-[45vh]'}`}>
        <Markdown remarkPlugins={[remarkGfm]}>{p.plan || '(The plan is empty.)'}</Markdown>
      </div>
      <div className="mt-4 flex flex-wrap gap-2.5">
        <Choice k="Y" title="Yes, start" sub="asks before each change" onClick={() => answer('allow')} primary lit={lit('allow')} />
        <Choice k="A" title="Yes, and accept edits" sub="edits files without asking" onClick={() => answer('always')} lit={lit('always')} />
        <Choice k="N" title="Keep planning" sub="then tell Claude what to change" onClick={() => answer('deny')} lit={lit('deny')} />
      </div>
      {!compact && <TabHint />}
    </div>
  );
}

/** Which answer the arrow keys are on, when the keyboard is on the card (not in the home preview). */
function useLit(p: PermissionRequest, compact: boolean): (d: 'allow' | 'always' | 'deny') => boolean {
  const keyboard = useStore((s) => activeSession(s) === p.sessionId && s.zone === 'board' && !compact);
  const index = useStore(() => approvalIndex(p));
  return (d) => keyboard && approvalChoices(p)[index] === d;
}

function ToolApproval({ p, cwd, compact, sessionId }: { p: PermissionRequest; cwd?: string; compact: boolean; sessionId?: string }) {
  const lit = useLit(p, compact);
  const typing = useStore((s) => activeSession(s) === p.sessionId && s.zone === 'composer');
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
        <Choice k="Y" title="Allow once" sub="just this time" onClick={() => answer('allow')} primary={x.risk !== 'careful'} lit={lit('allow')} />
        {p.canAlways && <Choice k="A" title="Always allow" sub={x.always} onClick={() => answer('always')} lit={lit('always')} />}
        <Choice k="N" title="Don’t allow" sub="Claude tries another way" onClick={() => answer('deny')} primary={x.risk === 'careful'} lit={lit('deny')} />
      </div>
      {typing && !compact && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-attn">
          You’re in the message box: press <Key k="Tab" size="sm" tone="attn" /> to answer with keys, or type a different instruction.
        </p>
      )}
    </div>
  );
}

function Choice({ k, title, sub, onClick, primary, lit }: { k: string; title: string; sub: string; onClick: () => void; primary?: boolean; lit?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={lit || undefined}
      className={`flex min-w-0 max-w-full items-center gap-2.5 rounded-xl border py-1.5 pl-1.5 pr-3.5 text-left hover:bg-raise ${primary ? 'border-2 border-acc' : 'border-line bg-raise/60'} ${lit ? 'is-focus' : ''}`}
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
