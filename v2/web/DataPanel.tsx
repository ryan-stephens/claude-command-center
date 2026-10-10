import { useEffect, useState } from 'react';
import { parseFieldLines } from '../shared/data-tools.ts';
import type { DataEvent, FieldPick, FieldRow, LoanMade, Session, Snapshot } from '../shared/types.ts';
import { ago, get, post } from './api.ts';

const KIND: Record<DataEvent['kind'], string> = { lookup: 'Lookup', update: 'Change', loan: 'Loan' };
const MARK: Record<DataEvent['state'], string> = { running: '…', done: '✓', failed: '✗' };
const envWord = (e: string) => (e === 'dev' ? 'Dev' : 'UAT');

/** The latest data event, one line, under the session's block (click opens the panel). */
export function DataStrip({ s, open }: { s: Session; open: () => void }) {
  const ev = s.data?.at(-1);
  if (!ev) return null;
  const bad = ev.state === 'failed' || ev.rows?.some((r) => r.ok === false || r.applied === 'differs');
  return (
    <button type="button" className={`dstrip${bad ? ' bad' : ''}`} onClick={open} aria-label="Open the Data panel">
      <span className="dmark">{MARK[ev.state]}</span>
      <span className="k" style={{ display: 'inline' }}>{KIND[ev.kind]}</span>
      <span className="dstrip-title">{ev.error ?? ev.title}</span>
      <span className="mu" style={{ fontSize: 12 }}>{ev.by === 'claude' ? 'Claude' : 'you'} · {ago(ev.at)}</span>
    </button>
  );
}

/** The session's data tools: the test-data tool, a lookup, a new loan, and everything done so far. */
export function DataPanel({ s, snap }: { s: Session; snap: Snapshot }) {
  const [form, setForm] = useState<'' | 'lookup' | 'loan'>('');
  const [error, setError] = useState('');
  const [loanFor, setLoanFor] = useState('');
  const [setup, setSetup] = useState(false);
  const events = [...(s.data ?? [])].reverse();
  const tool = snap.config.testData;
  const toolWord = tool.state === 'up' ? 'running (started here)' : tool.state === 'starting' ? 'starting…' : tool.state === 'slow' ? 'started, not answering yet' : tool.state === 'exited' ? `stopped${tool.exitCode !== undefined && tool.exitCode !== null ? ` (exit ${tool.exitCode})` : ''}` : 'not started from here';
  const run = (p: Promise<unknown>) => { setError(''); p.catch((e: Error) => setError(e.message)); };

  return (
    <div className="dpanel" role="region" aria-label="Data">
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="k" style={{ display: 'inline' }}>{tool.name}</span>
          <span className={tool.state === 'up' ? 'ok' : tool.state === 'exited' ? 'need' : 'mu'} style={{ fontSize: 14 }}>{tool.launch ? toolWord : 'not set up to start from here'}</span>
          {tool.launch && tool.state !== 'up' && tool.state !== 'starting' && <button type="button" className="btn small" onClick={() => run(post('/api/test-data/start'))}>Start it</button>}
          {(tool.state === 'up' || tool.state === 'starting' || tool.state === 'slow') && <button type="button" className="btn small" onClick={() => run(post('/api/test-data/stop'))}>Stop it</button>}
          <button type="button" className={`btn small${setup ? ' dark' : ''}`} onClick={() => setSetup(!setup)}>{tool.launch ? 'Change how it starts' : 'Set up'}</button>
        </span>
        <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
          {snap.config.fields && <button type="button" className={`seg small${form === 'lookup' ? ' on' : ''}`} onClick={() => setForm(form === 'lookup' ? '' : 'lookup')}>Look up fields</button>}
          {snap.config.loans && <button type="button" className={`seg small${form === 'loan' ? ' on' : ''}`} onClick={() => setForm(form === 'loan' ? '' : 'loan')}>New loan</button>}
        </span>
      </div>
      {setup && <ToolSetup snap={snap} done={() => setSetup(false)} />}
      {tool.tail && tool.tail.length > 0 && <pre className="preview" style={{ maxHeight: 140 }}>{tool.tail.join('\n')}</pre>}
      {form === 'lookup' && <LookupForm s={s} snap={snap} loan={loanFor} done={() => setForm('')} />}
      {form === 'loan' && <LoanForm s={s} done={() => setForm('')} />}
      {error && <div className="err" role="alert">{error}</div>}
      {!events.length && <div className="mu" style={{ fontSize: 14 }}>Nothing yet. What Claude looks up, changes or makes with these tools shows here as it happens; so does what you do.</div>}
      {events.map((ev, i) => <EventCard key={ev.id} s={s} ev={ev} first={i === 0} lookUp={(loan) => { setLoanFor(loan); setForm('lookup'); }} />)}
    </div>
  );
}

