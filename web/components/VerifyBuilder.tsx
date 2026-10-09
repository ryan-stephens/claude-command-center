// The Verify panel's test-data section (PLAN §132, §133): the scenario runner on this machine, which
// creates test loans in Dev or UAT. Choose a scenario, Enter twice runs it, the run's steps follow,
// and the loan it made goes to the record lookup with f. Its own web UI opens with o.

import { useEffect } from 'react';
import { ENV_NAME } from '../../shared/verify.ts';
import { useStore } from '../store.ts';
import { ARM_MS } from '../verify-model.ts';
import { chooseScenario, chosenScenario, copyRunIds, fetchRunLoan, loadScenarios, runEnv, runScenarioKey, setBuilderFilter, shownScenarios, useBuilder } from '../verify-builder.ts';
import { cap, openPage, toolName, useVerify } from '../verify-state.ts';
import { Key } from './ui.tsx';
import { NotSetUp, primary, Sec, small } from './verify-ui.tsx';

const MARK: Record<string, { sign: string; tone: string }> = {
  pending: { sign: '·', tone: 'text-faint' }, running: { sign: '…', tone: 'text-acc' }, succeeded: { sign: '✓', tone: 'text-ok' },
  failed: { sign: '✗', tone: 'text-bad' }, skipped: { sign: '–', tone: 'text-faint' },
};

export function VerifyBuilder({ file }: { file?: string }) {
  const b = useStore((s) => s.verify?.config.builder);
  const s = useBuilder();
  // The env row drives the run's environment; read it so the confirmation follows e.
  useVerify((v) => v.env);
  const name = toolName('builder');
  useEffect(() => { if (b?.url && !s.scenarios && !s.loading && s.up === undefined) void loadScenarios(); }, [b?.url, s.scenarios, s.loading, s.up]);
  const shown = shownScenarios(s);
  const chosen = chosenScenario(s);
  const env = runEnv();
  const isArmed = Boolean(chosen && s.arm && s.arm.key === `${chosen.id}@${chosen.version}@${env}` && Date.now() - s.arm.at < ARM_MS);
  const lookName = toolName('lookup');
  return (
    <Sec title={`${cap(name)} · ${ENV_NAME[env]}`} right={<span className="flex items-center gap-1">
      <button className={small} onClick={() => void loadScenarios()} disabled={s.loading || !b?.url}>{s.loading ? <span className="spinner" /> : null}Re-read<Key k="r" size="sm" /></button>
      {b?.ui && <button className={small} onClick={() => openPage('builder')}>Its page<Key k="o" size="sm" /></button>}
    </span>}>
      {!b?.url && <NotSetUp name={cap(name)} keys={'"builder": { "url": "http://localhost:…", "ui": … }'} file={file} />}
      {s.error && <p role="alert" className="text-[12.5px] text-bad">{s.error}</p>}
      {b?.url && s.scenarios && (
        <>
          <div className="flex items-center gap-1.5">
            <input id="verify-bfilter" type="text" spellCheck={false} autoComplete="off" value={s.filter} onChange={(e) => setBuilderFilter(e.target.value)} placeholder="Filter by name, version or tag" className="field w-56 py-0.5 text-[12.5px]" />
            <Key k="/" size="sm" />
            <span className="grow" />
            <span className="text-[12px] text-faint">{shown.length} of {s.scenarios.length} · ↑ ↓</span>
          </div>
          <ul className="grid max-h-[16rem] gap-0.5 overflow-y-auto" role="listbox" aria-label="Scenarios">
            {shown.map((x) => {
              const on = x.id === chosen?.id;
              return (
                <li key={x.id} role="option" aria-selected={on} onClick={() => chooseScenario(x.id)}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1 text-[12.5px] ${on ? 'border-acc/60 bg-acc-soft' : 'border-transparent hover:bg-raise'}`}>
                  <span className={`grow truncate ${on ? 'font-semibold text-ink' : 'text-sub'}`}>{x.name}</span>
                  {x.tags.slice(0, 3).map((t) => <span key={t} className="rounded-full border border-line px-1.5 text-[10.5px] text-faint">{t}</span>)}
                  {x.locked && <span className="text-[10.5px] font-semibold text-faint" title="Locked in the tool">locked</span>}
                  <span className="font-mono text-[11px] text-faint">v{x.version}</span>
                </li>
              );
            })}
            {!shown.length && <li className="px-2 py-1 text-[12.5px] italic text-faint">{s.scenarios.length ? 'No scenario matches.' : 'The tool has no scenarios.'}</li>}
          </ul>
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <button className={`${primary} ${isArmed ? '!border-attn !bg-attn-bg !text-attn' : ''}`} disabled={!chosen || s.starting || s.phase === 'poll'} onClick={() => void runScenarioKey()}>
                {(s.starting || s.phase === 'poll') && <span className="spinner" />}{isArmed ? 'Run: press again' : 'Run'}<Key k="Enter" size="sm" />
              </button>
              <span className="text-[12px] text-faint">Creates a test loan in {ENV_NAME[env]}. Dev or UAT only (e).</span>
            </div>
            {isArmed && chosen && <p className="text-[12.5px] font-semibold text-attn">Enter again to create a loan in {ENV_NAME[env]} with {chosen.name}</p>}
          </div>
        </>
      )}
      {s.runError && <p role="alert" className="text-[12.5px] text-bad">{s.runError}</p>}
      {s.run && <RunView lookName={lookName} />}
    </Sec>
  );
}

function RunView({ lookName }: { lookName: string }) {
  const s = useBuilder();
  const run = s.run!;
  const chip = s.phase === 'succeeded' ? ['Succeeded', 'border-ok text-ok'] : s.phase === 'failed' ? ['Failed', 'border-bad text-bad'] : s.phase === 'timeout' ? ['Still running after 15 min', 'border-attn text-attn'] : s.phase === 'error' ? ['Not answering', 'border-bad text-bad'] : ['Running', 'border-acc text-acc'];
  return (
    <div className="grid gap-1.5 rounded-xl border border-line px-3 py-2" aria-label="Run">
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className="grow truncate font-semibold">{run.name} · {ENV_NAME[run.env]}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${chip[1]}`} role="status">{chip[0]}</span>
      </div>
      {run.steps.length > 0 && (
        <ol className="grid gap-0.5 text-[12px]" aria-label="Steps">
          {run.steps.map((st) => (
            <li key={st.order} className="grid grid-cols-[1.25rem_1fr] gap-1">
              <span className={`text-center font-bold ${MARK[st.status].tone}`} title={st.status}>{MARK[st.status].sign}</span>
              <span className="min-w-0"><span className="font-mono text-faint">{st.order}.</span> {st.type}{st.error && <span className="block break-words text-bad">{st.error}</span>}</span>
            </li>
          ))}
        </ol>
      )}
      {run.error && <p className="break-words text-[12px] text-bad">{run.error}</p>}
      {run.recordIds.length > 0 && (
        <div className="grid gap-1">
          {run.recordIds.map((id, i) => (
            <div key={id} className="flex flex-wrap items-center gap-1.5">
              <span className="break-all font-mono text-[12.5px]">{id}</span>
              <button className={small} onClick={() => fetchRunLoan(i)}>Fetch in {lookName}{i === 0 && <Key k="f" size="sm" />}</button>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <button className={small} onClick={() => copyRunIds()}>Copy the loan id{run.recordIds.length === 1 ? '' : 's'}<Key k="⇧Y" size="sm" /></button>
            <span className="text-[11.5px] text-faint">Kept in this page only.</span>
          </div>
        </div>
      )}
    </div>
  );
}
