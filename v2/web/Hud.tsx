import { useEffect } from 'react';
import type { Session, Snapshot, StackView } from '../shared/types.ts';
import { ago, post } from './api.ts';

/** What a session's one HUD line says, and the one thing to do about it. */
function line(s: Session, v: StackView | undefined): { tone: 'needs' | 'working' | 'parked'; text: string; action: string; does: 'open' | 'try' | 'logs' | 'ship' } {
  const bad = v?.services.filter((x) => x.health === 'unhealthy' || x.health === 'failed') ?? [];
  const ui = v?.services.find((x) => x.kind === 'ui');
  const check = s.fields.at(-1);
  const pr = s.prs[0];
  if (s.claude.state === 'needs-you') return { tone: 'needs', text: s.claude.text, action: 'Answer', does: 'open' };
  if (bad.length) return { tone: s.claude.state === 'working' ? 'working' : 'needs', text: `${bad.map((b) => b.name).join(', ')} ${bad.length === 1 ? 'is' : 'are'} ${bad[0].health}`, action: 'Logs', does: 'logs' };
  if (s.claude.state === 'done' && ui?.health === 'up') return { tone: 'needs', text: `done · app up${check ? ` · fields ${check.matched}/${check.total}` : ''}`, action: 'Try it', does: 'try' };
  if (s.claude.state === 'working') return { tone: 'working', text: `working ${ago(s.claude.at)} · ${s.claude.text}`, action: 'Terminal', does: 'open' };
  if (pr) return { tone: 'parked', text: `PR #${pr.number}${pr.review ? ` · ${pr.review.toLowerCase().replace(/_/g, ' ')}` : ''}${pr.checks && pr.checks !== 'none' ? ` · build ${pr.checks === 'pass' ? '✓' : pr.checks}` : ''}`, action: 'Ship dock', does: 'ship' };
  if (s.claude.state === 'done') return { tone: 'needs', text: s.claude.text || 'your move', action: 'Answer', does: 'open' };
  return { tone: 'parked', text: s.claude.text, action: 'Terminal', does: 'open' };
}

export function Hud({ snap }: { snap: Snapshot | null }) {
  useEffect(() => { document.title = 'Command Center HUD'; }, []);
  if (!snap) return <div className="hud"><span className="s">Connecting…</span></div>;
  const rows = snap.sessions.map((s) => ({ s, l: line(s, snap.stacks[s.id]) }));
  const order = { needs: 0, working: 1, parked: 2 };
  rows.sort((a, b) => order[a.l.tone] - order[b.l.tone] || a.s.claude.at - b.s.claude.at);
  const needs = rows.filter((r) => r.l.tone === 'needs').length;
  const working = rows.filter((r) => r.l.tone === 'working').length;
  const main = (path: string) => { window.opener ? (window.opener as Window).location.assign(path) : window.open(path, 'cc-main'); };
  const doIt = (r: (typeof rows)[number]) => {
    if (r.l.does === 'open') void post(`/api/sessions/${r.s.id}/open`).catch(() => {});
    else if (r.l.does === 'try') { void post('/api/door', { sessionId: r.s.id }).catch(() => {}); const url = snap.stacks[r.s.id]?.uiUrl; if (url) window.open(url, '_blank'); }
    else if (r.l.does === 'ship') main(`/ship/${r.s.id}`);
    else main('/');
  };
  return (
    <div className="hud">
      <div className="row" style={{ padding: '0 4px 6px' }}>
        <b style={{ fontSize: 15 }}>Command Center</b>
        <span className="s" style={{ marginLeft: 'auto' }}>{needs} need you · {working} working</span>
      </div>
      {!rows.length && <span className="s">No sessions yet.</span>}
      {rows.map((r) => (
        <div key={r.s.id} className={`hud-row${r.l.tone === 'needs' ? ' needs' : r.l.tone === 'parked' ? ' parked' : ''}`}>
          <span className="dot" style={{ background: r.l.tone === 'working' ? '#2fa59f' : r.l.tone === 'needs' ? 'var(--signal)' : '#7a818d' }} />
          <div style={{ minWidth: 0 }}>
            <div className="t">{r.s.key}</div>
            <div className="s" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.l.text}>{r.l.text}</div>
          </div>
          <button type="button" className={`btn${r.l.tone === 'needs' ? ' go' : ''}`} onClick={() => doIt(r)}>{r.l.action}</button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 'auto', gap: 8 }}>
        <button type="button" className="btn grow" onClick={() => main('/new')}>New work</button>
        <button type="button" className="btn grow" onClick={() => main('/')}>Switchboard</button>
      </div>
      <div className="s" style={{ textAlign: 'center' }}>Answer brings that session’s terminal forward</div>
    </div>
  );
}
