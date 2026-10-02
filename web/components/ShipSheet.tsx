// s on a card: the Ship sheet. Before a PR: the commit message, then one block per repo the card
// changed (its branch, its changed files with the ones Claude wrote ticked, ↑ ↓ Space to change),
// the PR's title and body written from the ticket, and Enter to commit, push and open a PR in each.
// A ship that stopped part-way: the same form, the shipped repos marked, Enter ships the rest.
// After: the PRs as their hosts see them, ↑ ↓ to pick one, o to open it, and Enter merges them all.

import { useEffect, useState } from 'react';
import type { BootStep } from '../../shared/cards.ts';
import { openPrs, prLine, prsOf, shipLeft, shipMode, type ShipPlan } from '../../shared/ship.ts';
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
  // Which sheet is settled when it opens: the PRs that shipping opens must not turn it into the merge sheet.
  const [merge] = useState(() => Boolean(card && shipMode(card.ship) === 'merge'));
  if (!card) return null;
  return merge ? <MergeSheet id={id} /> : <ShipForm id={id} />;
}

/** A file row in the sheet: which repo block it is in, and its path there. */
interface Row { root: string; path: string }

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
  const keyOf = (r: Row) => `${r.root}\0${r.path}`;
  // A ship stopped part-way: the repos with a PR are shown shipped, and Enter ships the rest.
  const rest = shipMode(card.ship) === 'rest';
  const left = shipLeft(card.ship);

  useEffect(() => {
    shipPlan(id).then((p) => {
      setPlan(p); setCommit(p.commit); setTitle(p.title); setBody(p.body);
      setPicked(new Set(p.repos.filter((r) => !r.pr).flatMap((r) => r.files.filter((f) => f.mine).map((f) => keyOf({ root: r.root, path: f.path })))));
    }, (e: Error) => setError(e.message));
  }, [id]);

  // Every file of every block still to ship, in order, so ↑ ↓ walk through them all.
  const rows: Row[] = plan?.repos.filter((r) => !r.pr).flatMap((r) => r.files.map((f) => ({ root: r.root, path: f.path }))) ?? [];
  const toggle = (r: Row) => setPicked((s) => { const n = new Set(s); const k = keyOf(r); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const several = (plan?.repos.length ?? 0) > 1;
  const todo = plan?.repos.filter((r) => !r.pr) ?? [];
  const go = () => {
    if (!plan || busy) return;
    if (plan.blockers.length) { setError(plan.blockers[0]); return; }
    setBusy(true); setError(null);
    const repos = todo.map((r) => ({ root: r.root, paths: r.files.filter((f) => picked.has(keyOf({ root: r.root, path: f.path }))).map((f) => f.path) }));
    shipCard(id, { commit, title, body, repos }).then(() => {
      close();
      const prs = prsOf(get().cards.find((c) => c.id === id)?.ship);
      set({ line: { ...get().line, focus: id, drawer: id, panel: 'more' } });
      flash(rest ? `Shipped ${left.join(', ')} · every repo has its PR now; s merges them once their checks pass`
        : prs.length > 1 ? `Opened ${prs.length} PRs (${prs.map((p) => `#${p.number}`).join(', ')}) · o opens one; s merges them once their checks pass`
        : prs.length ? `Opened PR #${prs[0].number} · o opens it; s merges it once its checks pass (looked at every few minutes)` : 'Pushed. Open the PR in the browser; d when it is merged');
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
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { setFi((i) => Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))); return true; }
    if (e.key === ' ' && rows[fi]) { toggle(rows[fi]); return true; }
    if (e.key === 'm') { setTimeout(() => document.getElementById('ship-commit')?.focus(), 0); return true; }
    if (e.key === 'b') { setTimeout(() => document.getElementById('ship-body')?.focus(), 0); return true; }
    if (e.key === 't') { setTimeout(() => document.getElementById('ship-title')?.focus(), 0); return true; }
    return false;
  });

  const field = 'field w-full font-mono text-[13px]';
  let at = 0;
  return (
    <Overlay label={rest ? 'Ship the rest' : 'Ship'} wide>
      <div className="mb-1 text-sm text-faint">{rest ? 'Ship the rest' : 'Ship'} · {ws?.name ?? 'no lane'}</div>
      <DialogTitle><span className="flex min-w-0 items-center gap-2"><TicketKey k={card.key} source={card.ticket?.source} /><span className="truncate">{card.title}</span></span></DialogTitle>
      {!plan && !error && <p className="text-sm text-faint"><span className="spinner mr-2 inline-block" />Looking at the repo{several ? 's' : ''}…</p>}
      {plan && (
        <div className="grid gap-3.5">
          <label className="grid gap-1.5"><span className="eyebrow">Commit <Key k="m" size="sm" />{several ? <span className="font-sans normal-case tracking-normal text-faint"> · one commit in each repo</span> : null}</span>
            <input id="ship-commit" value={commit} onChange={(e) => setCommit(e.target.value)} className={field} /></label>
          {plan.repos.map((r) => {
            const start = at;
            if (r.pr) {
              return (
                <div key={r.root} className="grid gap-2 rounded-xl border border-line bg-raise/40 p-3" data-shipped={r.repo}>
                  <div className="grid gap-3 md:grid-cols-[auto_1fr]">
                    {several && <div className="font-mono text-[13.5px] font-semibold">{r.repo}</div>}
                    <div className="grid gap-1.5"><span className="eyebrow">Shipped already</span>
                      <div className="rounded-lg border border-line bg-raise px-2.5 py-1.5 font-mono text-[13px]">{r.branch} <span className="font-sans text-faint">→ {r.base} · pushed · <a className="underline" href={r.pr.url} target="_blank" rel="noreferrer">{prLine(r.pr)}</a>{r.files.length ? ` · ${r.files.length} changed file${r.files.length === 1 ? '' : 's'} here since are left alone` : ''}</span></div></div>
                  </div>
                </div>
              );
            }
            at += r.files.length;
            const mine = r.files.filter((f) => picked.has(keyOf({ root: r.root, path: f.path }))).length;
            return (
              <div key={r.root} className={`grid gap-2 ${several ? 'rounded-xl border border-line bg-raise/40 p-3' : ''}`}>
                <div className="grid gap-3 md:grid-cols-[auto_1fr]">
                  {several && <div className="font-mono text-[13.5px] font-semibold">{r.repo}</div>}
                  <div className="grid gap-1.5"><span className="eyebrow">Branch</span>
                    <div className="rounded-lg border border-line bg-raise px-2.5 py-1.5 font-mono text-[13px]">{r.newBranch ?? r.branch} <span className="font-sans text-faint">→ {r.base}{r.newBranch ? ` · made from ${r.branch} first` : ''}{r.host ? ` · PR on ${r.host}` : ' · no host: PR by hand'}</span></div></div>
                </div>
                <div className="grid gap-1.5">
                  <span className="eyebrow flex items-center gap-1.5">Files to commit · {mine} of {r.files.length} <Key k="↑" size="sm" /><Key k="↓" size="sm" /><Key k="Space" size="sm" />{r.ahead ? <span className="font-sans normal-case tracking-normal text-faint">· {r.ahead} commit{r.ahead === 1 ? '' : 's'} already on the branch</span> : null}</span>
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-line">
                    {r.files.length ? r.files.map((f, i) => {
                      const row = { root: r.root, path: f.path };
                      const k = start + i;
                      return (
                        <button key={f.path} onClick={() => { setFi(k); toggle(row); }}
                          className={`flex w-full min-w-0 items-center gap-2.5 px-3 py-1 text-left text-[13px] [&+&]:border-t [&+&]:border-line/60 ${k === fi ? 'is-focus' : ''}`}>
                          <span className="grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px] border-line font-mono text-[11px] font-bold text-ok">{picked.has(keyOf(row)) ? '✓' : ''}</span>
                          <span className="w-6 shrink-0 font-mono text-[11px] text-faint">{f.status.trim() || '·'}</span>
                          <span className="min-w-0 grow truncate font-mono">{f.path}</span>
                          <span className={`shrink-0 text-[11.5px] ${f.mine ? 'text-ok' : 'text-faint'}`}>{f.mine ? 'this card' : 'not from this card'}</span>
                        </button>
                      );
                    }) : <div className="px-3 py-2 text-[13px] text-faint">No uncommitted changes.</div>}
                  </div>
                </div>
              </div>
            );
          })}
          <label className="grid gap-1.5"><span className="eyebrow">Pull request, written from the ticket{several ? ' (one in each repo, linking the others)' : ''}</span>
            <input id="ship-title" value={title} onChange={(e) => setTitle(e.target.value)} className="field w-full text-[14px] font-semibold" />
            <textarea id="ship-body" value={body} onChange={(e) => setBody(e.target.value)} rows={9} className={`${field} resize-y text-[12.5px]`} />
            <span className="text-[12.5px] text-faint"><Key k="b" size="sm" inline /> edits the body. Slack posts come later.</span>
          </label>
          {plan.notes.map((n) => <p key={n} className="text-[13px] text-faint">{n}</p>)}
          {plan.blockers.map((b) => <div key={b} className="rounded-lg bg-attn-bg px-3 py-2 text-[13px] text-attn">{b}</div>)}
        </div>
      )}
      <Steps id={id} />
      {error && <div className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{error}</div>}
      <div className="mt-4 flex items-center gap-3">
        <span className="grow text-[13px] text-faint">{rest && plan
          ? `The repos with a PR are left alone. ${todo.map((r) => r.repo).join(' and ')}: ${todo.some((r) => r.files.length) ? 'commits the ticked files by name, ' : ''}pushes the branch and opens its PR, linking the ones open already. Then s merges them all.`
          : several
          ? `In each repo, in order: commits the ticked files by name, pushes, and opens its PR (a failure stops there; the repos before it are shipped, and s again ships the rest). The card moves to Ship.`
          : `${plan?.repos[0]?.newBranch ? `Makes ${plan.repos[0].newBranch}, commits` : 'Commits'} the ticked files by name, pushes, and ${plan && !plan.repos[0]?.host ? 'then you open the PR in the browser' : `opens the PR${plan?.repos[0]?.host ? ` on ${plan.repos[0].host}` : ''}`}. The card moves to Ship.`}</span>
        <button className="btn" onClick={close} disabled={busy}>Cancel<Key k="Esc" size="sm" /></button>
        <button className="btn btn-primary" onClick={go} disabled={!plan || busy || Boolean(plan?.blockers.length)}>{busy ? 'Shipping…' : rest && plan ? `Ship ${todo.map((r) => r.repo).join(', ') || 'the rest'}` : several ? `Ship ${plan!.repos.length} repos` : 'Ship it'}<Key k="Enter" size="sm" tone="ghost" /></button>
      </div>
      <DialogKeys items={[['Enter', rest ? 'ship the rest (Ctrl Enter while typing)' : 'ship it (Ctrl Enter while typing)'], ['↑ ↓ Space', 'pick files'], ['m / t / b', 'commit message / PR title / body'], ['Esc', 'leave the field, then cancel']]} />
    </Overlay>
  );
}

