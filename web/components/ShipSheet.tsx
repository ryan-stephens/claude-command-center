// s on a card: the Ship sheet. Before a PR: the commit message, the branch, the changed files
// (the ones Claude wrote ticked, ↑ ↓ Space to change), the PR's title and body written from the
// ticket, and Enter to commit, push and open it. After: the PR as gh sees it, and Enter merges.

import { useEffect, useState } from 'react';
import type { BootStep } from '../../shared/cards.ts';
import { prLine, type ShipPlan } from '../../shared/ship.ts';
import { flash, get, set, useStore } from '../store.ts';
import { mergeCard, refreshPr, shipCard, shipPlan } from '../ws.ts';
import { close, DialogKeys, DialogTitle, Overlay, useDialogKeys } from './Overlay.tsx';
import { Key, TicketKey } from './ui.tsx';

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'));
};

const NO_STEPS: BootStep[] = [];

/** The steps shipping took, as they happen: the same marks as How it started. */
function Steps({ id }: { id: string }) {
  // A stable empty list: a new [] each time would make the store look changed on every render.
  const steps = useStore((s) => s.cards.find((c) => c.id === id)?.ship?.steps ?? NO_STEPS);
  if (!steps.length) return null;
  return (
    <ol className="mt-3 grid gap-1 text-[13.5px]">
      {steps.map((st, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className={`w-4 shrink-0 text-center font-mono text-xs font-bold ${st.state === 'ok' ? 'text-ok' : st.state === 'bad' ? 'text-bad' : 'text-busy'}`}>
            {st.state === 'go' ? <span className="spinner inline-block" /> : st.state === 'ok' ? '✓' : '✗'}
          </span>
          <span className={st.state === 'bad' ? 'text-bad' : ''}>{st.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function ShipSheet({ id }: { id: string }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id));
  // Which sheet is settled when it opens: the PR that shipping opens must not turn it into the merge sheet.
  const [merge] = useState(() => Boolean(card?.ship?.pr && card.ship.pr.state !== 'CLOSED'));
  if (!card) return null;
  return merge ? <MergeSheet id={id} /> : <ShipForm id={id} />;
}

function ShipForm({ id }: { id: string }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id))!;
  const ws = useStore((s) => s.workspaces.find((w) => w.id === card.workspaceId));
  const [plan, setPlan] = useState<ShipPlan | null>(null);
  const [commit, setCommit] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [fi, setFi] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    shipPlan(id).then((p) => {
      setPlan(p); setCommit(p.commit); setTitle(p.title); setBody(p.body);
      setPicked(new Set(p.files.filter((f) => f.mine).map((f) => f.path)));
    }, (e: Error) => setError(e.message));
  }, [id]);

  const toggle = (path: string) => setPicked((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  const go = () => {
    if (!plan || busy) return;
    if (plan.blockers.length) { setError(plan.blockers[0]); return; }
    setBusy(true); setError(null);
    shipCard(id, { commit, title, body, paths: plan.files.filter((f) => picked.has(f.path)).map((f) => f.path) }).then(() => {
      close();
      const pr = get().cards.find((c) => c.id === id)?.ship?.pr;
      set({ line: { ...get().line, focus: id, drawer: id, tab: 'over' } });
      flash(pr ? `Opened PR #${pr.number}` : 'Shipped');
    }, (e: Error) => { setBusy(false); setError(e.message); });
  };

  useDialogKeys((e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { go(); return true; }
    if (typing(e)) {
      if (e.key === 'Escape') { (e.target as HTMLElement).blur(); return true; }
      return false;
    }
    if (e.key === 'Escape') { if (!busy) close(); return true; }
    if (e.key === 'Enter') { go(); return true; }
    const files = plan?.files ?? [];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { setFi((i) => Math.max(0, Math.min(files.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))); return true; }
    if (e.key === ' ' && files[fi]) { toggle(files[fi].path); return true; }
    if (e.key === 'm') { setTimeout(() => document.getElementById('ship-commit')?.focus(), 0); return true; }
    if (e.key === 'b') { setTimeout(() => document.getElementById('ship-body')?.focus(), 0); return true; }
    return false;
  });

  const field = 'field w-full font-mono text-[13px]';
  return (
    <Overlay label="Ship" wide>
      <div className="mb-1 text-sm text-faint">Ship · {ws?.name ?? 'no workspace'}</div>
      <DialogTitle><span className="flex min-w-0 items-center gap-2"><TicketKey k={card.key} source={card.ticket?.source} /><span className="truncate">{card.title}</span></span></DialogTitle>
      {!plan && !error && <p className="text-sm text-faint"><span className="spinner mr-2 inline-block" />Looking at the repo…</p>}
      {plan && (
        <div className="grid gap-3.5">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1.5"><span className="eyebrow">Commit <Key k="m" size="sm" /></span>
              <input id="ship-commit" value={commit} onChange={(e) => setCommit(e.target.value)} className={field} /></label>
            <div className="grid gap-1.5"><span className="eyebrow">Branch</span>
              <div className="rounded-lg border border-line bg-raise px-2.5 py-1.5 font-mono text-[13px]">{plan.newBranch ?? plan.branch} <span className="font-sans text-faint">→ {plan.base}{plan.newBranch ? ` · made from ${plan.branch} first` : ''}</span></div></div>
          </div>
          <div className="grid gap-1.5">
            <span className="eyebrow flex items-center gap-1.5">Files to commit · {picked.size} of {plan.files.length} <Key k="↑" size="sm" /><Key k="↓" size="sm" /><Key k="Space" size="sm" />{plan.ahead ? <span className="font-sans normal-case tracking-normal text-faint">· {plan.ahead} commit{plan.ahead === 1 ? '' : 's'} already on the branch</span> : null}</span>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-line">
              {plan.files.length ? plan.files.map((f, i) => (
                <button key={f.path} onClick={() => { setFi(i); toggle(f.path); }}
                  className={`flex w-full min-w-0 items-center gap-2.5 px-3 py-1 text-left text-[13px] [&+&]:border-t [&+&]:border-line/60 ${i === fi ? 'is-focus' : ''}`}>
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px] border-line font-mono text-[11px] font-bold text-ok">{picked.has(f.path) ? '✓' : ''}</span>
                  <span className="w-6 shrink-0 font-mono text-[11px] text-faint">{f.status.trim() || '·'}</span>
                  <span className="min-w-0 grow truncate font-mono">{f.path}</span>
                  <span className={`shrink-0 text-[11.5px] ${f.mine ? 'text-ok' : 'text-faint'}`}>{f.mine ? 'this card' : 'not from this card'}</span>
                </button>
              )) : <div className="px-3 py-2 text-[13px] text-faint">No uncommitted changes.</div>}
            </div>
          </div>
          <label className="grid gap-1.5"><span className="eyebrow">Pull request, written from the ticket</span>
            <input id="ship-title" value={title} onChange={(e) => setTitle(e.target.value)} className="field w-full text-[14px] font-semibold" />
            <textarea id="ship-body" value={body} onChange={(e) => setBody(e.target.value)} rows={9} className={`${field} resize-y text-[12.5px]`} />
            <span className="text-[12.5px] text-faint"><Key k="b" size="sm" /> edits the body. Slack posts come later.</span>
          </label>
          {plan.notes.map((n) => <p key={n} className="text-[13px] text-faint">{n}</p>)}
          {plan.blockers.map((b) => <div key={b} className="rounded-lg bg-attn-bg px-3 py-2 text-[13px] text-attn">{b}</div>)}
        </div>
      )}
      <Steps id={id} />
      {error && <div className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{error}</div>}
      <div className="mt-4 flex items-center gap-3">
        <span className="grow text-[13px] text-faint">{plan?.newBranch ? `Makes ${plan.newBranch}, commits` : 'Commits'} the ticked files by name, pushes, and {plan && !plan.host ? 'then you open the PR in the browser' : `opens the PR${plan?.host ? ` on ${plan.host}` : ''}`}. The card moves to Ship.</span>
        <button className="btn" onClick={close} disabled={busy}>Cancel<Key k="Esc" size="sm" /></button>
        <button className="btn btn-primary" onClick={go} disabled={!plan || busy || Boolean(plan?.blockers.length)}>{busy ? 'Shipping…' : 'Ship it'}<Key k="Enter" size="sm" tone="ghost" /></button>
      </div>
      <DialogKeys items={[['Enter', 'ship it (Ctrl Enter while typing)'], ['↑ ↓ Space', 'pick files'], ['m / b', 'commit message / PR body'], ['Esc', 'leave the field, then cancel']]} />
    </Overlay>
  );
}

function MergeSheet({ id }: { id: string }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id))!;
  const pr = card.ship!.pr!;
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { refreshPr(id).then(() => setLooking(false), (e: Error) => { setLooking(false); setError(e.message); }); }, [id]);
  const merged = pr.state === 'MERGED';
  const go = () => {
    if (busy || merged) return;
    setBusy(true); setError(null);
    mergeCard(id).then(() => { close(); flash(`Merged PR #${pr.number}`); }, (e: Error) => { setBusy(false); setError(e.message); });
  };
  useDialogKeys((e) => {
    if (e.key === 'Escape') { if (!busy) close(); return true; }
    if (e.key === 'Enter') { go(); return true; }
    if (e.key === 'o') { window.open(pr.url, '_blank', 'noopener'); return true; }
    return false;
  });
  return (
    <Overlay label="Merge">
      <DialogTitle>{merged ? `PR #${pr.number} is merged` : `Merge PR #${pr.number}`}</DialogTitle>
      <div className="grid gap-1 rounded-xl border border-line bg-raise px-3.5 py-2.5">
        <a className="font-semibold underline hover:text-acc" href={pr.url} target="_blank" rel="noreferrer">#{pr.number} {card.title}</a>
        <span className="text-sm text-faint">{looking ? 'Asking GitHub…' : prLine(pr)}</span>
      </div>
      <Steps id={id} />
      {error && <div className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{error}</div>}
      <div className="mt-4 flex items-center gap-3">
        <span className="grow text-[13px] text-faint">{merged ? 'The card is in Done.' : `Squash-merges it on ${pr.host === 'azure' ? 'Azure DevOps' : 'GitHub'} and deletes ${card.branchName ?? 'the branch'} on the remote (your local branch stays). ${card.key} moves to Done.`}</span>
        <button className="btn" onClick={close} disabled={busy}>Cancel<Key k="Esc" size="sm" /></button>
        {!merged && <button className="btn btn-primary" onClick={go} disabled={busy}>{busy ? 'Merging…' : 'Merge'}<Key k="Enter" size="sm" tone="ghost" /></button>}
      </div>
      <DialogKeys items={[['Enter', 'merge'], ['o', 'open the PR'], ['Esc', 'cancel']]} />
    </Overlay>
  );
}
