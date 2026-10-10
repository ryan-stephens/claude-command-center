import { useEffect, useState } from 'react';
import { parseFieldLines, STEP_WORD } from '../shared/data-check.ts';
import type { DataCheck, DataCheckAsk, Session, Snapshot } from '../shared/types.ts';
import { ago, get, post } from './api.ts';

const MARK: Record<DataCheck['steps'][number]['state'], string> = { waiting: '·', running: '…', done: '✓', failed: '✗', skipped: '–' };
const WORD: Record<DataCheck['state'], string> = { running: 'Running', passed: 'Passed', differs: 'Differs', failed: 'Failed' };

/** The session's latest data check, step by step, with what differs. */
export function CheckView({ c }: { c: DataCheck }) {
  const differs = c.result?.differs ?? [];
  return (
    <div className={`dcheck ${c.state}`} aria-label="Data check">
      <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
        <span className="k" style={{ display: 'inline' }}>Data check</span>
        <b className={c.state === 'passed' ? 'ok' : c.state === 'running' ? '' : 'need'}>{WORD[c.state]}</b>
        <span className="mu" style={{ fontSize: 13 }}>{c.ask.env === 'dev' ? 'Dev' : 'UAT'} · by {c.by === 'claude' ? 'Claude' : 'you'} · {ago(c.endedAt ?? c.startedAt)}</span>
        {c.watchUrl && <a href={c.watchUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>update progress</a>}
      </div>
      <ol className="dsteps">
        {c.steps.filter((s) => s.state !== 'skipped').map((s) => (
          <li key={s.name} className={s.state}><span className="dmark">{MARK[s.state]}</span><b>{STEP_WORD[s.name]}</b> <span className={s.name === 'loan' && c.loan ? 'mono' : ''}>{s.text}</span></li>
        ))}
      </ol>
      {differs.length > 0 && (
        <table className="ddiff">
          <thead><tr><th>Field</th><th>Expected</th><th>Read</th></tr></thead>
          <tbody>{differs.map((d) => <tr key={d.id}><td className="mono">{d.id}</td><td>{d.expected ?? '(there)'}</td><td>{d.actual ?? (c.values?.[d.id] === null ? '(not a field)' : c.values?.[d.id] ?? '–')}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

/** The form: a new loan from a scenario (or one you have), fields to fill, fields to check. */
export function CheckForm({ s, snap, close }: { s: Session; snap: Snapshot; close: () => void }) {
  const last = s.checks?.at(-1);
  const [env, setEnv] = useState<'dev' | 'uat'>(last?.ask.env ?? 'dev');
  const [source, setSource] = useState<'new' | 'have'>('new');
  const [scenarios, setScenarios] = useState<{ id: string; name: string }[] | null>(null);
  const [scenario, setScenario] = useState(last?.ask.scenario ?? '');
  const [loan, setLoan] = useState(s.loans.at(-1)?.loan ?? '');
  // Never carried over from the last check: a fill writes, so it is typed each time.
  const [fill, setFill] = useState('');
  const [list, setList] = useState(last?.ask.list ?? '');
  const [check, setCheck] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    get<{ scenarios: { id: string; name: string }[] }>('/api/scenarios')
      .then((r) => { setScenarios(r.scenarios); if (!scenario && r.scenarios[0]) setScenario(r.scenarios[0].name); })
      .catch((e: Error) => { setScenarios([]); setError(e.message); setSource('have'); });
  }, []);

  function run() {
    const f = parseFieldLines(fill);
    const k = parseFieldLines(check);
    const set = Object.fromEntries(f.ids.map((id) => [id, f.values[id] ?? '']));
    const ask: Partial<DataCheckAsk> = {
      env, ...(source === 'new' ? { scenario } : { loan: loan.trim() }),
      ...(f.ids.length ? { set } : {}), ...(list ? { list } : {}),
      ...(k.ids.length ? { fields: k.ids } : {}), ...(Object.keys(k.values).length ? { expect: k.values } : {}),
    };
    setError('');
    post(`/api/sessions/${s.id}/checks`, ask).then(close).catch((e: Error) => setError(e.message));
  }

  return (
    <div className="dform" role="group" aria-label="New data check">
      <div className="row" style={{ gap: 8 }}>
        <span className="cap" style={{ width: 70 }}>Where</span>
        {(['dev', 'uat'] as const).map((e) => <button key={e} type="button" className={`seg small${env === e ? ' on' : ''}`} onClick={() => setEnv(e)}>{e === 'dev' ? 'Dev' : 'UAT'}</button>)}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <span className="cap" style={{ width: 70 }}>Loan</span>
        <button type="button" className={`seg small${source === 'new' ? ' on' : ''}`} disabled={!snap.config.loans} onClick={() => setSource('new')}>New from a scenario</button>
        <button type="button" className={`seg small${source === 'have' ? ' on' : ''}`} onClick={() => setSource('have')}>One I have</button>
        {source === 'new'
          ? <select aria-label="Scenario" value={scenario} onChange={(e) => setScenario(e.target.value)} style={{ minWidth: 220 }}>
              {scenarios === null ? <option>Loading…</option> : scenarios.map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}
            </select>
          : <input type="text" aria-label="Loan id" className="mono" value={loan} onChange={(e) => setLoan(e.target.value)} placeholder="loan id" style={{ minWidth: 300 }} />}
      </div>
      <div className="dcols">
        <label className="dcol">
          <span className="cap">Fill in {snap.config.updates ? '(through the record lookup)' : '(off on this machine)'}</span>
          <textarea rows={4} value={fill} onChange={(e) => setFill(e.target.value)} disabled={!snap.config.updates} placeholder={'CX.FEE.WAIVED = Y\nCX.WAIVER.REASON = Goodwill'} />
          {!snap.config.updates && <span className="note">Set the record lookup's "allowUpdate" and "updateUrl" in verify.json to fill fields.</span>}
        </label>
        <label className="dcol">
          <span className="cap">Then check</span>
          <select aria-label="Saved field list" value={list} onChange={(e) => setList(e.target.value)}>
            <option value="">No saved list</option>
            {snap.config.fieldLists.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <textarea rows={3} value={check} onChange={(e) => setCheck(e.target.value)} placeholder={'More ids, one a line; ID = value to expect one'} />
          <span className="note">What you fill in is checked too.</span>
        </label>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn dark" onClick={run} disabled={source === 'new' ? !scenario : !loan.trim()}>Run the check</button>
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <span className="note">Claude can run these too: ask it to prove the change with a data check.</span>
      </div>
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}