function MergeSheet({ id }: { id: string }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id))!;
  const prs = prsOf(card.ship);
  const open = openPrs(prs);
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(true);
  const [at, setAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { refreshPr(id).then(() => setLooking(false), (e: Error) => { setLooking(false); setError(e.message); }); }, [id]);
  const merged = open.length === 0;
  const go = () => {
    if (busy || merged) return;
    setBusy(true); setError(null);
    mergeCard(id).then(() => { close(); flash(open.length > 1 ? `Merged ${open.length} PRs` : `Merged PR #${open[0].number}`); }, (e: Error) => { setBusy(false); setError(e.message); });
  };
  useDialogKeys((e) => {
    if (e.key === 'Escape') { if (!busy) close(); return true; }
    if (e.key === 'Enter') { go(); return true; }
    if (e.key === 'o') { const pr = prs[at]; if (pr) window.open(pr.url, '_blank', 'noopener'); return true; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { setAt((i) => Math.max(0, Math.min(prs.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))); return true; }
    return false;
  });
  const hostName = (h?: string) => (h === 'azure' ? 'Azure DevOps' : 'GitHub');
  return (
    <Overlay label="Merge">
      <DialogTitle>{merged ? (prs.length > 1 ? 'Every PR is merged' : `PR #${prs[0]?.number} is merged`) : open.length > 1 ? `Merge ${open.length} pull requests` : `Merge PR #${open[0].number}`}</DialogTitle>
      <div className="grid gap-1.5">
        {prs.map((pr, i) => (
          <div key={`${pr.host}-${pr.number}`} onMouseEnter={() => setAt(i)} className={`grid gap-1 rounded-xl border px-3.5 py-2.5 ${i === at ? 'is-focus border-ring bg-raise' : 'border-line bg-raise'}`}>
            <div className="flex items-center gap-2">
              {prs.length > 1 && <span className="shrink-0 rounded border border-line px-1 font-mono text-[11px] text-sub">{pr.repo ?? 'repo'}</span>}
              <a className="min-w-0 truncate font-semibold underline hover:text-acc" href={pr.url} target="_blank" rel="noreferrer">#{pr.number} {card.title}</a>
            </div>
            <span className="text-sm text-faint">{looking ? `Asking ${hostName(pr.host)}…` : prLine(pr)}</span>
          </div>
        ))}
      </div>
      <Steps id={id} />
      {error && <div className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{error}</div>}
      <div className="mt-4 flex items-center gap-3">
        <span className="grow text-[13px] text-faint">{merged ? 'The card is in Done.' : `Squash-merges ${open.length > 1 ? 'each of them, in order,' : `it on ${hostName(open[0].host)}`} and deletes ${card.branchName ?? 'the branch'} on the remote (your local branches stay). ${card.key} moves to Done once every PR is merged.`}</span>
        <button className="btn" onClick={close} disabled={busy}>Cancel<Key k="Esc" size="sm" /></button>
        {!merged && <button className="btn btn-primary" onClick={go} disabled={busy}>{busy ? 'Merging…' : open.length > 1 ? `Merge ${open.length}` : 'Merge'}<Key k="Enter" size="sm" tone="ghost" /></button>}
      </div>
      <DialogKeys items={[['Enter', open.length > 1 ? 'merge them all' : 'merge'], ...(prs.length > 1 ? [['↑ ↓', 'pick a PR'] as [string, string]] : []), ['o', 'open the PR'], ['Esc', 'cancel']]} />
    </Overlay>
  );
}
