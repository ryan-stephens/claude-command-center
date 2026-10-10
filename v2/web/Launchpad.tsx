import { useEffect, useRef, useState } from 'react';
import type { Opener, Preflight, Snapshot } from '../shared/types.ts';
import { go, post } from './api.ts';
import { TicketPicker } from './TicketPicker.tsx';

const OPEN_IN: { id: Opener; label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'desktop', label: 'Claude Desktop' },
];

function lastWorkspace(): string {
  try { return localStorage.getItem('ccv2.workspace') ?? ''; } catch { return ''; }
}

export function Launchpad({ snap }: { snap: Snapshot }) {
  const [ws, setWs] = useState(() => {
    const saved = lastWorkspace();
    return snap.workspaces.some((w) => w.id === saved) ? saved : snap.workspaces[0]?.id ?? '';
  });
  const [input, setInput] = useState('');
  const [pf, setPf] = useState<Preflight | null>(null);
  const [repos, setRepos] = useState<Record<string, boolean>>({});
  const [apis, setApis] = useState<Record<string, boolean>>({});
  const [startNow, setStartNow] = useState(false);
  const [opener, setOpener] = useState<Opener>('terminal');
  const [message, setMessage] = useState('');
  const [editMsg, setEditMsg] = useState(false);
  const [showPack, setShowPack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const asked = useRef(0);

  useEffect(() => { try { localStorage.setItem('ccv2.workspace', ws); } catch { /* fine */ } }, [ws]);

  // The preflight follows what is typed, a moment after typing stops.
  useEffect(() => {
    if (!ws || !input.trim()) { setPf(null); return; }
    const n = ++asked.current;
    const t = setTimeout(() => {
      post<Preflight>('/api/preflight', { workspaceId: ws, input })
        .then((p) => {
          if (n !== asked.current) return;
          setPf(p);
          setRepos(Object.fromEntries(p.repos.map((r) => [r.path, r.on])));
          setApis(Object.fromEntries(p.apis.map((a) => [a.name, a.on])));
          if (!editMsg) setMessage(p.firstMessage);
          setError('');
        })
        .catch((e: Error) => { if (n === asked.current) setError(e.message); });
    }, 350);
    return () => clearTimeout(t);
  }, [ws, input]);

  const workspace = snap.workspaces.find((w) => w.id === ws);
  const tickedRepos = pf?.repos.filter((r) => repos[r.path]) ?? [];
  const tickedApis = pf?.apis.filter((a) => apis[a.name]) ?? [];

  async function launch() {
    if (!pf) return;
    setBusy(true);
    setError('');
    try {
      await post('/api/launch', { workspaceId: ws, input, repos: tickedRepos.map((r) => r.path), apis: tickedApis.map((a) => a.name), startStack: startNow, opener, firstMessage: message });
      if (opener === 'desktop') {
        try { await navigator.clipboard.writeText(message); } catch { /* the message is on the Switchboard too */ }
      }
      go('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!snap.workspaces.length) {
    return <section className="card"><b>No workspaces yet.</b><span className="mu">v2 uses v1's workspaces and stacks: make one in v1 (pnpm start, then the workspace menu), and it shows here.</span></section>;
  }

  return (
    <>
      <p className="mu" style={{ margin: 0 }}>Everything set up before Claude reads a word.</p>
      <div className="row" style={{ alignItems: 'flex-start', gap: 22 }}>
        <div style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
          <section className="card">
            <label className="cap" htmlFor="lp-ws">Workspace</label>
            <select id="lp-ws" value={ws} onChange={(e) => setWs(e.target.value)}>
              {snap.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <label htmlFor="lp-ticket" className="cap">Ticket, or just say what to do</label>
            <TicketPicker value={input} onChange={setInput} jira={snap.config.jira} />
            {pf?.ticket ? (
              <>
                <div style={{ fontSize: 20, lineHeight: '28px', fontWeight: 600 }}>{pf.ticket.title}</div>
                {pf.ticket.description && <div className="mu" style={{ fontSize: 15, whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>{pf.ticket.description}</div>}
                <div className="row">
                  {pf.ticket.acceptance.length > 0 && <span className="chip">{pf.ticket.acceptance.length} acceptance criteria</span>}
                  {pf.ticket.links.slice(0, 3).map((l) => <span key={l} className="chip">{l}</span>)}
                  {pf.ticket.url && <a className="chip" href={pf.ticket.url} target="_blank" rel="noreferrer">open the ticket</a>}
                </div>
              </>
            ) : pf ? (
              <div className="mu" style={{ fontSize: 15 }}>{pf.problem ? `${pf.problem} ` : ''}A plain session: <b style={{ color: 'var(--ink)' }}>{pf.title}</b> (<span className="mono">{pf.key}</span>).</div>
            ) : (
              <div className="mu" style={{ fontSize: 15 }}>A ticket key brings its title, criteria and links{snap.config.jira ? '' : ' (no Jira set up on this machine: demo tickets only)'}; anything else becomes a plain session.</div>
            )}
          </section>
        </div>

        <section className="card" style={{ flex: '2 1 560px' }}>
          <div className="row" style={{ alignItems: 'baseline', gap: 12 }}><span className="cap">Preflight</span><span className="mu" style={{ fontSize: 14 }}>built from the ticket and the workspace</span></div>
          {!pf ? <p className="mu" style={{ margin: 0 }}>Type a ticket key or what to do.</p> : (
            <>
              <div className="ln">
                <span className={tickedRepos.length ? 'mark ok' : 'mark need'}>{tickedRepos.length ? '✓' : '!'}</span>
                <div>
                  <b>Repos</b>
                  <div className="row" style={{ marginTop: 6, gap: '6px 16px' }}>
                    {pf.repos.map((r) => (
                      <label key={r.path} className="pick" title={r.why}>
                        <input type="checkbox" checked={Boolean(repos[r.path])} onChange={(e) => { setRepos({ ...repos, [r.path]: e.target.checked }); if (pf.apis.some((a) => a.name === r.name)) setApis({ ...apis, [r.name]: e.target.checked }); }} />
                        <span className="mono">{r.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <span className="mu" style={{ fontSize: 14 }}>{workspace?.name}</span>
              </div>
              <div className="ln">
                <span className="mark ok">✓</span>
                <div><b>Worktrees</b> on <span className="mono">{pf.branch}</span><div className="mu" style={{ fontSize: 14 }}>one per repo beside its checkout, node_modules hard-linked from it</div></div>
                <span className="mono mu">{tickedRepos.length}</span>
              </div>
              <div className="ln">
                <span className="mark ok">✓</span>
                <div><b>Context pack</b><div className="mu" style={{ fontSize: 14 }}>{pf.ticket ? 'ticket + criteria + links, ' : ''}the worktrees, team notes, where the run logs land, which tools it has: CLAUDE.local.md in the home worktree</div>
                  {showPack && <pre className="preview" style={{ marginTop: 10 }}>{pf.contextPreview}</pre>}
                </div>
                <button type="button" className="btn small" onClick={() => setShowPack(!showPack)}>{showPack ? 'Hide' : 'Preview'}</button>
              </div>
              <div className="ln">
                <span className={startNow ? 'mark need' : 'mark ok'}>{startNow ? '●' : '✓'}</span>
                <div>
                  <b>Environment</b>
                  {workspace?.apis.length ? (
                    <>
                      <div className="mu" style={{ fontSize: 14 }}>{workspace.ui ? `${workspace.ui} behind the front door, ` : ''}these APIs from the worktrees; the rest from Dev</div>
                      <div className="row" style={{ marginTop: 6, gap: '6px 16px' }}>
                        {pf.apis.map((a) => (
                          <label key={a.name} className="pick" title={a.why}>
                            <input type="checkbox" checked={Boolean(apis[a.name])} onChange={(e) => setApis({ ...apis, [a.name]: e.target.checked })} />
                            <span className="mono">{a.name}</span>
                          </label>
                        ))}
                      </div>
                      <label className="pick" style={{ marginTop: 8 }}><input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} /> Start it now (otherwise when Claude asks for it, or from the Switchboard)</label>
                    </>
                  ) : <div className="mu" style={{ fontSize: 14 }}>This workspace has no stack yet (write one in v1); Claude works without one.</div>}
                </div>
                <span className={startNow ? 'need' : 'mu'} style={{ fontSize: 14 }}>{startNow ? 'now' : 'on demand'}</span>
              </div>
              <div className="ln">
                <span className="mark ok">✓</span>
                <div><b>Tools for Claude</b>
                  <div className="row" style={{ marginTop: 6, gap: 6 }}>
                    <span className="chip">stack</span>
                    <span className={`chip${snap.config.loans ? '' : ' dashed'}`} title={snap.config.loans ? '' : 'No test-data tool in this machine’s verify.json'}>loans</span>
                    <span className={`chip${snap.config.fields ? '' : ' dashed'}`} title={snap.config.fields ? '' : 'No record lookup in this machine’s verify.json'}>fields</span>
                    <span className="chip">ship</span>
                    <span className="chip dashed">loan setup, later</span>
                  </div>
                </div>
                <span className="mu" style={{ fontSize: 14 }}>MCP</span>
              </div>
              <div className="ln">
                <span className="mark ok">✓</span>
                <div><b>First message</b>
                  {editMsg
                    ? <textarea aria-label="First message" value={message} rows={4} onChange={(e) => setMessage(e.target.value)} style={{ width: '100%', marginTop: 6 }} />
                    : <div className="mu" style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>"{message}"</div>}
                </div>
                <button type="button" className="btn small" onClick={() => setEditMsg(!editMsg)}>{editMsg ? 'Done' : 'Edit'}</button>
              </div>
              <div className="row" style={{ gap: 10, paddingTop: 16, borderTop: '2px solid var(--ink)' }}>
                <span className="cap" style={{ marginRight: 6 }}>Open in</span>
                {OPEN_IN.map((o) => <button key={o.id} type="button" className={`seg${opener === o.id ? ' on' : ''}`} onClick={() => setOpener(o.id)}>{o.label}</button>)}
                <button type="button" className="btn go" style={{ marginLeft: 'auto' }} disabled={busy || !tickedRepos.length} onClick={() => void launch()}>{busy ? 'Setting up…' : 'Launch'}</button>
              </div>
              {opener === 'desktop' && <div className="note">Claude Desktop can’t be opened on a folder from here: Launch copies the first message, then open the home worktree in Claude Desktop’s Code tab. The context, tools and hooks are in the folder.</div>}
              {opener === 'vscode' && <div className="note">Opens the home worktree in VS Code; start Claude there and paste the first message. The context, tools and hooks are in the folder.</div>}
            </>
          )}
          {error && <div className="err" role="alert">{error}</div>}
        </section>
      </div>
    </>
  );
}
