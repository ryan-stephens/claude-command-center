import { useEffect, useState } from 'react';
import { prBody, slackText } from '../shared/ship-text.ts';
import type { ShipPlan, ShippedPr, Snapshot } from '../shared/types.ts';
import { get, go, post } from './api.ts';

/** Slack's mrkdwn as it reads in the channel: a link's label, bold without its stars, a PR not opened yet as such. */
function readable(text: string): string {
  return text.replace(/<[^|>]+\|([^>]+)>/g, '$1').replace(/ #0\b/g, ' (new PR)').replace(/\*([^*\n]+)\*/g, '$1');
}

export function ShipDock({ snap, id }: { snap: Snapshot; id: string }) {
  const s = snap.sessions.find((x) => x.id === id);
  const [plan, setPlan] = useState<ShipPlan | null>(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [postIt, setPostIt] = useState(true);
  const [mention, setMention] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string[]>([]);
  const [showBody, setShowBody] = useState(false);

  const load = () => get<ShipPlan>(`/api/sessions/${id}/ship`).then((p) => { setPlan(p); setTitle((t) => t || p.title); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [id]);

  if (!s) return <section className="card"><b>That session is gone.</b><div><button type="button" className="btn" onClick={() => go('/')}>Back to the Switchboard</button></div></section>;

  async function shipIt(withPost: boolean) {
    setBusy(true);
    setError('');
    try {
      const r = await post<{ prs: ShippedPr[]; notes: string[] }>(`/api/sessions/${id}/ship`, { title, summary, post: withPost, mention });
      setDone(r.notes);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ev = plan?.evidence ?? [];
  const prs = s.prs;
  const reviewed = prs.length && prs.every((p) => p.review === 'APPROVED');
  const merged = prs.length && prs.every((p) => p.state === 'MERGED');
  const built = prs.length && prs.every((p) => p.checks === 'pass');
  // Before shipping, the PRs it will open stand in for the links.
  const slackPreview = plan?.slack ? slackText(s, prs.length ? prs : plan.repos.filter((r) => r.ahead).map((r) => ({ repo: r.name, number: 0, url: 'new PR' }))) : '';
  const stageNow = !prs.length ? 'review' : !reviewed ? 'review' : !merged ? 'build' : 'dev';

  return (
    <>
      <div className="top" style={{ marginTop: -8 }}>
        <h2 style={{ margin: 0, fontSize: 24 }}>{s.key} · {s.title}</h2>
        <span className="mu">The PR carries its own proof. Then the team hears about it, then it goes out.</span>
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      {done.length > 0 && <div className="card" style={{ background: 'var(--soft)' }} role="status">{done.map((d) => <span key={d}>✓ {d}</span>)}</div>}

      <div className="row" style={{ alignItems: 'flex-start', gap: 22 }}>
        <section className="card" style={{ flex: '3 1 560px' }}>
          <label htmlFor="sd-title" className="cap">Pull request</label>
          <input id="sd-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={{ minHeight: 48, fontWeight: 600, fontSize: 17 }} />
          <div className="mono mu">{s.branch} → {plan?.repos.filter((r) => r.ahead || r.pr).map((r) => `${r.name}${r.pr ? ` (#${r.pr.number})` : ` +${r.ahead}`}`).join(', ') || 'no commits yet'}</div>
          {plan?.repos.filter((r) => r.blocker && (r.ahead || r.dirty)).map((r) => <div key={r.name} className="err">{r.name}: {r.blocker}</div>)}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 12, background: 'var(--soft)' }}>
            <div className="cap">Evidence, gathered by the session</div>
            {ev.length ? ev.map((e, i) => <div key={i} className="ev"><span className={e.ok ? 'ok' : 'need'}>{e.ok ? '✓' : '!'}</span><span>{e.text}</span></div>)
              : <span className="mu" style={{ fontSize: 15 }}>None yet. Claude adds it as it works (tests, a test loan, a field check); "I tried it" on the Switchboard adds yours.</span>}
          </div>
          <label htmlFor="sd-summary" className="cap">Summary</label>
          <textarea id="sd-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What changed and why (Claude can write this when it ships through its ship tool)" />
          <div><button type="button" className="btn small" onClick={() => setShowBody(!showBody)}>{showBody ? 'Hide the PR body' : 'Show the PR body'}</button></div>
          {showBody && <pre className="preview">{prBody(s, summary, [])}</pre>}
        </section>

        <section className="card" style={{ flex: '2 1 380px' }}>
          <div className="cap">{plan?.slack ? `Posted to ${plan.slack.channel}` : 'Review request'}</div>
          {plan?.slack ? (
            <>
              <div className="slack">{readable(slackPreview)}</div>
              <label className="pick"><input type="checkbox" checked={postIt} onChange={(e) => setPostIt(e.target.checked)} /> Post the review request</label>
              <label className="pick"><input type="checkbox" checked={mention} onChange={(e) => setMention(e.target.checked)} /> Tag the reviewers</label>
              {s.posted && <span className="note">Posted {new Date(s.posted.at).toLocaleString()}.</span>}
            </>
          ) : <span className="mu" style={{ fontSize: 15 }}>No Slack webhook on this machine. Add CC_CONTROL_SLACK_WEBHOOK (and CC_CONTROL_SLACK_CHANNEL for its name) to ~/.cc-control/config.env, then restart the v2 server.</span>}
        </section>
      </div>

      <section className="card">
        <div className="cap">Then it goes out</div>
        <div className="row" style={{ gap: 12, alignItems: 'stretch' }}>
          <div className={`stage${stageNow === 'review' ? ' now' : ''}`}><b>Review</b><span className="mu" style={{ fontSize: 14 }}>{!prs.length ? 'opens when you ship' : reviewed ? 'approved' : prs.map((p) => `#${p.number} ${p.review ? p.review.toLowerCase().replace(/_/g, ' ') : 'waiting'}`).join(', ')}</span></div>
          <div className={`stage${stageNow === 'build' ? ' now' : ''}`}><b>Build</b><span className="mu" style={{ fontSize: 14 }}>{!prs.length ? 'runs on the PR' : built ? 'passing' : prs.map((p) => `#${p.number} ${p.checks ?? 'pending'}`).join(', ')}</span></div>
          <div className="stage"><b>Dev</b><span className="mu" style={{ fontSize: 14 }}>on your OK: the release pipeline isn’t connected yet</span></div>
          <div className="stage"><b>UAT</b><span className="mu" style={{ fontSize: 14 }}>on your OK, then check the fields on a UAT loan</span></div>
        </div>
      </section>

      <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
        {prs.map((p) => <a key={p.number} className="btn" href={p.url} target="_blank" rel="noreferrer">{p.repo} #{p.number}</a>)}
        <button type="button" className="btn" disabled={busy || Boolean(plan?.blockers.length)} onClick={() => void shipIt(false)}>Ship without posting</button>
        <button type="button" className="btn go" disabled={busy || Boolean(plan?.blockers.length) || !plan?.slack || !postIt} onClick={() => void shipIt(true)}>{busy ? 'Shipping…' : prs.length ? 'Push and post again' : 'Open PRs and post'}</button>
      </div>
      {plan?.blockers.length ? <div className="note" style={{ textAlign: 'right' }}>{plan.blockers.join(' · ')}</div> : null}
    </>
  );
}
