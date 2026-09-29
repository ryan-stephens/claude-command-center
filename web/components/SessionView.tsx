import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FileHit, ImageAttachment, ModelChoice, SlashInfo, Todo, TranscriptItem } from '../../shared/protocol.ts';
import { workspacesFor } from '../../shared/workspaces.ts';
import { turnClock } from '../activity-label.ts';
import { argQuery, exactCommand, fileQuery, hintChoices, matchSlash, mention, runsAlone, slashQuery } from '../slash.ts';
import { historyFor, loadPrompts, rememberPrompt } from '../prompt-history.ts';
import { bindingsFor, displayCombo } from '../bindings.ts';
import { statusLabel } from '../home-model.ts';
import { askStop, backToList, cycleMode, hop } from '../keys.ts';
import { MODE_LABEL } from '../questions.ts';
import { startVoice, stopVoice, voiceSupported } from '../voice.ts';
import { flash, NO_BINDINGS, set, setDraft, toggleFold, useFlags, useStore } from '../store.ts';
import { searchFiles, send } from '../ws.ts';
import { ActivityBar, useNow } from './ActivityBar.tsx';
import { ApprovalCard } from './Approval.tsx';
import { ContextChips } from './Home.tsx';
import { NumPad } from './NumPad.tsx';
import { Transcript } from './Transcript.tsx';
import { Icon, Key, Pill, WsBadge } from './ui.tsx';

const EMPTY: TranscriptItem[] = [];
const NO_SLASH: SlashInfo[] = [];
const NO_MODELS: ModelChoice[] = [];

/** The number pad, folded away: the conversation gets the width; Tab (or a click) still opens it. */
function PadRail() {
  return (
    <aside aria-label="Number pad (folded)" className="flex w-14 shrink-0 flex-col items-center gap-4 border-l border-line bg-col py-3">
      <button onClick={() => toggleFold('pad')} aria-label="Keep the number pad open" title="Keep the number pad open" className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-raise hover:text-ink">
        <Icon name="back" size={16} />
      </button>
      <button onClick={() => set({ zone: 'board' })} title="Use the number pad (Tab from the message box)" className="flex flex-col items-center gap-1.5 text-faint hover:text-ink">
        <Icon name="grid" size={20} />
        <Key k="Tab" size="sm" />
      </button>
    </aside>
  );
}

export function SessionView() {
  const id = useStore((s) => s.openId)!;
  const session = useStore((s) => s.sessions.find((x) => x.id === id));
  const items = useStore((s) => s.transcripts[id] ?? EMPTY);
  const partial = useStore((s) => s.partials[id] ?? '');
  const permission = useStore((s) => Object.values(s.permissions).find((p) => p.sessionId === id));
  const zone = useStore((s) => s.zone);
  const expandTools = useStore((s) => s.expandTools);
  const padFolded = useStore((s) => s.folds.pad);
  const ws = useStore((s) => (session ? workspacesFor(session.cwd, s.workspaces)[0] ?? null : null));
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow the output while the user is at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, partial, permission]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SessionHeader id={id} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {session && (
            <div className="flex flex-wrap items-center gap-3 border-b border-line bg-col px-4 py-2 md:px-6">
              <ContextChips s={session} ws={ws} removable />
              {session.ctxPct !== undefined && <MemoryMeter pct={session.ctxPct} />}
            </div>
          )}
          {session?.activeElsewhere && !session.live && (
            <div className="flex items-center gap-2 border-b border-line bg-calm-bg px-4 py-2 text-sm text-calm md:px-6">
              <Icon name="warn" size={16} />This session looks open in a terminal. Sending here makes a copy, so the two don’t write over each other.
            </div>
          )}
          <div
            id="transcript"
            ref={scrollRef}
            tabIndex={-1}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            className="min-h-0 flex-1 overflow-y-auto outline-none"
          >
            <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-5 md:px-6">
              {items.length === 0 && !partial && <p className="text-faint">No messages yet. Tell Claude what you want below.</p>}
              <Transcript items={items} cwd={session?.cwd} expand={expandTools} />
              {partial && <div className="md leading-relaxed"><Markdown remarkPlugins={[remarkGfm]}>{partial}</Markdown></div>}
              {permission && <ApprovalCard p={permission} cwd={session?.cwd} />}
            </div>
          </div>
          <TodoPanel id={id} />
          <ActivityBar id={id} />
          <Composer id={id} focused={zone === 'composer'} />
          {/* Phones: the number pad opens as a panel under the composer. */}
          <MobilePad />
        </div>
        <div className="hidden md:flex">
          {padFolded && zone !== 'board' ? <PadRail /> : <NumPad focused={zone === 'board'} />}
        </div>
      </div>
    </div>
  );
}

