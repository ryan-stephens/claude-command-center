// The Verify panel's record lookup section (PLAN §105, §132): a record's field values, by a saved
// list of field ids or a pasted one; a filter, only the empty or missing ones, and a copy as
// field=value lines. With updates on (§134), in Dev and UAT: a row edited, staged, sent after a
// second Shift+U and checked by fetching again. The values live in this page's memory only.

import { useEffect, useRef } from 'react';
import { ENV_NAME, splitFieldLines, updatesOn } from '../../shared/verify.ts';
import { useStore } from '../store.ts';
import { ARM_MS, shortId, type AfterMark } from '../verify-model.ts';
import { cancelEdit, cap, copyFields, deleteList, lookupIds, openPage, openWatch, pickList, pickRecent, rowBlock, runLookup, saveList, selectedField, selectRow, sendKey, setEditValue, setField, shownFields, stagedLine, startSaveList, toggleAdvanced, toggleOnlyEmpty, toolName, updateBlock, useVerify } from '../verify-state.ts';
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
        <span className="text-[12px] text-faint">Values stay on this page: not saved, not given to Claude. {updatesOn(config) ? `Changes go to ${name} in Dev and UAT only, after a second Shift+U.` : `${cap(name)} is only read from here.`}</span>
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
          {updatesOn(config) && <UpdateNote />}
          <FoundTable />
          <ReviewStrip />
        </>
      )}
      <SentLine />
      <ChangedLog />
    </Sec>
  );
}

/** With updates on: how to change a field, or why this fetch can't be changed from. */
function UpdateNote() {
  const v = useVerify();
  const why = updateBlock(v);
  if (why) return <p className="text-[12px] text-faint">{why}.</p>;
  const plain = v.found!.fields.every((f) => f.readOnly === undefined);
  return (
    <p className="text-[12px] text-faint">
      <Key k="↑" size="sm" inline /> <Key k="↓" size="sm" inline /> a row, <Key k="u" size="sm" inline /> edit it, <Key k="z" size="sm" inline /> take it back, <Key k="⌫" size="sm" inline /> clear the field; <Key k="⇧U" size="sm" inline /> twice sends.
      {plain && <span className="block text-attn">Fetched without Advanced: fetch with Advanced (a) to see read-only fields and options.</span>}
    </p>
  );
}

