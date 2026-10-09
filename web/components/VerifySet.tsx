// The Verify panel's field set section (PLAN §105, §107, §132): is a field in the set, in Dev and
// UAT side by side, with a way to its add-to-set page when it isn't. Read-only: the add-to-set page
// is only opened, and adding is done there, by you.

import { ENV_NAME, drift, splitIds, type EnvCheck, type FieldCheck, type VerifyEnv } from '../../shared/verify.ts';
import { addToSet, cap, openPage, pageUrl, refreshSets, runCheck, setEnvs, setField, toolName, useVerify } from '../verify-state.ts';
import { Key } from './ui.tsx';
import { NotSetUp, Sec, small } from './verify-ui.tsx';

export function VerifySet({ file }: { file?: string }) {
  const v = useVerify();
  const envs = setEnvs();
  const setName = toolName('set');
  return (
    <>
      <Sec title={`Is it in ${setName}?`} right={<span className="flex items-center gap-2"><span className="text-[12px] text-faint">{envs.length ? envs.map((e) => ENV_NAME[e]).join(' · ') : 'no addresses'}</span><button className={small} onClick={() => void refreshSets()} disabled={v.refreshing || !envs.length} title={`Read ${setName}’s current set again (it is kept ten minutes)`}>{v.refreshing ? <span className="spinner" /> : null}Refresh<Key k="r" size="sm" /></button></span>}>
        {!envs.length && <NotSetUp name={cap(setName)} keys={'"set": { "urls": { "dev": …, "uat": … } }'} file={file} />}
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

      <Sec title="Open the tool">
        <div className="flex flex-wrap gap-1.5">
          <button className={small} onClick={() => openPage('set')}>{cap(setName)} · {ENV_NAME[v.env]}<Key k="o" size="sm" /></button>
          <button className={small} onClick={() => openPage('add')} title="Opens the page, with the ids not in the set copied to paste there; adding is done there, by you">Add to {setName} · {ENV_NAME[v.env]}<Key k="⇧O" size="sm" /></button>
        </div>
        <p className="text-[12px] text-faint">In the browser. {cap(setName)} is only read from here: adding to the set is done on its page, by you.</p>
      </Sec>
    </>
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

function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : `${Math.round(s / 60)} min ago`;
}
