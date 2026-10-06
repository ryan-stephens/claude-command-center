// The Verify panel (PLAN §105): is a field in the set, in Dev and UAT side by side; a record's field
// values from the record lookup; the tools' own pages. Read-only: nothing here writes to either
// tool. Lookup values stay in this page's memory (web/verify-state.ts).

import { useEffect, useState, type ReactNode } from 'react';
import type { Card } from '../../shared/cards.ts';
import { DEFAULT_ENV_VALUES, DEFAULT_ID_PARAM, ENV_NAME, VERIFY_AUTHS, VERIFY_ENVS, drift, splitIds, type EnvCheck, type FieldCheck, type VerifyAuth, type VerifyConfig, type VerifyEnv } from '../../shared/verify.ts';
import { useStore } from '../store.ts';
import { saveVerifyConfig } from '../ws.ts';
import { armProd, cycleEnv, openPage, refreshSets, runCheck, runLookup, setEnvs, setField, toggleAdvanced, toggleSetup, useVerify, verifyFor } from '../verify-state.ts';
import { Key } from './ui.tsx';

function Sec({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2.5 border-b border-line px-4 py-3.5">
      <div className="flex items-center gap-2"><h4 className="grow text-[13px] font-bold">{title}</h4>{right}</div>
      {children}
    </section>
  );
}

const small = 'flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12.5px] text-sub hover:bg-raise hover:text-ink disabled:opacity-50';

