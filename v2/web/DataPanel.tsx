import { useEffect, useState } from 'react';
import { fieldsAsk, parseFieldLines, scenarioAsk } from '../shared/data-tools.ts';
import type { DataEvent, FieldPick, FieldRow, LoanMade, Session, Snapshot } from '../shared/types.ts';
import { ago, get, post } from './api.ts';

const KIND: Record<DataEvent['kind'], string> = { lookup: 'Lookup', update: 'Change', loan: 'Loan', scenario: 'Scenario' };
const MARK: Record<DataEvent['state'], string> = { running: '…', done: '✓', failed: '✗' };
const envWord = (e: string) => (e === 'dev' ? 'Dev' : 'UAT');

export type DataTab = 'fields' | 'loans';
const KINDS: Record<DataTab, DataEvent['kind'][]> = { fields: ['lookup', 'update'], loans: ['loan', 'scenario'] };

/** A tab's events, newest last: Field Finder has the lookups and changes, Loan Forge the loans and scenarios. */
export function tabEvents(s: Session, tab: DataTab): DataEvent[] {
  return (s.data ?? []).filter((e) => KINDS[tab].includes(e.kind));
}

/**
 * Hand the session's Claude an ask: copied, then sent. With its terminal open the tab comes forward
 * to paste into; with none, a tab opens that resumes the session with the ask already sent.
 */
function useAsk(s: Session): [(text: string) => void, string] {
  const [note, setNote] = useState('');
  const send = (text: string) => {
    setNote('Sending…');
    void navigator.clipboard?.writeText(text).catch(() => {});
    post<{ did: string }>(`/api/sessions/${s.id}/ask`, { text })
      .then((r) => setNote(r.did === 'sent' ? 'Sent: a terminal opened on the session with the ask.' : r.did === 'focused' ? 'Copied, and the session’s terminal is in front: paste it there.' : 'Copied: paste it into the session’s Claude.'))
      .catch((e: Error) => setNote(`Copied, but the terminal didn’t open (${e.message}): paste it into the session’s Claude.`));
  };
  return [send, note];
}

/** Field Finder: look up a loan's fields (and change them), and every lookup and change so far. */
export function FieldFinder({ s, snap, loan, lookUp }: { s: Session; snap: Snapshot; loan: string; lookUp: (loan: string) => void }) {
  const events = tabEvents(s, 'fields').reverse();
  const [open, setOpen] = useState(true);
  useEffect(() => { if (loan) setOpen(true); }, [loan]);
  return (
    <div className="dpanel" role="tabpanel" aria-label="Field Finder">
      {!snap.config.fields ? <div className="note">No lookup tool is set up on this machine (verify.json).</div> : (
        <div className="fcard">
          <button type="button" className="fcard-head" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
            <b>Look up a loan’s fields</b>
            <span className="mu" style={{ fontSize: 13 }}>{open ? 'against what this work should set; change them in place' : 'show the form'}</span>
          </button>
          {open && <LookupForm s={s} snap={snap} loan={loan} />}
        </div>
      )}
      {!events.length && <div className="mu" style={{ fontSize: 14 }}>No lookups yet. What Claude or you look up or change shows here as it happens.</div>}
      {events.map((ev, i) => <EventCard key={ev.id} s={s} ev={ev} first={i === 0} lookUp={lookUp} />)}
    </div>
  );
}