interface StartOption { id: string; kind: 'api' | 'ui' | 'script'; label: string; command: string; url?: string; on: boolean }

/** Where the test-data tool is installed, and what of it to start: found by its name, or a folder you give. */
function ToolSetup({ snap, done }: { snap: Snapshot; done: () => void }) {
  const tool = snap.config.testData;
  const [folder, setFolder] = useState(tool.cwd ?? '');
  const [found, setFound] = useState<string[] | null>(null);
  const [look, setLook] = useState<{ folder: string; options: StartOption[]; url?: string; problem?: string } | null>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [url, setUrl] = useState('');
  const [name, setName] = useState(tool.name === 'The test-data tool' ? '' : tool.name);
  const [error, setError] = useState('');
  useEffect(() => { get<{ found: string[] }>('/api/test-data/find').then((r) => setFound(r.found)).catch(() => setFound([])); }, []);
  const lookIn = (f: string) => {
    setFolder(f);
    setError('');
    post<{ folder: string; options: StartOption[]; url?: string; problem?: string }>('/api/test-data/look', { folder: f }).then((r) => {
      setLook(r);
      setPick(Object.fromEntries(r.options.map((o) => [o.id, o.on])));
      setUrl(r.url ?? '');
    }).catch((e: Error) => setError(e.message));
  };
  const save = () => {
    setError('');
    post('/api/test-data/save', { folder: look!.folder, pick: Object.keys(pick).filter((k) => pick[k]), url, ...(name.trim() ? { name } : {}) }).then(done).catch((e: Error) => setError(e.message));
  };
  return (
    <div className="dform" role="group" aria-label="Set up the test-data tool">
      <div className="mu" style={{ fontSize: 14 }}>Where is it installed? The app reads that folder and works out how to start it; nothing is run until you press Start it.</div>
      {found && found.length > 0 && (
        <div className="row" style={{ gap: 6 }}><span className="cap">Found</span>{found.map((f) => <button key={f} type="button" className="btn small mono" onClick={() => lookIn(f)}>{f}</button>)}</div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <input type="text" className="mono" aria-label="Installed folder" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="C:\path	o	he	ool" style={{ flex: '1 1 360px' }} onKeyDown={(e) => { if (e.key === 'Enter' && folder.trim()) lookIn(folder.trim()); }} />
        <button type="button" className="btn" disabled={!folder.trim()} onClick={() => lookIn(folder.trim())}>Look in this folder</button>
      </div>
      {look && (
        <>
          {look.problem && <div className="note">{look.problem}</div>}
          {look.options.map((o) => (
            <label key={o.id} className="pick" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={Boolean(pick[o.id])} onChange={(e) => setPick({ ...pick, [o.id]: e.target.checked })} />
              <span><b>{o.label}</b>{o.url ? <span className="mu"> · {o.url}</span> : null}<br /><span className="mono mu">$ {o.command}</span></span>
            </label>
          ))}
          {look.options.length > 0 && (
            <div className="row" style={{ gap: 8 }}>
              <input type="text" className="mono" aria-label="Its API address" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:5000" style={{ flex: '1 1 240px' }} />
              <input type="text" aria-label="What to call it" value={name} onChange={(e) => setName(e.target.value)} placeholder="What to call it" style={{ flex: '0 1 200px' }} />
              <button type="button" className="btn dark" disabled={!Object.values(pick).some(Boolean)} onClick={save}>Save</button>
            </div>
          )}
        </>
      )}
      {error && <div className="err" role="alert">{error}</div>}
      <span className="note">Saved in this machine’s verify.json, never the repo.</span>
    </div>
  );
}

function EnvPick({ env, set }: { env: 'dev' | 'uat'; set: (e: 'dev' | 'uat') => void }) {
  return <>{(['dev', 'uat'] as const).map((e) => <button key={e} type="button" className={`seg small${env === e ? ' on' : ''}`} onClick={() => set(e)}>{envWord(e)}</button>)}</>;
}

const FROM: Record<FieldPick['from'], string> = { claude: 'Claude', you: 'you', ticket: 'ticket', changes: 'changes' };

/** The ids box from picks: "ID = expected" where a value is expected, else the id. */
export function picksText(picks: FieldPick[]): string {
  return picks.map((p) => (p.expect !== undefined ? `${p.id} = ${p.expect}` : p.id)).join('\n');
}

function LookupForm({ s, snap, loan: given, done }: { s: Session; snap: Snapshot; loan: string; done: () => void }) {
  const [env, setEnv] = useState<'dev' | 'uat'>(s.loans.at(-1)?.env ?? 'dev');
  const [loan, setLoan] = useState(given);
  const [list, setList] = useState('');
  const [ids, setIds] = useState('');
  const [details, setDetails] = useState(snap.config.updates);
  const [picks, setPicks] = useState<FieldPick[] | null>(null);
  const [loans, setLoans] = useState<LoanMade[]>([]);
  const [error, setError] = useState('');
  // The session's loans and fields worth checking: the newest loan and every pick go in to begin with.
  const load = (fill: boolean) => get<{ fields: FieldPick[]; loans: LoanMade[] }>(`/api/sessions/${s.id}/fields`).then((r) => {
    setPicks(r.fields);
    setLoans(r.loans);
    if (fill) {
      setLoan((l) => l || r.loans[0]?.loan || '');
      if (r.loans[0] && !given) setEnv(r.loans[0].env);
      setIds((x) => x || picksText(r.fields));
    }
  }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(true); }, [s.fieldPicks?.length]);
  useEffect(() => { if (given) setLoan(given); }, [given]);
  const go = () => {
    const p = parseFieldLines(ids);
    setError('');
    post(`/api/sessions/${s.id}/data/lookup`, { env, loan, ...(list ? { list } : {}), fields: p.ids, details, ...(Object.keys(p.values).length ? { expect: p.values } : {}) }).then(done).catch((e: Error) => setError(e.message));
  };
  const unpick = (id: string) => { post(`/api/sessions/${s.id}/fields`, { fields: [], remove: [id] }).then(() => load(false)).catch((e: Error) => setError(e.message)); };
  return (
    <div className="dform" role="group" aria-label="Look up fields">
      <div className="row" style={{ gap: 8 }}>
        <EnvPick env={env} set={setEnv} />
        <input type="text" className="mono" aria-label="Loan id" value={loan} onChange={(e) => setLoan(e.target.value)} placeholder="loan id (guid)" style={{ flex: '1 1 300px' }} />
        {loans.length > 0 && (
          <select aria-label="A loan from this session" value="" onChange={(e) => { const l = loans.find((x) => x.loan === e.target.value); if (l) { setLoan(l.loan); setEnv(l.env); } }}>
            <option value="">Loans made here ({loans.length})</option>
            {loans.map((l) => <option key={`${l.loan}${l.at}`} value={l.loan}>{l.loan.slice(0, 8)}… · {envWord(l.env)} · {l.scenario} · {ago(l.at)}</option>)}
          </select>
        )}
      </div>
      <div className="picks-box">
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <span className="cap">Fields to check for this session</span>
          <span className="mu" style={{ fontSize: 13 }}>{picks === null ? 'finding…' : picks.length ? `${picks.length}: Claude’s and yours, the ticket’s, and the ones in the changes` : 'none yet: Claude picks them as it works (set_fields_to_check), and ids in the ticket or the changes show here'}</span>
          {picks && picks.length > 0 && <button type="button" className="btn small" style={{ marginLeft: 'auto' }} onClick={() => setIds(picksText(picks))}>Fill the box with these</button>}
        </div>
        {picks && picks.length > 0 && (
          <div className="row" style={{ gap: 6 }}>
            {picks.map((p) => (
              <span key={p.id} className={`chip pick-chip ${p.from}`} title={[p.why, p.expect !== undefined ? `should be ${p.expect}` : ''].filter(Boolean).join(' · ')}>
                <span className="mono">{p.id}</span>{p.expect !== undefined && <span className="mu">= {p.expect}</span>}<span className="from">{FROM[p.from]}</span>
                {(p.from === 'claude' || p.from === 'you') && <button type="button" className="x" aria-label={`Drop ${p.id}`} onClick={() => unpick(p.id)}>×</button>}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <select aria-label="Saved field list" value={list} onChange={(e) => setList(e.target.value)}>
          <option value="">No saved list</option>
          {snap.config.fieldLists.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <span className="mu" style={{ fontSize: 13 }}>and these, one a line (ID = value to expect one):</span>
      </div>
      <textarea aria-label="Field ids" rows={Math.min(8, Math.max(3, ids.split('\n').length))} value={ids} onChange={(e) => setIds(e.target.value)} placeholder="CX.SAMPLE.ONE" className="mono" />
      <div className="row" style={{ gap: 10 }}>
        <label className="pick"><input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} /> Details: read-only, options{snap.config.updates ? ', and edit in place' : ''}</label>
        <button type="button" className="btn dark" style={{ marginLeft: 'auto' }} disabled={!loan.trim() || (!list && !ids.trim())} onClick={go}>Look up</button>
      </div>
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}

interface Scenario { id: string; name: string; version: number; tags: string[] }

/** Run a saved scenario: a filter, the list grouped by its first tag, then Dev or UAT. */
function LoanForm({ s, done }: { s: Session; done: () => void }) {
  const [env, setEnv] = useState<'dev' | 'uat'>('dev');
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [scenario, setScenario] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    get<{ scenarios: Scenario[] }>('/api/scenarios')
      .then((r) => setScenarios(r.scenarios))
      .catch((e: Error) => { setScenarios([]); setError(e.message); });
  }, []);
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (scenarios ?? []).filter((x) => words.every((w) => `${x.name} ${x.tags.join(' ')} v${x.version}`.toLowerCase().includes(w)));
  const groups = new Map<string, Scenario[]>();
  for (const x of shown) { const g = x.tags[0] ?? 'No tag'; groups.set(g, [...(groups.get(g) ?? []), x]); }
  const chosen = scenarios?.find((x) => x.id === scenario);
  return (
    <div className="dform" role="group" aria-label="New loan">
      <div className="row" style={{ gap: 8 }}>
        <span className="cap">Run a saved scenario</span>
        <input type="text" aria-label="Filter scenarios" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name, tag or v2" style={{ flex: '1 1 240px' }} />
      </div>
      <div className="scen-list" role="listbox" aria-label="Scenarios">
        {scenarios === null && <div className="mu" style={{ padding: 8 }}>Reading the scenarios…</div>}
        {scenarios && !shown.length && <div className="mu" style={{ padding: 8 }}>{scenarios.length ? 'No scenario matches.' : 'No scenarios.'}</div>}
        {[...groups].map(([g, list]) => (
          <div key={g}>
            <div className="cap scen-group">{g}</div>
            {list.map((x) => (
              <div key={x.id} role="option" aria-selected={x.id === scenario} className={`scen${x.id === scenario ? ' on' : ''}`} onClick={() => setScenario(x.id)}>
                <span>{x.name}</span><span className="mu mono" style={{ fontSize: 12 }}>v{x.version}</span>
                <span className="mu" style={{ fontSize: 12 }}>{x.tags.slice(1).join(', ')}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <EnvPick env={env} set={setEnv} />
        <button type="button" className="btn dark" style={{ marginLeft: 'auto' }} disabled={!chosen} onClick={() => { setError(''); post(`/api/sessions/${s.id}/data/loan`, { env, scenario: chosen!.id }).then(done).catch((e: Error) => setError(e.message)); }}>{chosen ? `Make a loan from ${chosen.name} in ${envWord(env)}` : 'Pick a scenario'}</button>
      </div>
      <span className="note">A new scenario made for this ticket is coming once the tool’s create API is known; until then, run a saved one.</span>
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}

function EventCard({ s, ev, first, lookUp }: { s: Session; ev: DataEvent; first: boolean; lookUp: (loan: string) => void }) {
  // The newest is open until you say otherwise; the rest only when you open them.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? first;
  const setOpen = (v: boolean) => setChosen(v);
  const bad = ev.state === 'failed' || ev.rows?.some((r) => r.ok === false || r.applied === 'differs' || (ev.kind === 'lookup' && r.value === null));
  return (
    <div className={`devent ${ev.state}${bad ? ' bad' : ''}`}>
      <button type="button" className="devent-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="dmark">{MARK[ev.state]}</span>
        <b>{KIND[ev.kind]}</b>
        <span className="devent-title">{ev.title}</span>
        <span className="mu" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{envWord(ev.env)} · {ev.by === 'claude' ? 'Claude' : 'you'} · {ago(ev.at)}</span>
      </button>
      {open && (
        <div className="devent-body">
          {ev.error && <div className="err">{ev.error}</div>}
          {ev.steps && ev.steps.length > 0 && (
            <ol className="dsteps">{ev.steps.map((st) => <li key={st.order} className={st.status === 'succeeded' ? 'done' : st.status === 'failed' ? 'failed' : 'running'}><span className="dmark">{st.status === 'succeeded' ? '✓' : st.status === 'failed' ? '✗' : st.status === 'running' ? '…' : '·'}</span>{st.order}. {st.type}{st.error ? `: ${st.error}` : ''}</li>)}</ol>
          )}
          {ev.loans && ev.loans.length > 0 && (
            <div className="row" style={{ gap: 8 }}>{ev.loans.map((l) => <span key={l} className="row" style={{ gap: 6 }}><span className="mono">{l}</span><button type="button" className="btn small" onClick={() => void navigator.clipboard?.writeText(l)}>Copy</button><button type="button" className="btn small" onClick={() => lookUp(l)}>Look up</button></span>)}</div>
          )}
          {ev.rows && <Rows s={s} ev={ev} />}
          {ev.watchUrl && <a href={ev.watchUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>The lookup's progress page for this change</a>}
        </div>
      )}
    </div>
  );
}

/** The fields of a lookup or a change; a details lookup's changeable fields can be edited here and sent. */
function Rows({ s, ev }: { s: Session; ev: DataEvent }) {
  const [staged, setStaged] = useState<Record<string, string>>({});
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState('');
  const editing = ev.kind === 'lookup' && ev.state === 'done' && ev.rows!.some((r) => r.editable);
  const n = Object.keys(staged).length;
  const stage = (r: FieldRow, v: string) => { setArmed(false); setStaged((x) => { const y = { ...x }; if (v === (r.value ?? '') ) delete y[r.id]; else y[r.id] = v; return y; }); };
  const send = () => {
    if (!armed) { setArmed(true); return; }
    setError('');
    post(`/api/sessions/${s.id}/data/update`, { env: ev.env, loan: ev.loan, set: staged }).then(() => { setStaged({}); setArmed(false); }).catch((e: Error) => { setError(e.message); setArmed(false); });
  };
  const showExpected = ev.rows!.some((r) => r.expected !== undefined);
  const showSent = ev.kind === 'update';
  return (
    <>
      <table className="ddiff">
        <thead><tr><th>Field</th><th>{showSent ? 'Now' : 'Value'}</th>{showExpected && <th>Expected</th>}{showSent && <th>Sent</th>}{editing && <th>New value</th>}<th /></tr></thead>
        <tbody>
          {ev.rows!.map((r) => (
            <tr key={r.id} className={r.ok === false || r.applied === 'differs' || r.value === null ? 'bad' : ''}>
              <td className="mono">{r.id}</td>
              <td>{r.value === null ? <span className="off">not on the loan</span> : r.value === '' ? <span className="off">(empty)</span> : r.value}</td>
              {showExpected && <td>{r.expected ?? ''}</td>}
              {showSent && <td>{r.sent === '' ? '(cleared)' : r.sent}</td>}
              {editing && (
                <td>{r.editable ? (r.options?.length
                  ? <select aria-label={`New value for ${r.id}`} value={staged[r.id] ?? r.value ?? ''} onChange={(e) => stage(r, e.target.value)}><option value="">(empty)</option>{r.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                  : <input type="text" aria-label={`New value for ${r.id}`} value={staged[r.id] ?? r.value ?? ''} onChange={(e) => stage(r, e.target.value)} />)
                  : <span className="off">{r.readOnly ? 'read-only' : ''}</span>}</td>
              )}
              <td className="mu" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{r.applied ?? (r.ok === true ? '✓' : r.ok === false ? 'differs' : r.readOnly && !editing ? 'read-only' : '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && n > 0 && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className={`btn${armed ? ' dark' : ''}`} onClick={send}>{armed ? `Send ${n} change(s) to ${envWord(ev.env)}: sure?` : `Change ${n} field(s) in ${envWord(ev.env)}`}</button>
          <button type="button" className="btn" onClick={() => { setStaged({}); setArmed(false); }}>Undo</button>
          <span className="note">Sent through the record lookup, then read again until it shows.</span>
        </div>
      )}
      {error && <div className="err" role="alert">{error}</div>}
    </>
  );
}
