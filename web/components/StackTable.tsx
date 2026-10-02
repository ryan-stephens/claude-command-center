// The stack editor's table (PLAN §54, milestone 3): one row per part of the stack with its port,
// its steps or values, its proxy rule and the files it was read from. ↑ ↓ pick a row, e opens its
// fields under it (Enter keeps them, Esc drops them), Delete drops an API, Enter saves the stack,
// Alt+W goes on to the JSON. The rows and the edits are pure (web/stack-table.ts); this draws them.

import { useState } from 'react';
import type { Stack } from '../../shared/stack.ts';
import type { Finding } from '../../shared/stack-detect.ts';
import { fieldsOf, stackRows, withField, withoutApi, type Field } from '../stack-table.ts';
import { close, DialogKeys, useDialogKeys } from './Overlay.tsx';
import { Key } from './ui.tsx';

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'));
};

export function StackTable({ stack, findings, detected, onChange, onSave, onNext }: {
  stack: Stack;
  /** The detector's findings for the workspace (null while they are read). */
  findings: Finding[] | null;
  /** What the repos say now, when a stack is saved: rows say where it drifted. */
  detected?: Stack;
  onChange: (next: Stack) => void;
  onSave: () => void;
  /** Alt+W: the next tab (the JSON). */
  onNext: () => void;
}) {
  const rows = stackRows(stack, findings ?? [], detected);
  const [at, setAt] = useState(0);
  const [editing, setEditing] = useState<Field[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const row = rows[Math.min(at, rows.length - 1)];

  const edit = () => {
    if (!row) return;
    const f = fieldsOf(stack, row.id);
    if (!f.length) return;
    setEditing(f);
    setValues(Object.fromEntries(f.map((x) => [x.key, x.value])));
    setError(null); setSaid(null);
  };
  /** Keep what was typed: each field in turn, the first one that can't be taken says why. */
  const commit = (): boolean => {
    if (!editing || !row) return true;
    let next = stack;
    try {
      for (const f of editing) if ((values[f.key] ?? '') !== f.value) next = withField(next, row.id, f.key, values[f.key] ?? '');
    } catch (e) { setError((e as Error).message); return false; }
    if (next !== stack) onChange(next);
    setEditing(null); setError(null);
    return true;
  };
  const drop = () => {
    if (!row || !row.id.startsWith('api:')) return;
    onChange(withoutApi(stack, row.repo));
    setSaid(`${row.repo} taken out of the stack.`);
    setAt((i) => Math.max(0, Math.min(i, rows.length - 2)));
  };

  useDialogKeys((e) => {
    if (e.altKey && e.key.toLowerCase() === 'w') { if (editing && !commit()) return true; onNext(); return true; }
    if (typing(e)) {
      if (e.key === 'Escape') { setEditing(null); setError(null); (e.target as HTMLElement).blur(); return true; }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (e.target as HTMLElement).tagName === 'INPUT')) { commit(); return true; }
      return false;
    }
    if (editing) {
      if (e.key === 'Escape') { setEditing(null); setError(null); return true; }
      if (e.key === 'Enter') { commit(); return true; }
      return false;
    }
    if (e.key === 'Escape') { close(); return true; }
    if (e.key === 'Enter') { onSave(); return true; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { setAt((i) => Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))); return true; }
    if (e.key === 'e') { edit(); return true; }
    if (e.key === 'Delete') { drop(); return true; }
    return false;
  });

  const cell = 'px-2.5 py-1.5 align-top';
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-[12.5px]" aria-label="The stack">
          <thead className="bg-raise text-left">
            <tr>
              {['Repo', 'Role', 'Port', 'Steps · values', 'Proxy rule', 'Read from'].map((h) => <th key={h} className={`${cell} eyebrow font-semibold`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const focus = i === Math.min(at, rows.length - 1);
              return [
                <tr key={r.id} onMouseEnter={() => { if (!editing) setAt(i); }} onClick={() => { if (!editing) { setAt(i); } }}
                  className={`border-t border-line/70 ${focus ? 'is-focus bg-raise' : ''}`} data-row={r.id} aria-selected={focus}>
                  <td className={`${cell} whitespace-nowrap font-mono font-semibold`}>{r.repo || <span className="text-faint">—</span>}</td>
                  <td className={`${cell} whitespace-nowrap text-sub`}>{r.role}</td>
                  <td className={`${cell} whitespace-nowrap font-mono`}>{r.port}</td>
                  <td className={`${cell} min-w-[16rem] font-mono text-[12px]`}>{r.lines.map((l, k) => <div key={k} className="break-all">{l}</div>)}{!r.lines.length && <span className="text-faint">none</span>}</td>
                  <td className={`${cell} min-w-[11rem] font-mono text-[12px] break-all`}>{r.rule || <span className="text-faint">—</span>}</td>
                  <td className={`${cell} min-w-[15rem]`}>
                    {r.from.length > 0 && <div className="text-ok"><span className="mr-1 font-mono font-bold">✓</span>{r.from.join(', ')}</div>}
                    {r.asked.map((a) => <div key={a} className="text-attn"><span className="mr-1 font-mono font-bold">?</span>{a}</div>)}
                    {r.drift && <div className="text-attn"><span className="mr-1 font-mono font-bold">≠</span>the repos now say {r.drift}</div>}
                    {!r.from.length && !r.asked.length && !r.drift && <span className="text-faint">{findings === null ? 'reading…' : '—'}</span>}
                  </td>
                </tr>,
                focus && editing ? (
                  <tr key={`${r.id}-edit`} className="bg-bg">
                    <td colSpan={6} className="px-3 py-2.5">
                      <div className="grid gap-2.5" data-editing={r.id}>
                        {editing.map((f, k) => (
                          <label key={f.key} className="grid gap-1">
                            <span className="eyebrow">{f.label}{f.hint ? <span className="font-sans normal-case tracking-normal text-faint"> · {f.hint}</span> : null}</span>
                            {f.multiline
                              ? <textarea autoFocus={k === 0} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} rows={Math.min(8, Math.max(2, (values[f.key] ?? '').split('\n').length))} spellCheck={false} className="field w-full resize-y font-mono text-[12.5px]" />
                              : <input autoFocus={k === 0} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} spellCheck={false} className="field w-full font-mono text-[12.5px]" />}
                          </label>
                        ))}
                        {error && <div className="rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{error}</div>}
                        <div className="flex items-center gap-2 text-[12.5px] text-faint">
                          <button className="btn py-0.5" onClick={commit}>Keep<Key k="Enter" size="sm" tone="ghost" /></button>
                          <button className="btn py-0.5" onClick={() => { setEditing(null); setError(null); }}>Drop the change<Key k="Esc" size="sm" /></button>
                          <span>Ctrl Enter keeps from a multi-line box. Nothing is saved until Enter on a row.</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      {said && <p className="mt-2 text-[13px] text-attn">{said}</p>}
      <DialogKeys items={[['↑ ↓', 'row'], ['e', 'change this row'], ...(row?.id.startsWith('api:') ? [['Delete', `drop ${row.repo}`] as [string, string]] : []), ['Enter', 'save the stack'], ['Alt W', 'as JSON'], ['Esc', 'cancel']]} />
    </div>
  );
}
