import { useEffect, useState } from 'react';
import type { LogLine } from '../../shared/recipes.ts';
import type { Health, ServiceView, Session, Snapshot, StackView } from '../shared/types.ts';
import { ago, get, go, post } from './api.ts';
import { DataPanel, DataStrip } from './DataPanel.tsx';

const healthWord: Record<Health, string> = { up: 'up', starting: 'starting', unhealthy: 'unhealthy', failed: 'failed', stopped: 'stopped' };
const dotOf = (h: Health) => (h === 'up' ? 'up' : h === 'starting' ? 'st' : h === 'stopped' ? 'off' : 'bad');
const isProblem = (h: Health) => h === 'unhealthy' || h === 'failed';

function claudeClass(s: Session): string {
  return s.claude.state === 'needs-you' ? 'need' : s.claude.state === 'working' ? 'mu' : s.claude.state === 'done' ? 'ok' : 'off';
}
const claudeWord: Record<Session['claude']['state'], string> = { starting: 'opening', working: 'working', 'needs-you': 'needs you', done: 'done', ended: 'closed' };

/** Does a session need looking at: Claude asks, or a service is down? */
function troubled(s: Session, v?: StackView): boolean {
  return s.claude.state === 'needs-you' || Boolean(v?.services.some((x) => isProblem(x.health))) || (s.fields.at(-1)?.differs.length ?? 0) > 0 || s.data?.at(-1)?.state === 'failed';
}

export function Switchboard({ snap }: { snap: Snapshot }) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [error, setError] = useState('');
  const act = (p: Promise<unknown>) => { setError(''); p.catch((e: Error) => setError(e.message)); };
  const list = snap.sessions.filter((s) => !onlyProblems || troubled(s, snap.stacks[s.id]));
  // Your move first, then Claude's, then the rest; newest first within each.
  const rank = (s: Session) => (s.claude.state === 'needs-you' ? 0 : s.claude.state === 'done' ? 1 : s.claude.state === 'working' ? 2 : 3);
  list.sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);

  return (
    <>
      <p className="mu" style={{ margin: 0 }}>Every session's stack: one UI, as many APIs as it needs. Plug a session into the sign-in port to try it.</p>

      {snap.doors.map((d) => (
        <section key={d.home} className="door" aria-label={`Front door on ${d.home}`}>
          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="cap">Front door</span>
            <span className="addr">localhost:{d.home}</span>
            <span style={{ color: 'var(--dark-muted)', fontSize: 14 }}>the one port sign-in accepts; shows one session's UI at a time</span>
          </div>
          <fieldset className="sockets">
            <legend className="cap" style={{ padding: '0 0 8px' }}>Plugged in</legend>
            {d.members.map((m) => (
              <label key={m.sessionId} className={`sock${d.shown === m.sessionId ? ' on' : ''}`}>
                <input type="radio" name={`door-${d.home}`} checked={d.shown === m.sessionId} onChange={() => act(post('/api/door', { sessionId: m.sessionId }))} />
                {m.key}
                <span className="mono">ui :{m.port}</span>
              </label>
            ))}
          </fieldset>
          <a className="btn" href={`http://localhost:${d.home}`} target="_blank" rel="noreferrer">Open</a>
        </section>
      ))}

      <div className="row" style={{ gap: 10 }}>
        <span className="cap">Show</span>
        <button type="button" className={`btn${onlyProblems ? '' : ' dark'}`} onClick={() => setOnlyProblems(false)}>All sessions</button>
        <button type="button" className={`btn${onlyProblems ? ' dark' : ''}`} onClick={() => setOnlyProblems(true)}>Only problems</button>
        <span className="mu" style={{ marginLeft: 'auto', fontSize: 14 }}>APIs not running locally go to Dev, so a session only runs what it changes</span>
      </div>
      {error && <div className="err" role="alert">{error}</div>}

      {!snap.sessions.length && (
        <section className="card">
          <b>No sessions yet.</b>
          <span className="mu">Start one from a ticket: worktrees, context, stack and tools set up, then Claude opens where you work.</span>
          <div><button type="button" className="btn go" onClick={() => go('/new')}>New work</button></div>
        </section>
      )}
      {snap.sessions.length > 0 && !list.length && <p className="mu">Nothing needs looking at.</p>}
      {list.map((s) => <SessionBlock key={s.id} s={s} v={snap.stacks[s.id]} snap={snap} act={act} />)}

      {snap.leftovers.length > 0 && (
        <section className="card" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="cap">Leftovers from last time</span>
          <span style={{ fontSize: 15 }}>{snap.leftovers.map((l) => `${l.key}: ${l.text}`).join(' · ')}</span>
          <span style={{ marginLeft: 'auto' }}><button type="button" className="btn" onClick={() => act(post('/api/leftovers/clean'))}>Clean up</button></span>
        </section>
      )}
    </>
  );
}