function FoundTable() {
  const v = useVerify();
  const found = v.found!;
  const rows = shownFields(v);
  const can = !updateBlock(v);
  const sel = can ? selectedField(v)?.id : undefined;
  const after = v.after && v.after.record === found.recordId && v.after.env === found.env ? v.after : undefined;
  const selRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => { selRef.current?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  return (
    <table className="w-full text-left text-[12.5px]" aria-label="Record values">
      <thead><tr className="text-[11.5px] uppercase tracking-wide text-faint"><th className="py-1 font-semibold">Field</th><th className="py-1 font-semibold">Value · {found.recordId}</th></tr></thead>
      <tbody>
        {rows.map((f) => {
          const st = v.staged[f.id];
          const editing = v.editing?.id === f.id;
          const mark = after?.marks[f.id];
          const no = can ? rowBlock(f, v) : undefined;
          return (
            <tr key={f.id} ref={f.id === sel ? selRef : undefined} onClick={can ? () => selectRow(f.id) : undefined} aria-selected={can ? f.id === sel : undefined} title={can && no ? no : undefined}
              className={`border-t border-line align-top ${f.exists ? '' : 'bg-bad/10'} ${f.id === sel ? 'outline outline-2 -outline-offset-2 outline-acc/60' : ''} ${can ? 'cursor-pointer' : ''}`}>
              <td className="py-1.5 pr-2 font-mono">{f.id}</td>
              <td className="py-1.5 pr-2">{!f.exists
                ? <span className="font-semibold text-bad">does not exist</span>
                : editing ? <EditControl options={f.options} />
                : (
                  <span className="break-all font-mono">
                    {st
                      ? <span className={`font-semibold ${st.clear ? 'text-bad' : 'text-attn'}`} data-staged>{st.old || '(empty)'} → {st.clear ? '(empty)' : st.value}</span>
                      // After an update, the value the last check saw (the fetch above it is from before).
                      : (mark && after!.seen[f.id] !== undefined ? after!.seen[f.id] : f.value) || <span className="italic text-faint">empty</span>}
                    {f.readOnly && <span className="ml-1.5 font-sans text-[11px] text-faint" title="Read-only field">read-only</span>}
                    {f.options?.length ? <span className="ml-1.5 font-sans text-[11px] text-faint" title={f.options.join('\n')}>{f.options.length} option{f.options.length === 1 ? '' : 's'}</span> : null}
                    {mark && <AfterBadge mark={mark} />}
                  </span>
                )}</td>
            </tr>
          );
        })}
        {!rows.length && <tr><td colSpan={2} className="py-2 text-[12.5px] italic text-faint">No field matches.</td></tr>}
      </tbody>
    </table>
  );
}

/** u on a row: a box, or a select of the field's options. Enter stages, Esc cancels. */
function EditControl({ options }: { options?: string[] }) {
  const e = useVerify((s) => s.editing)!;
  if (options?.length) {
    return (
      <select id="verify-edit" autoFocus value={options.includes(e.value) ? e.value : ''} onChange={(x) => setEditValue(x.target.value)} onBlur={() => cancelEdit()} className="field w-full py-0.5 font-mono text-[12.5px]">
        {!options.includes(e.value) && <option value="">(choose)</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return <input id="verify-edit" type="text" autoFocus spellCheck={false} autoComplete="off" value={e.value} onChange={(x) => setEditValue(x.target.value)} onBlur={() => cancelEdit()} className="field w-full py-0.5 font-mono text-[12.5px]" />;
}

/** After an update: the row still has its old value (pending), the one sent (applied), or a third (differs, shown as the value). */
function AfterBadge({ mark }: { mark: AfterMark }) {
  const tone = mark === 'applied' ? 'border-ok text-ok' : mark === 'differs' ? 'border-bad text-bad' : 'border-line text-faint';
  return <span className={`ml-1.5 rounded-full border px-1.5 font-sans text-[10.5px] font-semibold ${tone}`} data-after={mark} title={mark === 'differs' ? 'Neither the old value nor the one sent' : undefined}>{mark === 'differs' ? 'differs from what was sent' : mark}</span>;
}

/** Under the table: what is staged, where, and Shift+U. */
function ReviewStrip() {
  const v = useVerify();
  const ids = Object.keys(v.staged);
  if (!ids.length || updateBlock(v)) return null;
  const armed = Date.now() - v.sendArmed < ARM_MS;
  return (
    <div className="grid gap-1.5 rounded-xl border border-attn/60 bg-attn-bg px-3 py-2" aria-label="Staged changes">
      <div className="flex items-center gap-2">
        <span className="grow text-[12.5px] font-semibold text-attn">{stagedLine(v)}</span>
        <button className={`${primary} ${armed ? '!border-attn !text-attn' : ''}`} disabled={v.sending} onClick={() => void sendKey()}>
          {v.sending && <span className="spinner" />}{armed ? 'Send: press again' : 'Send'}<Key k="⇧U" size="sm" />
        </button>
      </div>
      <ul className="grid gap-0.5 text-[12px]">
        {ids.map((id) => <li key={id} className="break-all font-mono"><span className="text-sub">{id}</span>: {v.staged[id].old || '(empty)'} → <span className={v.staged[id].clear ? 'text-bad' : 'text-attn'}>{v.staged[id].clear ? '(empty)' : v.staged[id].value}</span></li>)}
      </ul>
      {armed && <p className="text-[12.5px] font-semibold text-attn">Shift+U again to send {ids.length} field(s) to {ENV_NAME[v.env]}</p>}
    </div>
  );
}

/** After a send: what the tool said, and how the checks are going. */
function SentLine() {
  const v = useVerify();
  if (!v.sent) return null;
  const a = v.after;
  const counts = a ? Object.values(a.marks).reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {} as Record<string, number>) : {};
  return (
    <div className="grid gap-1 text-[12.5px]" role="status" aria-label="Update sent">
      <p>Sent {v.sent.sent} field(s) to {ENV_NAME[v.sent.env]}. The tool applies these in a couple of minutes.</p>
      {a && <p className={a.phase === 'applied' ? 'font-semibold text-ok' : a.phase === 'timeout' ? 'font-semibold text-attn' : 'text-faint'}>
        {a.phase === 'applied' ? 'Applied.' : a.phase === 'timeout' ? 'Not applied after 3 minutes: see the tool’s progress page (w).' : `Checking every 10 s: ${counts.applied ?? 0} applied, ${counts.pending ?? 0} pending${counts.differs ? `, ${counts.differs} differ` : ''}.`}
      </p>}
      {v.sent.watchUrl && <button className={`${small} justify-self-start`} onClick={() => openWatch()}>The tool’s progress page<Key k="w" size="sm" /></button>}
    </div>
  );
}

/** Changes sent in this page's life: memory only, gone on reload. */
function ChangedLog() {
  const changed = useVerify((s) => s.changed);
  if (!changed.length) return null;
  return (
    <details className="text-[12px]" open>
      <summary className="cursor-pointer font-semibold text-sub">Changed this session ({changed.length})</summary>
      <ul className="mt-1 grid gap-0.5">
        {changed.map((c, i) => (
          <li key={i} className="break-all font-mono"><span className="font-sans text-faint">{new Date(c.at).toLocaleTimeString()} · {ENV_NAME[c.env]} · {shortId(c.record)}</span> {c.id}: {c.old || '(empty)'} → {c.clear ? '(empty)' : c.value}</li>
        ))}
      </ul>
      <p className="mt-1 text-faint">Kept in this page only: not saved, not given to Claude.</p>
    </details>
  );
}