function SessionHeader({ id }: { id: string }) {
  const session = useStore((s) => s.sessions.find((x) => x.id === id));
  const ws = useStore((s) => (session ? workspacesFor(session.cwd, s.workspaces)[0] ?? null : null));
  const flags = useFlags(id);
  const activity = useStore((s) => s.activity[id]);
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  const now = useNow(Boolean(activity && activity.phase !== 'idle'));
  const status = session ? statusLabel(session, flags) : null;
  const clock = turnClock(activity, now);
  const k = (a: 'prevSession' | 'nextSession') => displayCombo(bindingsFor(a, bindings)[0] ?? '');
  return (
    <div className="flex items-center gap-3 border-b border-line px-3 py-2.5 md:px-4">
      <button onClick={backToList} className="btn btn-ghost min-h-0 py-1 pl-1.5 pr-2" title="Back to home (Esc when idle, Numpad 0)">
        <Icon name="back" size={17} /><span className="hidden md:inline">Home</span><Key k="0" size="sm" className="hidden md:inline-flex" />
      </button>
      {ws && <span className="hidden items-center gap-2 text-sub md:flex"><WsBadge ws={ws} size={22} />{ws.name}<span className="text-faint">/</span></span>}
      <button className="min-w-0 truncate text-left text-[16px] font-semibold" onClick={() => set({ modal: { kind: 'rename', id } })} title="Rename (R)">
        {session?.title ?? id}
      </button>
      {status?.text && <Pill tone={status.tone} spin={status.tone === 'blue'}>{status.text}{clock && status.tone === 'blue' ? ` · ${clock}` : ''}</Pill>}
      <span className="ml-auto" />
      <span className="hidden items-center gap-1.5 text-sm text-faint lg:flex">
        <button onClick={() => hop(-1)} title="Previous session"><Key k={k('prevSession')} size="sm" /></button>
        <button onClick={() => hop(1)} title="Next session"><Key k={k('nextSession')} size="sm" /></button>
        other sessions
      </span>
      {session?.live && (
        <button className="btn btn-ghost min-h-0 py-1 text-sm hover:text-bad" onClick={() => askStop(id)} title="End this session: stops Claude and anything it runs in the background. It stays in the list and can be continued.">
          End session<Key k="X" size="sm" className="hidden md:inline-flex" />
        </button>
      )}
    </div>
  );
}

/** How full Claude's working memory (context window) is; time to tidy up near the top. */
function MemoryMeter({ pct }: { pct: number }) {
  const color = pct >= 85 ? 'bg-bad' : pct >= 70 ? 'bg-attn' : 'bg-ok';
  return (
    <span className="ml-auto flex items-center gap-2 text-sm text-faint" title={`Claude's working memory for this session is ${pct.toFixed(0)}% full. Near the top, run /compact (Built-in group) to tidy it.`}>
      Memory
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-raise"><span className={`block h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} /></span>
      {Math.round(pct)}%
    </span>
  );
}

