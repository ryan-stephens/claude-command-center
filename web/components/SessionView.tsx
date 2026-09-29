import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SlashInfo, TranscriptItem } from '../../shared/protocol.ts';
import { workspacesFor } from '../../shared/workspaces.ts';
import { turnClock } from '../activity-label.ts';
import { exactCommand, matchSlash, runsAlone, slashQuery } from '../slash.ts';
import { bindingsFor, displayCombo } from '../bindings.ts';
import { statusLabel } from '../home-model.ts';
import { askStop, backToList, hop } from '../keys.ts';
import { startVoice, stopVoice, voiceSupported } from '../voice.ts';
import { NO_BINDINGS, set, setDraft, toggleFold, useFlags, useStore } from '../store.ts';
import { send } from '../ws.ts';
import { ActivityBar, useNow } from './ActivityBar.tsx';
import { ApprovalCard } from './Approval.tsx';
import { ContextChips } from './Home.tsx';
import { NumPad } from './NumPad.tsx';
import { Transcript } from './Transcript.tsx';
import { Icon, Key, Pill, WsBadge } from './ui.tsx';

const EMPTY: TranscriptItem[] = [];
const NO_SLASH: SlashInfo[] = [];

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

function Composer({ id, focused }: { id: string; focused: boolean }) {
  const draft = useStore((s) => s.drafts[id] ?? '');
  const voice = useStore((s) => (s.voice?.sessionId === id ? s.voice : null));
  const text = voice ? voice.text : draft;
  const dialogOpen = useStore((s) => s.modal !== null);
  const status = useStore((s) => s.sessions.find((x) => x.id === id)?.status);
  const pending = useStore((s) => Object.values(s.permissions).some((p) => p.sessionId === id));
  const commands = useStore((s) => (s.slash?.sessionId === id ? s.slash.commands : NO_SLASH));
  const ref = useRef<HTMLTextAreaElement>(null);
  // Suggestions while a command is typed at the start: /cl → /clear. Esc hides them until the text changes.
  const [pick, setPick] = useState(0);
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const query = voice ? null : slashQuery(draft);
  const suggestions = query !== null && hiddenFor !== draft ? matchSlash(commands, query) : [];
  const chosen = suggestions[Math.min(pick, suggestions.length - 1)];
  const typedCommand = !suggestions.length && !voice ? exactCommand(draft, commands) : undefined;
  useEffect(() => { setPick(0); }, [query]);

  /** Take a suggestion: run it when it needs nothing more, else complete it and wait for its arguments. */
  function accept(c: SlashInfo, run: boolean) {
    if (run && runsAlone(c)) {
      send({ type: 'session.send', id, text: `/${c.name}` });
      setDraft(id, '');
    } else setDraft(id, `/${c.name} `);
    ref.current?.focus();
  }

  useEffect(() => {
    const el = ref.current;
    if (!el || dialogOpen) return;
    if (focused) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length); // after an "insert" workflow, keep typing at the end
    } else el.blur();
  }, [focused, id, dialogOpen]); // re-run when a dialog closes, so focus comes back here

  function submit() {
    if (voice || !draft.trim()) return;
    send({ type: 'session.send', id, text: draft });
    setDraft(id, '');
  }

  const placeholder = pending ? 'Answer Claude above, or type a different instruction'
    : status === 'running' ? 'Claude is working. Type your next message; it waits its turn.'
    : 'Tell Claude what you want · Enter to send';
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
          <ul className="absolute inset-x-0 bottom-1.5 z-10 max-h-80 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-xl" role="listbox" aria-label="Commands">
            {suggestions.map((c) => (
              <li
                key={c.name}
                role="option"
                aria-selected={c === chosen}
                onMouseMove={() => { if (c !== chosen) setPick(suggestions.indexOf(c)); }}
                onMouseDown={(e) => { e.preventDefault(); accept(c, true); }}
                className={`flex cursor-pointer items-baseline gap-3 rounded-xl px-3 py-1.5 ${c === chosen ? 'is-focus bg-raise' : ''}`}
              >
                <span className="shrink-0 font-mono text-[14px] font-semibold">/{c.name}</span>
                {c.aliases?.length ? <span className="shrink-0 text-xs text-faint">{c.aliases.map((a) => `/${a}`).join(' ')}</span> : null}
                <span className="min-w-0 grow truncate text-sm text-sub">{c.description}</span>
                {c.argumentHint && <span className="max-w-[35%] shrink-0 truncate font-mono text-xs text-faint">{c.argumentHint}</span>}
              </li>
            ))}
            <li className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 pb-0.5 pt-1.5 text-xs text-faint" role="presentation">
              <span className="flex items-center gap-1"><Key k="↑ ↓" size="sm" />choose</span>
              <span className="flex items-center gap-1"><Key k="Tab" size="sm" />complete</span>
              <span className="flex items-center gap-1"><Key k="Enter" size="sm" />{chosen && !runsAlone(chosen) ? 'complete' : 'run'}</span>
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
      <div className={`mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border-2 bg-surface p-1.5 pl-3 ${voice ? 'border-bad' : focused ? 'border-acc' : 'border-line'}`}>
        <textarea
          readOnly={Boolean(voice)}
          ref={ref}
          value={text}
          rows={Math.min(8, Math.max(1, text.split('\n').length))}
          onChange={(e) => setDraft(id, e.target.value)}
          onFocus={() => set({ zone: 'composer' })}
          onKeyDown={(e) => {
            if (chosen && !e.nativeEvent.isComposing) {
              const take = () => { e.preventDefault(); e.stopPropagation(); };
              if (e.key === 'ArrowDown') { take(); setPick((pick + 1) % suggestions.length); return; }
              if (e.key === 'ArrowUp') { take(); setPick((pick - 1 + suggestions.length) % suggestions.length); return; }
              if (e.key === 'Tab' && !e.shiftKey) { take(); accept(chosen, false); return; }
              if (e.key === 'Enter' && !e.shiftKey) { take(); accept(chosen, true); return; }
              if (e.key === 'Escape') { take(); setHiddenFor(draft); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label="Message to Claude"
          className="min-h-9 w-full resize-none bg-transparent py-1.5 outline-none placeholder:text-faint"
        />
        <ComposerButtons id={id} canSend={Boolean(draft.trim()) && !voice} onSend={submit} />
      </div>
    </div>
  );
}

/** Touch and mouse controls: hold-to-talk, the phone number pad toggle, send. */
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