function SessionBlock({ s, v, snap, act }: { s: Session; v?: StackView; snap: Snapshot; act: (p: Promise<unknown>) => void }) {
  const [logs, setLogs] = useState<string | null>(null);
  const [menu, setMenu] = useState<'' | 'add' | 'more'>('');
  const [dataOpen, setDataOpen] = useState(false);
  const busy = s.data?.some((e) => e.state === 'running');
  const dataButton = snap.config.loans || snap.config.fields || s.data?.length
    ? <button type="button" className={`btn${dataOpen ? ' dark' : ''}`} aria-expanded={dataOpen} onClick={() => setDataOpen(!dataOpen)}>Data{s.data?.length ? ` · ${s.data.length}` : ''}{busy ? ' …' : ''}</button>
    : null;
  const dataPart = dataOpen ? <DataPanel s={s} snap={snap} /> : <DataStrip s={s} open={() => setDataOpen(true)} />;
  const ws = snap.workspaces.find((w) => w.id === s.workspaceId);
  const ui = v?.services.find((x) => x.kind === 'ui');
  const apis = v?.services.filter((x) => x.kind === 'api') ?? [];
  const loan = s.loans.at(-1);
  const check = s.fields.at(-1);
  const notRunning = (ws?.apis ?? []).filter((a) => !apis.some((x) => x.name.toLowerCase() === a.toLowerCase()));
  const open = () => act(post(`/api/sessions/${s.id}/open`));
  const pr = s.prs.length ? s.prs.map((p) => `PR #${p.number}${p.review === 'APPROVED' ? ' approved' : p.state === 'MERGED' ? ' merged' : ''}`).join(', ') : '';

  if (!v && s.claude.state !== 'needs-you') {
    return (
      <section className="sess folded" aria-label={s.key}>
        <b>{s.key}</b>
        <span className="mu">{s.title} · Claude {claudeWord[s.claude.state]}{s.claude.text ? `: ${s.claude.text}` : ''}{pr ? ` · ${pr}` : ''} · stack stopped</span>
        <span className="row" style={{ marginLeft: 'auto' }}>
          {ws?.apis.length || ws?.ui ? <button type="button" className="btn" onClick={() => act(post(`/api/sessions/${s.id}/stack/up`))}>Start stack</button> : null}
          <button type="button" className="btn" onClick={open}>{s.opener === 'vscode' ? 'VS Code' : 'Terminal'}</button>
          {dataButton}
          <button type="button" className="btn" onClick={() => go(`/ship/${s.id}`)}>Ship</button>
          <More s={s} open={menu === 'more'} toggle={() => setMenu(menu === 'more' ? '' : 'more')} act={act} />
        </span>
        {(dataOpen || s.data?.length) ? <div style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>{dataPart}</div> : null}
      </section>
    );
  }

  const counts = (['up', 'starting', 'unhealthy', 'failed'] as Health[]).map((h) => [h, apis.filter((a) => a.health === h).length] as const).filter(([, n]) => n);
  return (
    <section className={`sess${s.claude.state === 'needs-you' || apis.some((a) => isProblem(a.health)) || (ui && isProblem(ui.health)) ? ' needs' : ''}`} aria-label={s.key}>
      <div className="sess-top">
        <div><span className="k">Session</span><b style={{ fontSize: 18 }}>{s.key}</b><small>{s.title}</small></div>
        <div><span className="k">Claude</span><span className={claudeClass(s)}>{claudeWord[s.claude.state]}</span><small>{s.claude.text}{s.claude.state !== 'starting' ? ` · ${ago(s.claude.at)}` : ''}</small></div>
        <div><span className="k">UI</span>
          {ui ? <><span className={ui.health === 'up' ? 'ok' : isProblem(ui.health) ? 'need' : 'mu'}><span className={`dot ${dotOf(ui.health)}`} /> {ui.name}{ui.port ? ` :${ui.port}` : ''}</span><small>{ui.health !== 'up' ? healthWord[ui.health] + (ui.note ? `: ${ui.note}` : '') : v?.door ? (v.door.shown ? 'in the front door' : 'plug in to try') : 'up'}</small></> : <span className="off">–</span>}
        </div>
        <div><span className="k">Test loan</span>{loan ? <><span className="mono">{loan.loan}</span><small>{loan.env === 'dev' ? 'Dev' : 'UAT'} · {loan.scenario}</small></> : <span className="off">–</span>}</div>
        <div><span className="k">Fields</span>{check ? <><span className={check.differs.length ? 'need' : 'ok'}>{check.matched} / {check.total}</span><small>{check.differs.length ? `${check.differs[0].id} differs` : check.list ?? check.loan}</small></> : <span className="off">–</span>}</div>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn" onClick={open}>{s.opener === 'vscode' ? 'VS Code' : 'Terminal'}</button>
          <button type="button" className="btn" onClick={() => setLogs(logs === null ? (ui ? 'ui' : apis[0]?.name ?? 'ui') : null)}>{logs === null ? 'Logs' : 'Hide logs'}</button>
          {dataButton}
          <button type="button" className="btn" onClick={() => go(`/ship/${s.id}`)}>Ship</button>
        </div>
      </div>

      {apis.length > 0 && (
        <div className="apis">
          {apis.map((a) => <ApiTile key={a.name} a={a} remove={() => act(post(`/api/sessions/${s.id}/stack/remove`, { api: a.name }))} restart={() => act(post(`/api/sessions/${s.id}/stack/restart`, { service: a.name }))} />)}
        </div>
      )}

      {dataPart}

      {logs !== null && <Logs id={s.id} service={logs} services={[...(ui ? ['ui'] : []), ...apis.map((a) => a.name)]} pick={setLogs} />}

      <div className="bar">
        <span>
          {v ? <><b>{apis.length} API{apis.length === 1 ? '' : 's'}</b> <span className="mu">· {counts.map(([h, n]) => `${n} ${healthWord[h]}`).join(' · ') || 'none running'} · the rest from Dev</span></>
            : <span className="mu">Stack stopped.</span>}
          {pr && <span className="mu"> · {pr}</span>}
        </span>
        <span className="row" style={{ marginLeft: 'auto', gap: 6 }}>
          {!s.evidence.some((e) => e.kind === 'tried') && ui?.health === 'up' && <button type="button" className="btn" onClick={() => act(post(`/api/sessions/${s.id}/tried`))}>I tried it: looks good</button>}
          {(ws?.apis.length ?? 0) > 0 && (
            <span className="menu">
              <button type="button" className="btn" disabled={!notRunning.length} onClick={() => setMenu(menu === 'add' ? '' : 'add')}>Add an API</button>
              {menu === 'add' && (
                <span className="menu-list" role="menu">
                  {notRunning.map((a) => <button key={a} type="button" role="menuitem" onClick={() => { setMenu(''); act(post(`/api/sessions/${s.id}/stack/add`, { api: a })); }}>{a}</button>)}
                </span>
              )}
            </span>
          )}
          {v ? (
            <>
              {(apis.some((a) => isProblem(a.health)) || (ui && isProblem(ui.health))) && <button type="button" className="btn" onClick={() => act(post(`/api/sessions/${s.id}/stack/restart`, { unhealthy: true }))}>Restart unhealthy</button>}
              {ui && <button type="button" className="btn" onClick={() => act(post(`/api/sessions/${s.id}/stack/restart`, { service: 'ui' }))}>Restart UI</button>}
              <button type="button" className="btn" onClick={() => act(post(`/api/sessions/${s.id}/stack/down`))}>Stop all</button>
            </>
          ) : (ws?.apis.length || ws?.ui) ? <button type="button" className="btn dark" onClick={() => act(post(`/api/sessions/${s.id}/stack/up`))}>Start stack</button> : null}
          <More s={s} open={menu === 'more'} toggle={() => setMenu(menu === 'more' ? '' : 'more')} act={act} />
        </span>
      </div>
    </section>
  );
}