/** One row of the suggestion list above the message box: a slash command or an "@" file. */
interface Suggestion {
  key: string;
  title: string;
  aside?: string;
  desc?: string;
  hint?: string;
  /** What Enter does with it (Tab always completes). */
  enter: 'run' | 'complete' | 'insert';
  take: (run: boolean) => void;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
type Pasted = ImageAttachment & { url: string };

/** Read an image file for sending: base64 without the data: prefix, plus a preview URL. */
function readImage(file: File): Promise<Pasted> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      resolve({ mediaType: file.type as ImageAttachment['mediaType'], data: url.slice(url.indexOf(',') + 1), url });
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function Composer({ id, focused }: { id: string; focused: boolean }) {
  const draft = useStore((s) => s.drafts[id] ?? '');
  const voice = useStore((s) => (s.voice?.sessionId === id ? s.voice : null));
  const text = voice ? voice.text : draft;
  const dialogOpen = useStore((s) => s.modal !== null);
  const status = useStore((s) => s.sessions.find((x) => x.id === id)?.status);
  const pending = useStore((s) => Object.values(s.permissions).some((p) => p.sessionId === id));
  const commands = useStore((s) => (s.slash?.sessionId === id ? s.slash.commands : NO_SLASH));
  const models = useStore((s) => (s.slash?.sessionId === id ? s.slash.models : NO_MODELS));
  const items = useStore((s) => s.transcripts[id] ?? EMPTY);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  // Esc hides the suggestions until the text changes.
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const [files, setFiles] = useState<FileHit[]>([]);
  const [images, setImages] = useState<Pasted[]>([]);
  // ↑ ↓ through earlier messages: where we are (-1: not browsing) and the draft to come back to.
  const [histAt, setHistAt] = useState(-1);
  const [saved, setSaved] = useState('');

  const slashQ = voice ? null : slashQuery(draft);
  // A command's argument with fixed choices (/model, /effort, on/off), picked like Claude Code's menus.
  const argQ = voice || slashQ !== null ? null : argQuery(draft);
  const argCmd = argQ ? exactCommand(`/${argQ.name}`, commands) : undefined;
  const argChoices: { value: string; label: string; desc?: string }[] | null = !argCmd ? null
    : argCmd.name === 'model' ? models.map((m) => ({ value: m.value, label: m.displayName, desc: m.description }))
    : hintChoices(argCmd.argumentHint)?.map((v) => ({ value: v, label: v })) ?? null;
  const atQ = voice || slashQ !== null || argChoices ? null : fileQuery(draft, caret);
  const hidden = hiddenFor === draft;

  // "@" file suggestions come from the server, a moment after typing stops.
  useEffect(() => {
    if (!atQ || hidden) { setFiles([]); return; }
    let live = true;
    const t = setTimeout(() => { searchFiles(id, atQ.query).then((h) => { if (live) setFiles(h); }, () => {}); }, 120);
    return () => { live = false; clearTimeout(t); };
  }, [id, atQ?.query, atQ?.start, hidden]);

  const suggestions: Suggestion[] = hidden ? [] : slashQ !== null
    ? matchSlash(commands, slashQ).map((c) => ({
      key: c.name,
      title: `/${c.name}`,
      aside: c.aliases?.map((a) => `/${a}`).join(' '),
      desc: c.description,
      hint: c.argumentHint,
      enter: runsAlone(c) ? 'run' : 'complete',
      take: (run) => {
        if (run && runsAlone(c)) { sendText(`/${c.name}`); } else setDraft(id, `/${c.name} `);
      },
    }))
    : argChoices && argQ && argCmd ? argChoices
      .filter((c) => !argQ.partial || `${c.value} ${c.label}`.toLowerCase().includes(argQ.partial.toLowerCase()))
      .map((c) => ({
        key: c.value,
        title: c.label,
        aside: c.label !== c.value ? c.value : undefined,
        desc: c.desc,
        enter: 'run' as const,
        take: () => sendText(`/${argCmd.name} ${c.value}`),
      }))
    : atQ ? files.map((f) => ({
      key: f.path,
      title: f.label,
      aside: f.repo,
      enter: 'insert',
      take: () => {
        const before = draft.slice(0, atQ.start);
        const after = draft.slice(caret);
        const inserted = `${mention(f.path)} `;
        setDraft(id, before + inserted + after.replace(/^\S*/, ''));
        const at = before.length + inserted.length;
        requestAnimationFrame(() => { ref.current?.setSelectionRange(at, at); setCaret(at); });
      },
    }))
    : [];
  const chosen = suggestions[Math.min(pick, suggestions.length - 1)];
  const typedCommand = !suggestions.length && !voice ? exactCommand(draft, commands) : undefined;
  useEffect(() => { setPick(0); }, [slashQ, atQ?.query, argQ?.partial, argQ?.name]);

  useEffect(() => {
    const el = ref.current;
    if (!el || dialogOpen) return;
    if (focused) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length); // after an "insert" workflow, keep typing at the end
      setCaret(el.value.length);
    } else el.blur();
  }, [focused, id, dialogOpen]); // re-run when a dialog closes, so focus comes back here

  function sendText(body: string) {
    send({ type: 'session.send', id, text: body, ...(images.length ? { images: images.map(({ mediaType, data }) => ({ mediaType, data })) } : {}) });
    rememberPrompt(body);
    setDraft(id, '');
    setImages([]);
    setHistAt(-1);
    ref.current?.focus();
  }

  function submit() {
    if (voice || (!draft.trim() && !images.length)) return;
    sendText(draft.trim() ? draft : 'What do you see in this image?');
  }

  async function attach(list: FileList | File[]) {
    const picked = [...list].filter((f) => IMAGE_TYPES.includes(f.type));
    if (!picked.length) return false;
    const room = 5 - images.length;
    const tooBig = picked.find((f) => f.size > 5 * 1024 * 1024);
    if (tooBig) { flash(`${tooBig.name || 'That image'} is over 5 MB`); return true; }
    if (picked.length > room) flash('Up to 5 images per message');
    const read = await Promise.all(picked.slice(0, room).map(readImage));
    setImages((x) => [...x, ...read].slice(0, 5));
    return true;
  }

  /** ↑ / ↓ on the first / last line of the box walk through earlier messages. */
  function browseHistory(dir: 1 | -1): boolean {
    const el = ref.current;
    if (!el) return false;
    const onFirstLine = !el.value.slice(0, el.selectionStart).includes('\n');
    const onLastLine = !el.value.slice(el.selectionEnd).includes('\n');
    if (dir === 1 && !(onFirstLine && (histAt >= 0 || !draft))) return false;
    if (dir === -1 && !(onLastLine && histAt >= 0)) return false;
    const list = historyFor(items, loadPrompts());
    const next = histAt + dir;
    if (next >= list.length) return true;
    if (histAt < 0) setSaved(draft);
    setHistAt(next);
    setDraft(id, next < 0 ? saved : list[next]);
    return true;
  }

  const placeholder = pending ? 'Answer Claude above, or type a different instruction'
    : status === 'running' ? 'Claude is working. Type your next message; it waits its turn.'
    : 'Tell Claude what you want · / for commands · @ for files · Enter to send';
  return (
    <div className="border-t border-line px-3 py-3 md:px-6">
      {voice && (
        <div className={`mx-auto mb-2 flex max-w-3xl items-center gap-2 text-sm ${voice.state === 'listening' ? 'text-bad' : 'text-sub'}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${voice.state === 'listening' ? 'pulse bg-bad' : 'bg-faint'}`} />
          {voice.state === 'listening' ? <>Listening… release to send · <Key k="Esc" size="sm" /> cancels</> : 'Finishing…'}
        </div>
      )}
      {suggestions.length > 0 && focused && (
        <div className="relative mx-auto max-w-3xl">
          <ul className="absolute inset-x-0 bottom-1.5 z-10 max-h-80 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-xl" role="listbox" aria-label={slashQ !== null ? 'Commands' : argChoices ? 'Choices' : 'Files'}>
            {suggestions.map((c) => (
              <li
                key={c.key}
                role="option"
                aria-selected={c === chosen}
                onMouseMove={() => { if (c !== chosen) setPick(suggestions.indexOf(c)); }}
                onMouseDown={(e) => { e.preventDefault(); c.take(true); ref.current?.focus(); }}
                className={`flex cursor-pointer items-baseline gap-3 rounded-xl px-3 py-1.5 ${c === chosen ? 'is-focus bg-raise' : ''}`}
              >
                {slashQ === null && !argChoices && <Icon name="file" size={14} className="shrink-0 self-center text-faint" />}
                <span className="min-w-0 shrink truncate font-mono text-[14px] font-semibold">{c.title}</span>
                {c.aside && <span className="shrink-0 text-xs text-faint">{c.aside}</span>}
                <span className="min-w-0 grow truncate text-sm text-sub">{c.desc}</span>
                {c.hint && <span className="max-w-[35%] shrink-0 truncate font-mono text-xs text-faint">{c.hint}</span>}
              </li>
            ))}
            <li className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 pb-0.5 pt-1.5 text-xs text-faint" role="presentation">
              <span className="flex items-center gap-1"><Key k="↑ ↓" size="sm" />choose</span>
              <span className="flex items-center gap-1"><Key k="Tab" size="sm" />{slashQ !== null ? 'complete' : argChoices ? 'pick' : 'insert'}</span>
              <span className="flex items-center gap-1"><Key k="Enter" size="sm" />{chosen?.enter}</span>
              <span className="flex items-center gap-1"><Key k="Esc" size="sm" />hide</span>
            </li>
          </ul>
        </div>
      )}
      {typedCommand && (
        <p className="mx-auto mb-1.5 max-w-3xl truncate px-1 text-xs text-faint">
          <span className="font-mono font-semibold text-sub">/{typedCommand.name}</span>{typedCommand.argumentHint && <span className="font-mono"> {typedCommand.argumentHint}</span>} · {typedCommand.description}
        </p>
      )}
      <div
        className={`mx-auto max-w-3xl rounded-2xl border-2 bg-surface p-1.5 pl-3 ${voice ? 'border-bad' : focused ? 'border-acc' : 'border-line'}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void attach(e.dataTransfer.files); } }}
      >
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-1.5 pt-1" aria-label="Images to send">
            {images.map((img, i) => (
              <span key={img.url.slice(-40) + i} className="relative">
                <img src={img.url} alt={`Image ${i + 1}`} className="h-16 w-16 rounded-lg border border-line object-cover" />
                <button onClick={() => setImages((x) => x.filter((_, j) => j !== i))} aria-label={`Remove image ${i + 1}`} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-surface text-faint hover:text-bad">
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            readOnly={Boolean(voice)}
            ref={ref}
            value={text}
            rows={Math.min(8, Math.max(1, text.split('\n').length))}
            onChange={(e) => { setDraft(id, e.target.value); setCaret(e.target.selectionStart); setHistAt(-1); }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onFocus={() => set({ zone: 'composer' })}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.some((f) => IMAGE_TYPES.includes(f.type))) { e.preventDefault(); void attach(pasted); }
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              const take = () => { e.preventDefault(); e.stopPropagation(); };
              if (chosen) {
                if (e.key === 'ArrowDown') { take(); setPick((pick + 1) % suggestions.length); return; }
                if (e.key === 'ArrowUp') { take(); setPick((pick - 1 + suggestions.length) % suggestions.length); return; }
                if (e.key === 'Tab' && !e.shiftKey) { take(); chosen.take(false); return; }
                if (e.key === 'Enter' && !e.shiftKey) { take(); chosen.take(true); return; }
                if (e.key === 'Escape') { take(); setHiddenFor(draft); return; }
              }
              if (e.key === 'ArrowUp' && !e.altKey && !e.shiftKey && browseHistory(1)) { take(); return; }
              if (e.key === 'ArrowDown' && !e.altKey && !e.shiftKey && browseHistory(-1)) { take(); return; }
              if (e.key === 'Backspace' && !draft && images.length) { take(); setImages((x) => x.slice(0, -1)); return; }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder={placeholder}
            aria-label="Message to Claude"
            className="min-h-9 w-full resize-none bg-transparent py-1.5 outline-none placeholder:text-faint"
          />
          <ComposerButtons id={id} canSend={(Boolean(draft.trim()) || images.length > 0) && !voice} onSend={submit} />
        </div>
      </div>
      <ModeLine id={id} />
    </div>
  );
}

/** Touch and mouse controls: hold-to-talk, the phone number pad toggle, send. */
const NO_TODOS: Todo[] = [];

/** Claude's to-do list while it works, as Claude Code shows it. Folds to one line (L). */
function TodoPanel({ id }: { id: string }) {
  const todos = useStore((s) => s.todos[id] ?? NO_TODOS);
  const folded = useStore((s) => s.folds.todos);
  if (!todos.length) return null;
  const done = todos.filter((t) => t.status === 'completed').length;
  const now = todos.find((t) => t.status === 'in_progress');
  return (
    <div className="border-t border-line px-3 py-2 md:px-6">
      <div className="mx-auto max-w-3xl">
        <button onClick={() => toggleFold('todos')} aria-expanded={!folded} className="flex w-full items-center gap-2 text-left text-sm" title="Fold or open (L)">
          <Icon name={folded ? 'right' : 'down'} size={14} className="text-faint" />
          <span className="font-semibold">To-do</span>
          <span className="text-faint">{done} of {todos.length} done</span>
          {folded && now && <span className="min-w-0 truncate text-busy">· {now.activeForm ?? now.content}</span>}
          <Key k="L" size="sm" className="ml-auto" />
        </button>
        {!folded && (
          <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto pl-6 text-sm" aria-label="Claude’s to-do list">
            {todos.map((t) => (
              <li key={t.id} className={`flex items-start gap-2 ${t.status === 'completed' ? 'text-faint line-through' : t.status === 'in_progress' ? 'font-semibold text-busy' : 'text-sub'}`}>
                <span className="mt-0.5 shrink-0">{t.status === 'completed' ? <Icon name="check" size={14} className="text-ok" /> : t.status === 'in_progress' ? <span className="spinner" /> : <span className="inline-block h-3.5 w-3.5 rounded-full border border-line" />}</span>
                <span className="min-w-0">{t.status === 'in_progress' ? t.activeForm ?? t.content : t.content}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const MODE_TONE: Record<string, string> = { default: 'bg-raise text-sub', acceptEdits: 'bg-busy-bg text-busy', plan: 'bg-calm-bg text-calm' };

/** Under the message box: the mode (Shift+Tab switches it, as in Claude Code) and the model. */
function ModeLine({ id }: { id: string }) {
  const mode = useStore((s) => s.sessions.find((x) => x.id === id)?.mode ?? 'default');
  const model = useStore((s) => s.sessions.find((x) => x.id === id)?.model);
  const label = MODE_LABEL[mode];
  return (
    <div className="mx-auto mt-1.5 flex max-w-3xl items-center gap-2 px-1 text-xs text-faint">
      <button onClick={() => cycleMode(id)} title={`${label.name}: ${label.hint}. Shift+Tab switches.`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold ${MODE_TONE[mode] ?? 'bg-raise text-sub'}`}>
        <Icon name={mode === 'plan' ? 'plan' : mode === 'acceptEdits' ? 'edit' : 'shield'} size={12} />{label.name}
      </button>
      <span className="hidden truncate sm:inline">{label.hint}</span>
      <Key k="⇧Tab" size="sm" />
      {model && <span className="ml-auto truncate font-mono" title="Change it with /model">{model}</span>}
    </div>
  );
}