export function VerifyPanel({ card }: { card: Card }) {
  useEffect(() => { verifyFor(card); }, [card]);
  const v = useVerify();
  const config = useStore((s) => s.settings.verify);
  const envs = setEnvs();
  const setName = config?.set?.name ?? 'Field set';
  const lookName = config?.lookup?.name ?? 'Record lookup';
  if (v.cardId !== card.id) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5" role="radiogroup" aria-label="Environment">
        {VERIFY_ENVS.map((e) => (
          <button key={e} role="radio" aria-checked={v.env === e} onClick={() => (e === 'prod' ? armProd() : e !== v.env && cycleEnv())}
            className={`rounded-full border px-2.5 py-0.5 text-[12.5px] font-semibold ${v.env === e ? (e === 'prod' ? 'border-bad bg-bad/10 text-bad' : 'border-acc bg-acc-soft text-acc') : 'border-line text-sub hover:bg-raise'}`}>
            {ENV_NAME[e]}
          </button>
        ))}
        <Key k="e" size="sm" /><Key k="⇧P" size="sm" />
        <span className="grow" />
        <button className={small} onClick={() => void refreshSets()} disabled={v.refreshing || !envs.length} title="Read the current set again (it is kept ten minutes)">{v.refreshing ? <span className="spinner" /> : null}Refresh set<Key k="r" size="sm" /></button>
        <button className={small} onClick={() => toggleSetup()} title="Where the tools are on this machine">Setup<Key k="u" size="sm" /></button>
      </div>

      {(v.setup || (!config?.set && !config?.lookup)) && <Setup config={config} open={v.setup} />}

      <Sec title="Is this field in the set?" right={<span className="text-[12px] text-faint">{envs.length ? envs.map((e) => ENV_NAME[e]).join(' · ') : 'not set up'}</span>}>
        <label className="grid gap-1 text-[12px] text-faint">
          <span>Field ids, one per line{v.prefilled ? ` (${v.prefilled} from the card)` : ''} <Key k="i" size="sm" inline /></span>
          <textarea id="verify-ids" rows={3} spellCheck={false} value={v.ids} onChange={(e) => setField({ ids: e.target.value })} placeholder={'1000\nCX.SAMPLE.ONE'} className="field font-mono text-[12.5px]" />
        </label>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 rounded-lg border border-acc/60 bg-acc-soft px-2.5 py-1 text-[12.5px] font-semibold text-acc disabled:opacity-50" disabled={v.checking} onClick={() => void runCheck()}>
            {v.checking && <span className="spinner" />}Check<Key k="Enter" size="sm" />
          </button>
          <span className="text-[12px] text-faint">{splitIds(v.ids).length} ids</span>
        </div>
        {v.checkError && <p role="alert" className="text-[12.5px] text-bad">{v.checkError}</p>}
        {v.check && <CheckTable check={v.check} />}
      </Sec>

      <Sec title={`Look up a record · ${ENV_NAME[v.env]}`} right={<span className="text-[12px] text-faint">{lookName}</span>}>
        <div className="flex items-end gap-2">
          <label className="grid grow gap-1 text-[12px] text-faint">
            <span>Record id <Key k="l" size="sm" inline /></span>
            <input id="verify-record" type="text" spellCheck={false} autoComplete="off" value={v.record} onChange={(e) => setField({ record: e.target.value })} className="field py-1.5 font-mono text-[13px]" />
          </label>
          <label className="flex items-center gap-1.5 pb-1.5 text-[12.5px] text-sub" title="Slower; reads fields the quick fetch can't">
            <input type="checkbox" checked={v.advanced} onChange={() => toggleAdvanced()} className="h-4 w-4 accent-[var(--c-acc)]" />Advanced<Key k="a" size="sm" />
          </label>
        </div>
        <label className="grid gap-1 text-[12px] text-faint">
          <span>Fields to read (empty: the ids above)</span>
          <textarea id="verify-fields" rows={2} spellCheck={false} value={v.fields} onChange={(e) => setField({ fields: e.target.value })} className="field font-mono text-[12.5px]" />
        </label>
        <div className="flex items-center gap-2">
          <button className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-acc/60 bg-acc-soft px-2.5 py-1 text-[12.5px] font-semibold text-acc disabled:opacity-50" disabled={v.looking || !v.record.trim()} onClick={() => void runLookup()}>
            {v.looking && <span className="spinner" />}Look up
          </button>
          <span className="text-[12px] text-faint">Values stay on this page: not saved, not given to Claude.</span>
        </div>
        {v.lookError && <p role="alert" className="text-[12.5px] text-bad">{v.lookError}</p>}
        {v.found && (v.found.found ? <FoundTable found={v.found} /> : <p className="text-[13px] font-semibold text-attn">No record found: {v.found.recordId} in {ENV_NAME[v.found.env]}.</p>)}
      </Sec>

      <Sec title="Open the tools">
        <div className="flex flex-wrap gap-1.5">
          <button className={small} onClick={() => openPage('set')}>{setName} · {ENV_NAME[v.env]}<Key k="o" size="sm" /></button>
          <button className={small} onClick={() => openPage('add')} title="Opens the page only; adding to the set is done there, by you">Add to set<Key k="⇧O" size="sm" /></button>
          <button className={small} onClick={() => openPage('lookup')}>{lookName}<Key k="⇧L" size="sm" /></button>
        </div>
        <p className="text-[12px] text-faint">In the browser. Nothing is written to either tool from here.</p>
      </Sec>
    </>
  );
}

function Mark({ f }: { f: FieldCheck | undefined }) {
  if (!f) return <span className="text-faint">–</span>;
  if (!f.known) return <span className="font-semibold text-bad" title={f.message}>unknown</span>;
  return (
    <span className="grid gap-0.5">
      <span className={`font-semibold ${f.inSet ? 'text-ok' : 'text-attn'}`}>{f.inSet ? 'in set' : 'not in set'}{f.exists === false ? ' · no field' : ''}</span>
      {(f.format || f.options?.length) && <span className="text-[11.5px] text-faint" title={f.options?.join(', ')}>{f.format}{f.options?.length ? ` · ${f.options.length} options` : ''}</span>}
    </span>
  );
}