function ApiTile({ a, remove, restart }: { a: ServiceView; remove: () => void; restart: () => void }) {
  return (
    <div className={`api${isProblem(a.health) ? ' bad' : ''}`}>
      <span className={`dot ${dotOf(a.health)}`} aria-label={healthWord[a.health]} />
      <b title={a.name}>{a.name}</b>
      <span className="row" style={{ gap: 0 }}>
        {isProblem(a.health) && <button type="button" className="x" aria-label={`Restart ${a.name}`} title="Restart" onClick={restart}>↻</button>}
        <button type="button" className="x" aria-label={`Take ${a.name} out`} title="Take it out (back to Dev)" onClick={remove}>×</button>
      </span>
      <span className="w">{a.where}{a.health !== 'up' ? ` · ${a.note ?? healthWord[a.health]}` : ` · ${ago(a.since)}`}</span>
    </div>
  );
}

function More({ s, open, toggle, act }: { s: Session; open: boolean; toggle: () => void; act: (p: Promise<unknown>) => void }) {
  return (
    <span className="menu">
      <button type="button" className="btn" aria-label={`More for ${s.key}`} onClick={toggle}>⋯</button>
      {open && (
        <span className="menu-list" role="menu">
          <button type="button" role="menuitem" onClick={() => { toggle(); act(post(`/api/sessions/${s.id}/open`, { opener: 'terminal' })); }}>Open in a terminal</button>
          <button type="button" role="menuitem" onClick={() => { toggle(); act(post(`/api/sessions/${s.id}/open`, { opener: 'vscode' })); }}>Open in VS Code</button>
          <button type="button" role="menuitem" onClick={() => { toggle(); void navigator.clipboard?.writeText(s.home); }}>Copy the folder path</button>
          <button type="button" role="menuitem" onClick={() => { toggle(); if (confirm(`Remove ${s.key} from Command Center? Its worktrees stay.`)) act(post(`/api/sessions/${s.id}/remove`, { worktrees: false })); }}>Remove (keep worktrees)</button>
          <button type="button" role="menuitem" onClick={() => { toggle(); if (confirm(`Remove ${s.key} and its worktrees? A worktree with uncommitted changes is kept.`)) act(post(`/api/sessions/${s.id}/remove`, { worktrees: true })); }}>Remove with its worktrees</button>
        </span>
      )}
    </span>
  );
}

function Logs({ id, service, services, pick }: { id: string; service: string; services: string[]; pick: (s: string) => void }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => get<{ lines: LogLine[] }>(`/api/sessions/${id}/logs?service=${encodeURIComponent(service)}`).then((r) => { if (live) setLines(r.lines); }).catch(() => {});
    void load();
    const t = setInterval(load, 2000);
    return () => { live = false; clearInterval(t); };
  }, [id, service]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row" style={{ gap: 6 }}>
        {services.map((sv) => <button key={sv} type="button" className={`btn small${sv === service ? ' dark' : ''}`} onClick={() => pick(sv)}>{sv}</button>)}
      </div>
      <div className="drawer" aria-label={`${service} output`}>{lines.length ? lines.map((l) => l.text).join('\n') : 'Nothing printed yet.'}</div>
    </div>
  );
}