/** Loan Forge: the test-data tool, a new loan from a new or saved scenario, and every loan and scenario so far. */
export function LoanForge({ s, snap, lookUp }: { s: Session; snap: Snapshot; lookUp: (loan: string) => void }) {
  const events = tabEvents(s, 'loans').reverse();
  const [error, setError] = useState('');
  const [setup, setSetup] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [down, setDown] = useState('');
  const [again, setAgain] = useState(0);
  const tool = snap.config.testData;
  const run = (p: Promise<unknown>) => { setError(''); p.catch((e: Error) => setError(e.message)); };
  // The scenarios, read again when the tool starts or stops and when one is made here: a read that fails means the tool isn't answering.
  const made = events.filter((e) => e.kind === 'scenario' && e.state === 'done').length;
  useEffect(() => {
    get<{ scenarios: Scenario[] }>('/api/scenarios')
      .then((r) => { setScenarios(r.scenarios); setDown(''); })
      .catch((e: Error) => { setScenarios([]); setDown(e.message); });
  }, [tool.state, made, again]);
  const started = tool.state === 'up' || tool.state === 'starting' || tool.state === 'slow';

  return (
    <div className="dpanel" role="tabpanel" aria-label="Loan Forge">
      {down && tool.state !== 'up' ? (
        <div className="tool-down" role="status">
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <b>{tool.name} {tool.state === 'starting' || tool.state === 'slow' ? 'is starting…' : 'isn’t running'}</b>
            <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
              {tool.launch && !started && <button type="button" className="btn dark small" onClick={() => run(post('/api/test-data/start'))}>Start it</button>}
              {started && <button type="button" className="btn small" onClick={() => run(post('/api/test-data/stop'))}>Stop it</button>}
              <button type="button" className={`btn small${setup ? ' dark' : ''}`} onClick={() => setSetup(!setup)}>{tool.launch ? 'Change where it starts from' : 'Point to its folder'}</button>
              <button type="button" className="btn small" onClick={() => setAgain(again + 1)}>Try again</button>
            </span>
          </div>
          <span style={{ fontSize: 13 }}>
            {tool.launch ? `It starts from ${tool.cwd ?? 'its folder'}${tool.state === 'exited' ? `; it stopped${tool.exitCode !== undefined && tool.exitCode !== null ? ` (exit ${tool.exitCode})` : ''}` : ''}.`
              : 'The app doesn’t know where it is installed yet: point it to the folder and it works out how to start it.'}
          </span>
        </div>
      ) : (
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="k" style={{ display: 'inline' }}>{tool.name}</span>
          <span className="ok" style={{ fontSize: 14 }}>{tool.state === 'up' ? 'running (started here)' : 'running'}</span>
          <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
            {started && <button type="button" className="btn small" onClick={() => run(post('/api/test-data/stop'))}>Stop it</button>}
            <button type="button" className={`btn small${setup ? ' dark' : ''}`} onClick={() => setSetup(!setup)}>{tool.launch ? 'Change how it starts' : 'Set up'}</button>
          </span>
        </div>
      )}
      {setup && <ToolSetup snap={snap} done={() => setSetup(false)} />}
      {tool.tail && tool.tail.length > 0 && (started || tool.state === 'exited') && <pre className="preview" style={{ maxHeight: 140 }}>{tool.tail.join('\n')}</pre>}
      {error && <div className="err" role="alert">{error}</div>}
      {snap.config.loans && <LoanForm s={s} scenarios={down ? null : scenarios} />}
      {!events.length && <div className="mu" style={{ fontSize: 14 }}>No loans yet. What Claude or you make with the test-data tool shows here as it happens.</div>}
      {events.map((ev, i) => <EventCard key={ev.id} s={s} ev={ev} first={i === 0} lookUp={lookUp} />)}
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
  return <span className="segs" role="group" aria-label="Environment">{(['dev', 'uat'] as const).map((e) => <button key={e} type="button" aria-pressed={env === e} className={`seg small${env === e ? ' on' : ''}`} onClick={() => set(e)}>{envWord(e)}</button>)}</span>;
}

const FROM: Record<FieldPick['from'], string> = { claude: 'Claude', you: 'you', ticket: 'ticket', changes: 'changes' };

/** The ids box from picks: "ID = expected" where a value is expected, else the id. */
export function picksText(picks: FieldPick[]): string {
  return picks.map((p) => (p.expect !== undefined ? `${p.id} = ${p.expect}` : p.id)).join('\n');
}

function LookupForm({ s, snap, loan: given }: { s: Session; snap: Snapshot; loan: string }) {
  const [env, setEnv] = useState<'dev' | 'uat'>(s.loans.at(-1)?.env ?? 'dev');
  const [loan, setLoan] = useState(given);
  const [list, setList] = useState('');
  const [ids, setIds] = useState('');
  const [details, setDetails] = useState(snap.config.updates);
  const [picks, setPicks] = useState<FieldPick[] | null>(null);
  const [loans, setLoans] = useState<LoanMade[]>([]);
  const [error, setError] = useState('');
  const [ask, asked] = useAsk(s);
  // The session's loans and fields worth checking: the newest loan and every pick go in to begin with.
  const load = (fill: boolean) => get<{ fields: FieldPick[]; loans: LoanMade[] }>(`/api/sessions/${s.id}/fields${fill ? '?fresh=1' : ''}`).then((r) => {
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
    post(`/api/sessions/${s.id}/data/lookup`, { env, loan, ...(list ? { list } : {}), fields: p.ids, details, ...(Object.keys(p.values).length ? { expect: p.values } : {}) }).catch((e: Error) => setError(e.message));
  };
  const unpick = (id: string) => { post(`/api/sessions/${s.id}/fields`, { fields: [], remove: [id] }).then(() => load(false)).catch((e: Error) => setError(e.message)); };
  return (
    <div className="dform" role="group" aria-label="Look up">
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
          <span className="mu" style={{ fontSize: 13 }}>{picks === null ? 'finding…' : picks.length ? `${picks.length}: Claude’s and yours, the ticket’s, and the ones in the changes` : 'none yet: ask Claude, or they show as it picks them (and ids the ticket or the changes name)'}</span>
          <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
            <button type="button" className="btn small" title="Asks this session’s Claude which fields prove the change, from the ticket and its changes; its picks show here" onClick={() => ask(fieldsAsk({ key: s.key, ...(loan.trim() ? { loan: loan.trim() } : {}) }))}>Check with Claude</button>
            {picks && picks.length > 0 && <button type="button" className="btn small" title="Put these in the ids box" onClick={() => setIds(picksText(picks))}>Fill</button>}
          </span>
        </div>
        {asked && <span className="note">{asked}</span>}
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

interface Scenario { id: string; name: string; version: number; tags: string[]; folder?: string }

/** Make a loan: a new scenario made for this session (by Claude), or a saved one run as it is. Always open. */
function LoanForm({ s, scenarios }: { s: Session; scenarios: Scenario[] | null }) {
  const [mode, setMode] = useState<'new' | 'saved'>('new');
  const [env, setEnv] = useState<'dev' | 'uat'>('dev');
  const [error, setError] = useState('');
  return (
    <div className="fcard" role="group" aria-label="Make a loan">
      <div className="fcard-top">
        <b>Make a loan</b>
        <span className="segs" role="group" aria-label="From">
          <button type="button" aria-pressed={mode === 'new'} className={`seg small${mode === 'new' ? ' on' : ''}`} onClick={() => setMode('new')}>New scenario for this session</button>
          <button type="button" aria-pressed={mode === 'saved'} className={`seg small${mode === 'saved' ? ' on' : ''}`} onClick={() => setMode('saved')}>Run a saved scenario</button>
        </span>
      </div>
      <div className="fgrid">
        <span className="cap">Environment</span>
        <span><EnvPick env={env} set={setEnv} /></span>
        {mode === 'new' ? <NewScenario s={s} env={env} scenarios={scenarios} /> : <SavedScenario s={s} env={env} scenarios={scenarios} setError={setError} />}
      </div>
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}

/**
 * A new scenario for this work: you choose its folder (and a scenario to start from, and anything
 * Claude should know); Claude, in the session's own terminal, writes it from the ticket, the changes
 * and the fields to check, makes it and runs it.
 */
function NewScenario({ s, env, scenarios }: { s: Session; env: 'dev' | 'uat'; scenarios: Scenario[] | null }) {
  const [folder, setFolder] = useState(s.scenarioFolder ?? s.key);
  const [like, setLike] = useState('');
  const [notes, setNotes] = useState('');
  const [asked, setAsked] = useState('');
  const [error, setError] = useState('');
  const [ask, note] = useAsk(s);
  const folders = [...new Set((scenarios ?? []).map((x) => x.folder).filter((f): f is string => Boolean(f)))];
  const saveFolder = (f: string) => { if (f.trim() && f.trim() !== (s.scenarioFolder ?? s.key)) post(`/api/sessions/${s.id}/scenario-folder`, { folder: f.trim() }).catch((e: Error) => setError(e.message)); };
  const go = () => {
    const text = scenarioAsk({ key: s.key, folder: folder.trim() || s.key, ...(like ? { like } : {}), env, notes });
    saveFolder(folder);
    setAsked(text);
    setError('');
    ask(text);
  };
  return (
    <>
      <label className="cap" htmlFor={`folder-${s.id}`}>Folder</label>
      <span>
        <input id={`folder-${s.id}`} type="text" list={`folders-${s.id}`} value={folder} onChange={(e) => setFolder(e.target.value)} onBlur={() => saveFolder(folder)} style={{ width: '100%' }} />
        <datalist id={`folders-${s.id}`}>{folders.map((f) => <option key={f} value={f} />)}</datalist>
      </span>
      <label className="cap" htmlFor={`like-${s.id}`}>Start from</label>
      <select id={`like-${s.id}`} value={like} onChange={(e) => setLike(e.target.value)}>
        <option value="">Whatever fits best (Claude chooses)</option>
        {(scenarios ?? []).map((x) => <option key={x.id} value={x.name}>{x.folder ? `${x.folder} / ` : ''}{x.name} (v{x.version})</option>)}
      </select>
      <label className="cap" htmlFor={`notes-${s.id}`}>Notes</label>
      <textarea id={`notes-${s.id}`} aria-label="Notes for Claude" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything Claude should know: the loan type, a state it must reach, what to leave out" />
      <span />
      <span className="row" style={{ gap: 10 }}>
        <button type="button" className="btn dark" onClick={go}>Ask Claude to make it</button>
        <span className="note">{note || 'Claude writes it from the ticket, the changes and the fields to check, makes it and runs it in ' + envWord(env) + '.'}</span>
      </span>
      {asked && <><span /><pre className="preview" aria-label="The ask for Claude">{asked}</pre></>}
      {error && <><span /><div className="err" role="alert">{error}</div></>}
    </>
  );
}

/** Run a saved scenario: a filter, the list grouped by folder (or first tag), one chosen. */
function SavedScenario({ s, env, scenarios, setError }: { s: Session; env: 'dev' | 'uat'; scenarios: Scenario[] | null; setError: (e: string) => void }) {
  const [scenario, setScenario] = useState('');
  const [filter, setFilter] = useState('');
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (scenarios ?? []).filter((x) => words.every((w) => `${x.name} ${x.folder ?? ''} ${x.tags.join(' ')} v${x.version}`.toLowerCase().includes(w)));
  const groups = new Map<string, Scenario[]>();
  for (const x of shown) { const g = x.folder ?? x.tags[0] ?? 'No folder'; groups.set(g, [...(groups.get(g) ?? []), x]); }
  const chosen = scenarios?.find((x) => x.id === scenario);
  return (
    <>
      <label className="cap" htmlFor={`filter-${s.id}`}>Scenario</label>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input id={`filter-${s.id}`} type="text" aria-label="Filter scenarios" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name, folder, tag or v2" />
        <div className="scen-list" role="listbox" aria-label="Scenarios">
          {scenarios === null && <div className="mu" style={{ padding: 8 }}>The scenarios show once the tool is running.</div>}
          {scenarios && !shown.length && <div className="mu" style={{ padding: 8 }}>{scenarios.length ? 'No scenario matches.' : 'No scenarios.'}</div>}
          {[...groups].map(([g, list]) => (
            <div key={g}>
              <div className="cap scen-group">{g}</div>
              {list.map((x) => (
                <div key={x.id} role="option" aria-selected={x.id === scenario} className={`scen${x.id === scenario ? ' on' : ''}`} onClick={() => setScenario(x.id)}>
                  <span>{x.name}</span><span className="mu mono" style={{ fontSize: 12 }}>v{x.version}</span>
                  <span className="mu" style={{ fontSize: 12 }}>{(x.folder ? x.tags : x.tags.slice(1)).join(', ')}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </span>
      <span />
      <span className="row">
        <button type="button" className="btn dark" disabled={!chosen} onClick={() => { setError(''); post(`/api/sessions/${s.id}/data/loan`, { env, scenario: chosen!.id }).catch((e: Error) => setError(e.message)); }}>{chosen ? `Make a loan from ${chosen.name} in ${envWord(env)}` : 'Pick a scenario'}</button>
      </span>
    </>
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
          {ev.kind === 'scenario' && ev.state === 'done' && (
            <div className="row" style={{ gap: 8 }}>
              <span className="mu" style={{ fontSize: 13 }}>{ev.folder}{ev.scenarioId ? <> · <span className="mono">{ev.scenarioId}</span></> : null}{ev.version !== undefined ? ` · v${ev.version}` : ''}</span>
              {ev.scenarioId && (['dev', 'uat'] as const).map((e) => <button key={e} type="button" className="btn small" onClick={() => void post(`/api/sessions/${s.id}/data/loan`, { env: e, scenario: ev.scenarioId })}>Make a loan in {envWord(e)}</button>)}
            </div>
          )}
          {ev.sent && <details><summary className="mu" style={{ fontSize: 13, cursor: 'pointer' }}>What was sent to the tool</summary><pre className="preview">{ev.sent}</pre></details>}
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
