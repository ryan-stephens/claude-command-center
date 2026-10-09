// The Verify panel's record lookup section (PLAN §105, §132): a record's field values, by a saved
// list of field ids or a pasted one; a filter, only the empty or missing ones, and a copy as
// field=value lines. Read-only. The values live in this page's memory only (web/verify-state.ts).

import { ENV_NAME, splitFieldLines } from '../../shared/verify.ts';
import { useStore } from '../store.ts';
import { cap, copyFields, deleteList, lookupIds, openPage, pickList, pickRecent, runLookup, saveList, setField, shownFields, startSaveList, toggleAdvanced, toggleOnlyEmpty, toolName, useVerify } from '../verify-state.ts';
import { Key } from './ui.tsx';
import { NotSetUp, primary, Sec, small } from './verify-ui.tsx';

export function VerifyLookup({ file }: { file?: string }) {
  const v = useVerify();
  const config = useStore((s) => s.verify?.config);
  const lists = useStore((s) => s.verifyLists);
  const name = toolName('lookup');
  const ids = lookupIds(v);
  const shown = shownFields(v);
  return (
    <Sec title={`Look up in ${name} · ${ENV_NAME[v.env]}`} right={<button className={small} onClick={() => openPage('lookup')}>Its page<Key k="o" size="sm" /></button>}>
      {!config?.lookup?.url && <NotSetUp name={cap(name)} keys={'"lookup": { "url": …, "recordField": … }'} file={file} />}
      {config?.lookup?.url && !config.lookup.recordField && <p className="text-[12.5px] text-attn">{cap(name)} needs <span className="font-mono">"recordField"</span> in <span className="font-mono">{file}</span>: the form’s name for the record id box.</p>}
      <div className="flex items-end gap-2">
        <label className="grid grow gap-1 text-[12px] text-faint">
          <span>Record id <Key k="l" size="sm" inline />{v.recent.length ? <span> · ↑ ↓ the recent ones</span> : null}</span>
          <input id="verify-record" type="text" spellCheck={false} autoComplete="off" value={v.record} onChange={(e) => setField({ record: e.target.value })} className="field py-1.5 font-mono text-[13px]" />
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-[12.5px] text-sub" title="Slower; marks read-only and missing fields, and gives a field's options">
          <input type="checkbox" checked={v.advanced} onChange={() => toggleAdvanced()} className="h-4 w-4 accent-[var(--c-acc)]" />Advanced<Key k="a" size="sm" />
        </label>
      </div>
      {v.recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Recent records">
          {v.recent.map((r, i) => (
            <button key={`${r.env}-${r.record}`} onClick={() => pickRecent(i)} title={`${r.record} in ${ENV_NAME[r.env]}${r.label ? `, from ${r.label}` : ''}`}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11.5px] ${v.record.trim() === r.record && v.env === r.env ? 'border-acc bg-acc-soft text-acc' : 'border-line text-sub hover:bg-raise'}`}>
              {r.record}<span className="font-sans text-[10.5px] font-semibold text-faint">{ENV_NAME[r.env]}</span>{r.label && <span className="max-w-[10rem] truncate font-sans text-[10.5px] text-faint">{r.label}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex items-center gap-1.5 text-[12.5px] text-sub">
          List<Key k="f" size="sm" />
          <select id="verify-list" value={v.list} onChange={(e) => pickList(e.target.value)} className="field max-w-[14rem] py-0.5 text-[12.5px]">
            <option value="">{lists?.lists.length ? '(none chosen)' : '(no saved lists)'}</option>
            {lists?.lists.map((l) => <option key={l.name} value={l.name}>{l.name} ({l.ids.length})</option>)}
          </select>
        </label>
        {v.listName === null
          ? <button className={small} onClick={() => startSaveList()} disabled={!splitFieldLines(v.fields).length}>Save as list<Key k="⇧S" size="sm" /></button>
          : (
            <span className="flex items-center gap-1.5">
              <input id="verify-listname" type="text" autoFocus spellCheck={false} maxLength={60} value={v.listName} onChange={(e) => setField({ listName: e.target.value })} placeholder="The list’s name" className="field w-44 py-0.5 text-[12.5px]" />
              <button className={small} onClick={() => void saveList()}>Save<Key k="Enter" size="sm" /></button>
              <button className={small} onClick={() => setField({ listName: null })}>Cancel<Key k="Esc" size="sm" /></button>
            </span>
          )}
        <button className={small} onClick={() => void deleteList()} disabled={!v.list} title="Press twice: the list goes from this machine’s lists file; the Fields box keeps its ids">Delete list<Key k="⇧F" size="sm" /></button>
      </div>
      {lists?.problem && <p role="alert" className="text-[12px] text-bad">{lists.problem}</p>}
      <label className="grid gap-1 text-[12px] text-faint">
        <span>Fields to read, one per line ({v.fields.trim() ? `${ids.length}` : `empty: the ${ids.length} id${ids.length === 1 ? '' : 's'} in ${cap(toolName('set'))}’s box`}) <Key k="i" size="sm" inline /></span>
        <textarea id="verify-fields" rows={3} spellCheck={false} value={v.fields} onChange={(e) => setField({ fields: e.target.value })} className="field font-mono text-[12.5px]" />
      </label>
      <div className="flex items-center gap-2">
        <button className={primary} disabled={v.looking || !v.record.trim()} onClick={() => void runLookup()}>
          {v.looking && <span className="spinner" />}Look up<Key k="Enter" size="sm" />
        </button>
        <span className="text-[12px] text-faint">Values stay on this page: not saved, not given to Claude. {cap(name)} is only read from here.</span>
      </div>
      {v.lookError && <p role="alert" className="text-[12.5px] text-bad">{v.lookError}</p>}
      {v.found && !v.found.found && <p className="text-[13px] font-semibold text-attn">No record found: {v.found.recordId} in {ENV_NAME[v.found.env]}.</p>}
      {v.found?.found && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <input id="verify-filter" type="text" spellCheck={false} autoComplete="off" value={v.lookFilter} onChange={(e) => setField({ lookFilter: e.target.value })} placeholder="Filter fields or values" className="field w-48 py-0.5 text-[12.5px]" />
            <Key k="/" size="sm" />
            <label className="flex items-center gap-1.5 text-[12.5px] text-sub"><input type="checkbox" checked={v.onlyEmpty} onChange={() => toggleOnlyEmpty()} className="h-4 w-4 accent-[var(--c-acc)]" />Only empty or missing<Key k="⇧M" size="sm" /></label>
            <span className="grow" />
            <span className="text-[12px] text-faint">{shown.length} of {v.found.fields.length}</span>
            <button className={small} onClick={() => copyFields()} title="The rows shown, as field=value lines, to the clipboard">Copy<Key k="⇧Y" size="sm" /></button>
          </div>
          <FoundTable />
        </>
      )}
    </Sec>
  );
}

function FoundTable() {
  const v = useVerify();
  const found = v.found!;
  const rows = shownFields(v);
  return (
    <table className="w-full text-left text-[12.5px]" aria-label="Record values">
      <thead><tr className="text-[11.5px] uppercase tracking-wide text-faint"><th className="py-1 font-semibold">Field</th><th className="py-1 font-semibold">Value · {found.recordId}</th></tr></thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.id} className={`border-t border-line align-top ${f.exists ? '' : 'bg-bad/10'}`}>
            <td className="py-1.5 pr-2 font-mono">{f.id}</td>
            <td className="py-1.5 pr-2">{f.exists
              ? <span className="break-all font-mono">{f.value || <span className="italic text-faint">empty</span>}
                {f.readOnly && <span className="ml-1.5 font-sans text-[11px] text-faint" title="Read-only field">read-only</span>}
                {f.options?.length ? <span className="ml-1.5 font-sans text-[11px] text-faint" title={f.options.join('\n')}>{f.options.length} option{f.options.length === 1 ? '' : 's'}</span> : null}
              </span>
              : <span className="font-semibold text-bad">does not exist</span>}</td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={2} className="py-2 text-[12.5px] italic text-faint">No field matches.</td></tr>}
      </tbody>
    </table>
  );
}