function CheckTable({ check }: { check: EnvCheck[] }) {
  const ids = [...new Set(check.flatMap((c) => (c.rows ?? []).map((r) => r.id)))];
  const at = (c: EnvCheck, id: string) => c.rows?.find((r) => r.id === id);
  return (
    <div className="grid gap-1.5">
      <table className="w-full text-left text-[12.5px]" aria-label="In the set">
        <thead><tr className="text-[11.5px] uppercase tracking-wide text-faint"><th className="py-1 font-semibold">Field</th>{check.map((c) => <th key={c.env} className="py-1 font-semibold">{ENV_NAME[c.env]}</th>)}</tr></thead>
        <tbody>
          {ids.map((id) => {
            const differs = check.length > 1 ? drift(at(check[0], id), at(check[1], id)) : undefined;
            const name = check.map((c) => at(c, id)?.fieldName).find(Boolean);
            return (
              <tr key={id} className={`border-t border-line align-top ${differs ? 'bg-attn-bg' : ''}`}>
                <td className="py-1.5 pr-2"><span className="font-mono">{id}</span>{name && <span className="block text-[11.5px] text-faint">{name}</span>}{differs && <span className="block text-[11.5px] font-semibold text-attn">differs: {differs}</span>}</td>
                {check.map((c) => <td key={c.env} className="py-1.5 pr-2"><Mark f={at(c, id)} /></td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
      {check.map((c) => (
        <p key={c.env} className={`text-[12px] ${c.error || c.setError ? 'text-bad' : 'text-faint'}`}>
          {ENV_NAME[c.env]}: {c.error ?? (c.set ? `set v${c.set.number ?? '?'}${c.set.description ? ` (${c.set.description})` : ''}, ${c.set.fields} field${c.set.fields === 1 ? '' : 's'}, read ${ago(c.set.fetchedAt)}` : c.setError)}
          {c.error ? null : c.setError && c.set ? ` · ${c.setError}` : null}
        </p>
      ))}
    </div>
  );
}

function FoundTable({ found }: { found: NonNullable<ReturnType<typeof useVerify.getState>['found']> }) {
  return (
    <table className="w-full text-left text-[12.5px]" aria-label="Record values">
      <thead><tr className="text-[11.5px] uppercase tracking-wide text-faint"><th className="py-1 font-semibold">Field</th><th className="py-1 font-semibold">Value · {found.recordId}</th></tr></thead>
      <tbody>
        {found.fields.map((f) => (
          <tr key={f.id} className={`border-t border-line align-top ${f.exists ? '' : 'bg-bad/10'}`}>
            <td className="py-1.5 pr-2 font-mono">{f.id}</td>
            <td className="py-1.5 pr-2">{f.exists ? <span className="break-all font-mono">{f.value || <span className="italic text-faint">empty</span>}{f.readOnly && <span className="ml-1.5 text-[11px] text-faint" title="Read-only field">read-only</span>}</span> : <span className="font-semibold text-bad">does not exist</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : `${Math.round(s / 60)} min ago`;
}

/** Where the tools are on this machine: saved in its settings (never the repo). Ctrl+Enter saves, Esc closes. */
function Setup({ config, open }: { config: VerifyConfig | undefined; open: boolean }) {
  const [f, setF] = useState<VerifyConfig>(() => structuredClone(config ?? {}));
  if (!open) {
    return (
      <Sec title="Set up Verify">
        <p className="text-[13px] text-sub">Verify reads two of the team’s tools: the field set (is a field in it, per environment) and the record lookup (a record’s field values). Where they are is set per machine, here: <Key k="u" size="sm" inline /> opens the form.</p>
      </Sec>
    );
  }
  const seturl = (e: VerifyEnv, url: string) => setF((x) => ({ ...x, set: { ...x.set, urls: { ...x.set?.urls, [e]: url } } }));
  const setS = (p: Partial<NonNullable<VerifyConfig['set']>>) => setF((x) => ({ ...x, set: { ...x.set, ...p } }));
  const setL = (p: Partial<NonNullable<VerifyConfig['lookup']>>) => setF((x) => ({ ...x, lookup: { ...x.lookup, ...p } }));
  const row = 'grid gap-1 text-[12px] text-faint';
  const input = 'field py-1 font-mono text-[12.5px]';
  return (
    <form id="verify-setup" className="grid gap-3 border-b border-line bg-raise/40 px-4 py-3.5" onSubmit={(e) => { e.preventDefault(); saveSetup(f); }}>
      <h4 className="text-[13px] font-bold">Where the tools are (this machine)</h4>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[12.5px] font-semibold text-sub">Field set: a host per environment</legend>
        {VERIFY_ENVS.map((e) => (
          <label key={e} className={row}><span>{ENV_NAME[e]} address{e === 'prod' ? ' (if there is one)' : ''}</span>
            <input id={`verify-cfg-set-${e}`} className={input} value={f.set?.urls?.[e] ?? ''} onChange={(x) => seturl(e, x.target.value)} placeholder={`https://set-${e}.example.invalid`} />
          </label>
        ))}
        <label className={row}><span>Add-to-set page, from the address (opened only)</span><input id="verify-cfg-add" className={input} value={f.set?.addPage ?? ''} onChange={(x) => setS({ addPage: x.target.value })} placeholder="Home/AddToSet" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className={row}><span>Id parameter</span><input className={input} value={f.set?.idParam ?? ''} onChange={(x) => setS({ idParam: x.target.value })} placeholder={DEFAULT_ID_PARAM} /></label>
          <label className={row}><span>Id key in the set (found when empty)</span><input className={input} value={f.set?.idKey ?? ''} onChange={(x) => setS({ idKey: x.target.value })} /></label>
        </div>
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[12.5px] font-semibold text-sub">Record lookup: one host for every environment</legend>
        <label className={row}><span>The form’s address (where it posts)</span><input id="verify-cfg-lookup" className={input} value={f.lookup?.url ?? ''} onChange={(x) => setL({ url: x.target.value })} placeholder="https://lookup.example.invalid/Lookup" /></label>
        <label className={row}><span>Record id field (the form’s name for it)</span><input id="verify-cfg-record" className={input} value={f.lookup?.recordField ?? ''} onChange={(x) => setL({ recordField: x.target.value })} placeholder="RecordId" /></label>
        <div className="grid grid-cols-3 gap-2">
          {VERIFY_ENVS.map((e) => <label key={e} className={row}><span>{ENV_NAME[e]} is called</span><input className={input} value={f.lookup?.envValues?.[e] ?? ''} onChange={(x) => setL({ envValues: { ...f.lookup?.envValues, [e]: x.target.value } })} placeholder={DEFAULT_ENV_VALUES[e]} /></label>)}
        </div>
        <label className={row}><span>Sign-in</span>
          <select className="field py-1 text-[12.5px]" value={f.lookup?.auth ?? 'auto'} onChange={(x) => setL({ auth: x.target.value as VerifyAuth })}>
            {VERIFY_AUTHS.map((a) => <option key={a} value={a}>{a === 'auto' ? 'Auto: without, then as you (Windows) when asked' : a === 'windows' ? 'As you (Windows sign-in)' : 'None'}</option>)}
          </select>
        </label>
      </fieldset>
      <div className="flex items-center gap-2">
        <button type="submit" className="flex items-center gap-1.5 rounded-lg border border-acc/60 bg-acc-soft px-2.5 py-1 text-[12.5px] font-semibold text-acc">Save<Key k="Ctrl Enter" size="sm" /></button>
        <button type="button" className={small} onClick={() => toggleSetup(false)}>Close<Key k="Esc" size="sm" /></button>
        <span className="text-[12px] text-faint">Saved on this machine only, never in the repo.</span>
      </div>
    </form>
  );
}

/** Ctrl+Enter in the form, or Save. */
export function saveSetup(f: VerifyConfig): void {
  saveVerifyConfig(f);
  toggleSetup(false);
}
