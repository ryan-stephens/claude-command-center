import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Command, CommandGroup, CommandMode } from '../../shared/protocol.ts';
import { fireCommand, fillTemplate, placeholders } from '../commands.ts';
import { flash, get, sessionById, set } from '../store.ts';
import { send } from '../ws.ts';
import { close, DialogKeys, DialogTitle, Overlay, useDialogKeys } from './Overlay.tsx';
import { workspacesFor } from '../../shared/workspaces.ts';
import { Key } from './ui.tsx';

const fieldClass = 'field mt-1 py-1.5 text-sm';
const labelClass = 'eyebrow block';

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
      <DialogTitle>{command.label}</DialogTitle>
      {names.map((name, i) => (
        <label key={name} className="mb-3 block text-sm font-semibold">
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
      <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-2.5 text-sm text-sub">{text}</pre>
      <DialogKeys items={[['Enter', 'next blank / send'], ['Esc', 'cancel']]} />
    </Overlay>
  );
}

/**
 * Create or edit the tile at `slot`. On a read-only slash-command tile this saves a copy into
 * your own "Mine" group. Moving a command (new group, slot or scope) removes the original.
 */
export function EditDialog({ group, slot }: { group: CommandGroup | null; slot: number }) {
  const cwd = sessionById(get().openId)?.cwd;
  const workspace = cwd ? workspacesFor(cwd, get().workspaces)[0] : undefined;
  const editable = group && group.scope !== 'auto' ? group : null;
  const existing = group?.commands.find((c) => c.slot === slot);
  type Scope = 'workspace' | 'global' | 'repo';
  const [scope, setScope] = useState<Scope>((editable?.scope as Scope | undefined) ?? (workspace ? 'workspace' : 'global'));
  const workspaceId = editable?.scope === 'workspace' ? editable.workspaceId : workspace?.id;
  const [groupName, setGroupName] = useState(editable?.name ?? workspace?.name ?? 'Mine');
  const [targetSlot, setTargetSlot] = useState(slot);
  const [label, setLabel] = useState(existing?.label ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [mode, setMode] = useState<CommandMode>(existing?.mode ?? 'send');
  const [error, setError] = useState('');
  /** The occupant the user already agreed to replace; any change of target asks again. */
  const [replaceOk, setReplaceOk] = useState('');

  function save() {
    const name = groupName.trim();
    if (!label.trim() || !body.trim() || !name) { setError('Label, body and group are all required.'); return; }
    if (mode === 'template' && !placeholders(body).length) { setError('Template mode needs at least one {{placeholder}} in the body.'); return; }
    const sameTile = editable && editable.scope === scope && editable.name === name && slot === targetSlot;
    const occupant = sameTile ? undefined : get().board?.groups
      .find((g) => g.scope === scope && g.name === name && (scope !== 'workspace' || g.workspaceId === workspaceId))?.commands.find((c) => c.slot === targetSlot);
    const key = `${scope}:${name}:${targetSlot}`;
    if (occupant && replaceOk !== key) {
      setReplaceOk(key);
      setError(`Slot ${targetSlot} of ${name} holds "${occupant.label}". Press Enter again to replace it, or pick another slot.`);
      return;
    }
    const moved = editable && existing && !sameTile;
    // One message: the server removes the old tile only after the new one is saved.
    send({
      type: 'command.save',
      ref: { scope, cwd, workspaceId, group: name, slot: targetSlot },
      command: { label: label.trim(), body, mode },
      from: moved ? { scope: editable.scope as Scope, cwd, workspaceId: editable.workspaceId, group: editable.name, slot } : undefined,
    });
    set({ modal: null, groupKey: `${scope}:${scope === 'workspace' ? workspaceId ?? '' : ''}:${name}`, boardSlot: targetSlot });
    flash(`Saved ${label.trim()}`);
  }

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && (e.ctrlKey || !(e.target instanceof HTMLTextAreaElement))) { e.preventDefault(); save(); }
  };

  const title = existing && editable ? 'Edit workflow' : existing ? 'Save your own copy' : `New workflow on key ${slot}`;
  return (
    <Overlay label={title}>
      <div onKeyDown={onKey}>
        <DialogTitle>{title}</DialogTitle>
        {!editable && group && <p className="mb-3 text-sm text-sub">Skills can’t be changed here; this saves a copy you can change.</p>}
        <div className="grid grid-cols-[1fr_13rem] gap-3">
          <label className={labelClass}>Name on the key<input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} className={fieldClass} /></label>
          <label className={labelClass}>When pressed
            <select value={mode} onChange={(e) => setMode(e.target.value as CommandMode)} className={fieldClass}>
              <option value="send">Send it</option>
              <option value="insert">Put it in the message box</option>
              <option value="template">Ask for the blanks first</option>
            </select>
          </label>
        </div>
        <label className={`${labelClass} mt-3`}>
          What Claude is told {mode === 'template' && <span className="normal-case tracking-normal">· write {'{{name}}'} for each blank</span>}
          <textarea value={body} rows={4} onChange={(e) => setBody(e.target.value)} className={`${fieldClass} resize-none font-mono text-xs`} />
        </label>
        <div className="mt-3 grid grid-cols-[1fr_12rem_5rem] gap-3">
          <label className={labelClass}>Group<input value={groupName} onChange={(e) => setGroupName(e.target.value)} className={fieldClass} /></label>
          <label className={labelClass}>Saved for
            <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} className={fieldClass}>
              {workspaceId && <option value="workspace">this workspace</option>}
              <option value="global">just me, everywhere</option>
              {cwd && <option value="repo">everyone in this repo</option>}
            </select>
          </label>
          <label className={labelClass}>Key
            <select value={targetSlot} onChange={(e) => setTargetSlot(Number(e.target.value))} className={fieldClass}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        {scope === 'repo' && (
          <p className="mt-2 truncate text-sm text-faint">
            Writes <span className="font-mono">.cc-control/commands.json</span> in {cwd}. Commit it to share with your team.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
        <div className="mt-4 flex items-center">
          <DialogKeys items={[['Tab', 'next field'], ['Enter', 'save'], ['Ctrl+Enter', 'save from the text box'], ['Esc', 'cancel']]} />
          <button className="btn btn-primary ml-auto" onClick={save}>Save<Key k="Enter" size="sm" tone="ghost" /></button>
        </div>
      </div>
    </Overlay>
  );
}

