import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Command, CommandGroup, CommandMode } from '../../shared/protocol.ts';
import { fillTemplate, placeholders } from '../commands.ts';
import { flash, get, sessionById, set } from '../store.ts';
import { send } from '../ws.ts';
import { close, Overlay } from './Overlay.tsx';

const fieldClass = 'mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-600';

/** Fill {{placeholders}}, then send. Enter moves to the next blank, and sends from the last one. */
export function TemplateDialog({ sessionId, command }: { sessionId: string; command: Command }) {
  const names = placeholders(command.body);
  const [values, setValues] = useState<Record<string, string>>({});
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const text = fillTemplate(command.body, values);

  function submit() {
    send({ type: 'session.send', id: sessionId, text });
    close();
    flash(`Sent: ${command.label}`);
  }

  return (
    <Overlay label={command.label}>
      <h2 className="mb-3 text-base font-medium text-zinc-100">{command.label}</h2>
      {names.map((name, i) => (
        <label key={name} className="mb-2 block text-xs text-zinc-400">
          {name}
          <input
            ref={(el) => { refs.current[i] = el; }}
            autoFocus={i === 0}
            value={values[name] ?? ''}
            onChange={(e) => setValues({ ...values, [name]: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              else if (e.key === 'Enter') {
                e.preventDefault();
                if (i < names.length - 1) refs.current[i + 1]?.focus();
                else submit();
              }
            }}
            className={fieldClass}
          />
        </label>
      ))}
      <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 text-xs text-zinc-400">{text}</pre>
      <p className="mt-2 text-xs text-zinc-500"><kbd>Enter</kbd> next / send · <kbd>Esc</kbd> cancel</p>
    </Overlay>
  );
}

/**
 * Create or edit the tile at `slot`. On a read-only slash-command tile this saves a copy into
 * your own "Mine" group. Moving a command (new group, slot or scope) removes the original.
 */
export function EditDialog({ group, slot }: { group: CommandGroup | null; slot: number }) {
  const cwd = sessionById(get().openId)?.cwd;
  const editable = group && group.scope !== 'auto' ? group : null;
  const existing = group?.commands.find((c) => c.slot === slot);
  const [scope, setScope] = useState<'global' | 'repo'>(editable?.scope === 'repo' ? 'repo' : 'global');
  const [groupName, setGroupName] = useState(editable?.name ?? 'Mine');
  const [targetSlot, setTargetSlot] = useState(slot);
  const [label, setLabel] = useState(existing?.label ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [mode, setMode] = useState<CommandMode>(existing?.mode ?? 'send');
  const [error, setError] = useState('');

  function save() {
    const name = groupName.trim();
    if (!label.trim() || !body.trim() || !name) { setError('Label, body and group are all required.'); return; }
    if (mode === 'template' && !placeholders(body).length) { setError('Template mode needs at least one {{placeholder}} in the body.'); return; }
    send({ type: 'command.save', ref: { scope, cwd, group: name, slot: targetSlot }, command: { label: label.trim(), body, mode } });
    const moved = editable && existing && (editable.scope !== scope || editable.name !== name || slot !== targetSlot);
    if (moved) send({ type: 'command.delete', ref: { scope: editable.scope as 'global' | 'repo', cwd, group: editable.name, slot } });
    set({ modal: null, groupKey: `${scope}:${name}`, boardSlot: targetSlot });
    flash(`Saved ${label.trim()}`);
  }

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && (e.ctrlKey || !(e.target instanceof HTMLTextAreaElement))) { e.preventDefault(); save(); }
  };

  const title = existing && editable ? 'Edit command' : existing ? 'Copy slash command' : 'New command';
  return (
    <Overlay label={title}>
      <div onKeyDown={onKey}>
        <h2 className="mb-1 text-base font-medium text-zinc-100">{title}</h2>
        {!editable && group && <p className="mb-2 text-xs text-zinc-500">Slash commands are read-only; this saves a copy you can change.</p>}
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <label className="text-xs text-zinc-400">Label<input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} className={fieldClass} /></label>
          <label className="text-xs text-zinc-400">Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as CommandMode)} className={fieldClass}>
              <option value="send">send</option>
              <option value="insert">insert</option>
              <option value="template">template</option>
            </select>
          </label>
        </div>
        <label className="mt-2 block text-xs text-zinc-400">
          Body {mode === 'template' && <span className="text-zinc-500">· use {'{{name}}'} for each blank</span>}
          <textarea value={body} rows={4} onChange={(e) => setBody(e.target.value)} className={`${fieldClass} resize-none font-mono text-xs`} />
        </label>
        <div className="mt-2 grid grid-cols-[1fr_9rem_4.5rem] gap-2">
          <label className="text-xs text-zinc-400">Group<input value={groupName} onChange={(e) => setGroupName(e.target.value)} className={fieldClass} /></label>
          <label className="text-xs text-zinc-400">Saved in
            <select value={scope} onChange={(e) => setScope(e.target.value as 'global' | 'repo')} className={fieldClass}>
              <option value="global">mine (global)</option>
              {cwd && <option value="repo">this repo</option>}
            </select>
          </label>
          <label className="text-xs text-zinc-400">Slot
            <select value={targetSlot} onChange={(e) => setTargetSlot(Number(e.target.value))} className={fieldClass}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        {scope === 'repo' && (
          <p className="mt-2 truncate text-xs text-zinc-500">
            Writes <span className="font-mono">.cc-control/commands.json</span> in {cwd}. Commit it to share with your team.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <p className="mt-3 text-xs text-zinc-500"><kbd>Tab</kbd> next field · <kbd>Enter</kbd> save (<kbd>Ctrl+Enter</kbd> in the body) · <kbd>Esc</kbd> cancel</p>
      </div>
    </Overlay>
  );
}

export function DeleteDialog({ group, slot }: { group: CommandGroup; slot: number }) {
  const command = group.commands.find((c) => c.slot === slot);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'y' || k === 'enter') {
        send({ type: 'command.delete', ref: { scope: group.scope as 'global' | 'repo', cwd: sessionById(get().openId)?.cwd, group: group.name, slot } });
        close();
      } else if (k === 'n' || k === 'escape') close();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [group, slot]);
  return (
    <Overlay label="Remove command">
      <p className="text-sm text-zinc-200">Remove <span className="font-medium">{command?.label}</span> from {group.name}?</p>
      <p className="mt-3 text-xs text-zinc-500"><kbd>Y</kbd>/<kbd>Enter</kbd> remove · <kbd>N</kbd>/<kbd>Esc</kbd> cancel</p>
    </Overlay>
  );
}