function ComposerButtons({ id, canSend, onSend }: { id: string; canSend: boolean; onSend: () => void }) {
  const listening = useStore((s) => s.voice?.sessionId === id && s.voice.state === 'listening');
  const padOpen = useStore((s) => s.mobileBoard);
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  const talkKey = displayCombo(bindingsFor('pushToTalk', bindings)[0] ?? '');
  const btn = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl';
  return (
    <div className="flex gap-1">
      {voiceSupported() && (
        <button
          className={`${btn} touch-none select-none ${listening ? 'bg-bad-bg text-bad' : 'text-sub hover:bg-raise'}`}
          title={`Hold to talk (or hold ${talkKey})`}
          aria-label="Hold to talk"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startVoice(id); }}
          onPointerUp={stopVoice}
          onPointerCancel={stopVoice}
          onContextMenu={(e) => e.preventDefault()}
        ><Icon name="mic" /></button>
      )}
      <button className={`${btn} md:hidden ${padOpen ? 'bg-acc-soft text-acc' : 'text-sub'}`} aria-label="Workflows" title="Workflows" onClick={() => set({ mobileBoard: !padOpen })}><Icon name="grid" /></button>
      <button className={`${btn} ${canSend ? 'bg-acc text-acc-ink' : 'text-faint'}`} title="Send (Enter)" aria-label="Send" disabled={!canSend} onClick={onSend}><Icon name="send" /></button>
    </div>
  );
}

function MobilePad() {
  const open = useStore((s) => s.mobileBoard);
  if (!open) return null;
  return (
    <div className="max-h-[50vh] overflow-y-auto border-t border-line md:hidden">
      <NumPad focused={false} compact />
    </div>
  );
}
