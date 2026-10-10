import { useEffect, useState } from 'react';
import { parseFieldLines } from '../shared/data-tools.ts';
import type { DataEvent, FieldRow, Session, Snapshot } from '../shared/types.ts';
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
      {form === 'lookup' && <LookupForm s={s} snap={snap} loan={loanFor || s.loans.at(-1)?.loan || ''} done={() => setForm('')} />}
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

function LookupForm({ s, snap, loan: given, done }: { s: Session; snap: Snapshot; loan: string; done: () => void }) {
  const [env, setEnv] = useState<'dev' | 'uat'>(s.loans.at(-1)?.env ?? 'dev');
  const [loan, setLoan] = useState(given);
  const [list, setList] = useState('');
  const [ids, setIds] = useState('');
  const [details, setDetails] = useState(snap.config.updates);
  const [error, setError] = useState('');
  useEffect(() => setLoan(given), [given]);
  const go = () => {
    const p = parseFieldLines(ids);
    setError('');
    post(`/api/sessions/${s.id}/data/lookup`, { env, loan, ...(list ? { list } : {}), fields: p.ids, details, ...(Object.keys(p.values).length ? { expect: p.values } : {}) }).then(done).catch((e: Error) => setError(e.message));
  };
  return (
    <div className="dform" role="group" aria-label="Look up fields">
      <div className="row" style={{ gap: 8 }}>
        <EnvPick env={env} set={setEnv} />
        <input type="text" className="mono" aria-label="Loan id" value={loan} onChange={(e) => setLoan(e.target.value)} placeholder="loan id" style={{ flex: '1 1 300px' }} />
        <select aria-label="Saved field list" value={list} onChange={(e) => setList(e.target.value)}>
          <option value="">No saved list</option>
          {snap.config.fieldLists.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <textarea aria-label="Field ids" rows={3} value={ids} onChange={(e) => setIds(e.target.value)} placeholder={'Field ids, one a line (ID = value to expect one)'} className="mono" />
      <div className="row" style={{ gap: 10 }}>
        <label className="pick"><input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} /> Details: read-only, options{snap.config.updates ? ', and edit in place' : ''}</label>
        <button type="button" className="btn dark" style={{ marginLeft: 'auto' }} disabled={!loan.trim() || (!list && !ids.trim())} onClick={go}>Look up</button>
      </div>
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}

function LoanForm({ s, done }: { s: Session; done: () => void }) {
  const [env, setEnv] = useState<'dev' | 'uat'>('dev');
  const [scenarios, setScenarios] = useState<{ id: string; name: string; tags: string[] }[] | null>(null);
  const [scenario, setScenario] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    get<{ scenarios: { id: string; name: string; tags: string[] }[] }>('/api/scenarios')
      .then((r) => { setScenarios(r.scenarios); setScenario(r.scenarios[0]?.name ?? ''); })
      .catch((e: Error) => { setScenarios([]); setError(e.message); });
  }, []);
  return (
    <div className="dform" role="group" aria-label="New loan">
      <div className="row" style={{ gap: 8 }}>
        <EnvPick env={env} set={setEnv} />
        <select aria-label="Scenario" value={scenario} onChange={(e) => setScenario(e.target.value)} style={{ flex: '1 1 260px' }}>
          {scenarios === null ? <option>Loading…</option> : scenarios.map((x) => <option key={x.id} value={x.name}>{x.name}{x.tags.length ? ` · ${x.tags.join(', ')}` : ''}</option>)}
        </select>
        <button type="button" className="btn dark" disabled={!scenario} onClick={() => { setError(''); post(`/api/sessions/${s.id}/data/loan`, { env, scenario }).then(done).catch((e: Error) => setError(e.message)); }}>Make the loan</button>
      </div>
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