export function DeleteDialog({ group, slot }: { group: CommandGroup; slot: number }) {
  const command = group.commands.find((c) => c.slot === slot);
  useDialogKeys((e) => {
    const k = e.key.toLowerCase();
    if (k === 'y' || k === 'enter') {
      send({ type: 'command.delete', ref: { scope: group.scope as 'workspace' | 'global' | 'repo', cwd: sessionById(get().openId)?.cwd, workspaceId: group.workspaceId, group: group.name, slot } });
      close();
    } else if (k === 'n' || k === 'escape') close();
    else return false;
    return true;
  });
  return (
    <Overlay label="Remove command">
      <DialogTitle>Remove this workflow?</DialogTitle>
      <p className="text-sub"><strong className="text-ink">{command?.label}</strong> comes off key {slot} in {group.name}.</p>
      <DialogKeys items={[['Y', 'remove'], ['N', 'keep it']]} />
    </Overlay>
  );
}

/** A voice utterance that looked like a command, but not confidently: fire it, or send the words. */
export function VoiceMatchDialog({ sessionId, text, command }: { sessionId: string; text: string; command: Command }) {
  useDialogKeys((e) => {
    const k = e.key.toLowerCase();
    if (k === 'y' || k === 'enter') { close(); fireCommand(sessionId, command); }
    else if (k === 'n') { close(); send({ type: 'session.send', id: sessionId, text }); flash('Sent (voice)'); }
    else if (k === 'escape') close();
    else return false;
    return true;
  });
  return (
    <Overlay label="Voice command?">
      <DialogTitle>Run a workflow?</DialogTitle>
      <p className="text-sub">You said <strong className="text-ink">“{text}”</strong>. Run <strong className="text-acc">{command.label}</strong>?</p>
      <DialogKeys items={[['Y', 'run it'], ['N', 'send the words instead'], ['Esc', 'drop it']]} />
    </Overlay>
  );
}
