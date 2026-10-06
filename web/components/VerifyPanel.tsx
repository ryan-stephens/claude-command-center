// The Verify panel (PLAN §105, §107): is a field in the field set, in Dev and UAT side by side, with
// a way to its add-to-set page when it isn't; a record's field values from the record lookup; the
// tools' own pages. The tools' addresses and names come from this machine's Verify file. Read-only:
// nothing here writes to either tool. Lookup values stay in this page's memory (web/verify-state.ts).

import { useEffect, type ReactNode } from 'react';
import type { Card } from '../../shared/cards.ts';
import { ENV_NAME, VERIFY_ENVS, drift, splitIds, type EnvCheck, type FieldCheck, type VerifyEnv, type VerifyFile } from '../../shared/verify.ts';
import { useStore } from '../store.ts';
import { addToSet, armProd, cap, cycleEnv, openPage, pageUrl, refreshSets, runCheck, runLookup, setEnvs, setField, toggleAdvanced, toolName, useVerify, verifyFor } from '../verify-state.ts';
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
  const file = useStore((s) => s.verify);
  const config = file?.config;
  const envs = setEnvs();
  const setName = toolName('set');
  const lookName = toolName('lookup');
  if (v.cardId !== card.id) return null;
  const empty = !config?.set && !config?.lookup;
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
        <button className={small} onClick={() => void refreshSets()} disabled={v.refreshing || !envs.length} title={`Read ${setName}’s current set again (it is kept ten minutes)`}>{v.refreshing ? <span className="spinner" /> : null}Refresh<Key k="r" size="sm" /></button>
      </div>

      {(empty || file?.problem) && <FileNote file={file} />}

      <Sec title={`Is it in ${setName}?`} right={<span className="text-[12px] text-faint">{envs.length ? envs.map((e) => ENV_NAME[e]).join(' · ') : 'no addresses'}</span>}>
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
        {v.check && <CheckTable check={v.check} setName={setName} />}
      </Sec>

      <Sec title={`Look up in ${lookName} · ${ENV_NAME[v.env]}`}>
        {config?.lookup && !config.lookup.recordField && <p className="text-[12.5px] text-attn">{cap(lookName)} needs <span className="font-mono">"recordField"</span> in <span className="font-mono">{file?.file}</span>: the form’s name for the record id box.</p>}
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
          <button className={small} onClick={() => openPage('set')}>{cap(setName)} · {ENV_NAME[v.env]}<Key k="o" size="sm" /></button>
          <button className={small} onClick={() => openPage('add')} title="Opens the page, with the ids not in the set copied to paste there; adding is done there, by you">Add to {setName} · {ENV_NAME[v.env]}<Key k="⇧O" size="sm" /></button>
          <button className={small} onClick={() => openPage('lookup')}>{cap(lookName)}<Key k="⇧L" size="sm" /></button>
        </div>
        <p className="text-[12px] text-faint">In the browser. Nothing is written to either tool from here.</p>
      </Sec>
    </>
  );
}

/** No addresses yet, or a file that can't be read: where the file is and what goes in it (never the repo). */
function FileNote({ file }: { file: VerifyFile | null }) {
  return (
    <Sec title="Where the tools are">
      {file?.problem
        ? <p role="alert" className="text-[13px] text-bad">{file.problem}</p>
        : <p className="text-[13px] text-sub">Verify reads where the team’s tools are, and what they’re called, from a file on this machine: <span className="font-mono">{file?.file ?? '~/.cc-control/verify.json'}</span>. It isn’t there yet. README’s Verify row shows what goes in it; a change to it shows here at once, no restart.</p>}
    </Sec>
  );
}

function Mark({ f, env, setName }: { f: FieldCheck | undefined; env: VerifyEnv; setName: string }) {
  if (!f) return <span className="text-faint">–</span>;
  if (!f.known) return <span className="font-semibold text-bad" title={f.message}>unknown</span>;
  const canAdd = !f.inSet && Boolean(pageUrl('add', env).url);
  return (
    <span className="grid gap-0.5">
      <span className={`font-semibold ${f.inSet ? 'text-ok' : 'text-attn'}`}>{f.inSet ? 'in set' : 'not in set'}{f.exists === false ? ' · no field' : ''}</span>
      {(f.format || f.options?.length) && <span className="text-[11.5px] text-faint" title={f.options?.join(', ')}>{f.format}{f.options?.length ? ` · ${f.options.length} options` : ''}</span>}
      {canAdd && <button className="justify-self-start text-[11.5px] font-semibold text-acc underline decoration-dotted underline-offset-2 hover:decoration-solid" onClick={() => addToSet(env, [f.id])} title={`Copies ${f.id} and opens ${setName}’s add-to-set page for ${ENV_NAME[env]}`}>Add in {ENV_NAME[env]} ↗</button>}
    </span>
  );
}

function CheckTable({ check, setName }: { check: EnvCheck[]; setName: string }) {
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
                {check.map((c) => <td key={c.env} className="py-1.5 pr-2"><Mark f={at(c, id)} env={c.env} setName={setName} /></td>)}
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
