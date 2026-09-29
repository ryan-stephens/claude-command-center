import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PermissionRequest, TranscriptItem } from '../../shared/protocol.ts';
import { backToList, respondPermission } from '../keys.ts';
import { startVoice, stopVoice, voiceSupported } from '../voice.ts';
import { set, setDraft, useStore } from '../store.ts';
import { send } from '../ws.ts';
import { CommandBoard } from './CommandBoard.tsx';
import { CtxMeter, shortPath, StatusBadge } from './StatusBadge.tsx';

const EMPTY: TranscriptItem[] = [];

export function SessionView() {
  const id = useStore((s) => s.openId)!;
  const session = useStore((s) => s.sessions.find((x) => x.id === id));
  const items = useStore((s) => s.transcripts[id] ?? EMPTY);
  const partial = useStore((s) => s.partials[id] ?? '');
  const permission = useStore((s) => Object.values(s.permissions).find((p) => p.sessionId === id));
  const zone = useStore((s) => s.zone);
  const expandTools = useStore((s) => s.expandTools);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow the output while the user is at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, partial, permission]);

  const results = new Map<string, Extract<TranscriptItem, { kind: 'tool_result' }>>();
  for (const it of items) if (it.kind === 'tool_result') results.set(it.toolUseId, it);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-2 py-2 text-sm md:gap-3 md:px-4">
        <button onClick={backToList} className="text-zinc-400 hover:text-zinc-100" title="Back to the list (Esc)">←</button>
        {session && <StatusBadge s={session} />}
        <span className="truncate font-medium text-zinc-100">{session?.title ?? id}</span>
        <span className="hidden truncate text-zinc-500 md:inline">
          {session && shortPath(session.cwd)}{session?.branch && ` · ${session.branch}`}
        </span>
        <CtxMeter pct={session?.ctxPct} />
        {session?.activeElsewhere && !session.live && (
          <span className="ml-auto rounded bg-orange-950 px-2 py-0.5 text-xs text-orange-300">
            Active in another window: sending will fork a new session
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            id="transcript"
            ref={scrollRef}
            tabIndex={-1}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            onClick={() => set({ zone: 'board' })}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-3 outline-none"
          >
            {items.length === 0 && !partial && <p className="text-zinc-600">No messages yet.</p>}
            {items.map((it) => <Item key={it.uuid} it={it} results={results} expand={expandTools} />)}
            {partial && <div className="md mb-3 text-zinc-200"><Markdown remarkPlugins={[remarkGfm]}>{partial}</Markdown></div>}
            {permission && <ApprovalCard p={permission} />}
          </div>
          <Composer id={id} focused={zone === 'composer'} />
          {/* Phones: the board opens as a panel under the composer. */}
          <MobileBoard />
        </div>
        <div className="hidden md:flex">
          <CommandBoard focused={zone === 'board'} />
        </div>
      </div>
    </div>
  );
}

function Item({ it, results, expand }: { it: TranscriptItem; results: Map<string, Extract<TranscriptItem, { kind: 'tool_result' }>>; expand: boolean }) {
  const [open, setOpen] = useState(false);
  switch (it.kind) {
    case 'user':
      return <div className="mb-3 whitespace-pre-wrap rounded border-l-2 border-sky-600 bg-zinc-900 px-3 py-2 text-zinc-100">{it.text}</div>;
    case 'assistant':
      return <div className="md mb-3 text-zinc-200"><Markdown remarkPlugins={[remarkGfm]}>{it.text}</Markdown></div>;
    case 'tool': {
      const r = results.get(it.toolUseId);
      const shown = expand !== open;
      return (
        <div className="mb-2 font-mono text-xs">
          <button onClick={() => setOpen(!open)} className="flex w-full gap-2 text-left text-zinc-400 hover:text-zinc-200">
            <span>{shown ? '▾' : '▸'}</span>
            <span className="text-violet-300">{it.name}</span>
            <span className="truncate">{it.input}</span>
            <span className={`ml-auto ${r ? (r.isError ? 'text-red-400' : 'text-emerald-500') : 'text-zinc-600'}`}>{r ? (r.isError ? '✗' : '✓') : '…'}</span>
          </button>
          {shown && (
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-zinc-900 p-2 text-zinc-400">
              {it.input}{r ? `\n\n${r.text}` : ''}
            </pre>
          )}
        </div>
      );
    }
    case 'tool_result':
      return null; // rendered with its tool call
    case 'result':
      return (
        <div className={`mb-4 text-xs ${it.subtype === 'success' ? 'text-zinc-600' : 'text-amber-500'}`}>
          — {it.subtype === 'success' ? 'done' : it.subtype.replaceAll('_', ' ')}
          {it.durationMs !== undefined && ` in ${(it.durationMs / 1000).toFixed(1)}s`}
          {it.costUsd !== undefined && ` · $${it.costUsd.toFixed(4)}`}
        </div>
      );
    case 'notice':
      return <div className="mb-3 text-xs text-orange-300">{it.text}</div>;
  }
}

function ApprovalCard({ p }: { p: PermissionRequest }) {
  return (
    <div className="mb-3 rounded border border-amber-600 bg-amber-950/50 p-3" role="alertdialog" aria-label="Tool approval">
      <div className="mb-1 text-sm text-amber-200">Allow <span className="font-mono text-amber-100">{p.tool}</span>?</div>
      <pre className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-300">{p.input}</pre>
      <div className="flex gap-2 text-sm">
        <button className="btn" onClick={() => respondPermission('allow')}><kbd>Y</kbd> Yes</button>
        {p.canAlways && <button className="btn" onClick={() => respondPermission('always')}><kbd>A</kbd> Always</button>}
        <button className="btn" onClick={() => respondPermission('deny')}><kbd>N</kbd> No</button>
      </div>
    </div>
  );
}

function Composer({ id, focused }: { id: string; focused: boolean }) {
  const draft = useStore((s) => s.drafts[id] ?? '');
  const voice = useStore((s) => (s.voice?.sessionId === id ? s.voice : null));
  const text = voice ? voice.text : draft;
  const ref = useRef<HTMLTextAreaElement>(null);
  const running = useStore((s) => s.sessions.find((x) => x.id === id)?.status === 'running');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focused) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length); // after an "insert" command, keep typing at the end
    } else el.blur();
  }, [focused, id]);

  function submit() {
    if (voice || !draft.trim()) return;
    send({ type: 'session.send', id, text: draft });
    setDraft(id, '');
  }

  return (
    <div className="border-t border-zinc-800 p-3">
      {voice && (
        <div className={`mb-1.5 flex items-center gap-2 text-xs ${voice.state === 'listening' ? 'text-red-400' : 'text-zinc-400'}`}>
          <span className={`h-2 w-2 rounded-full ${voice.state === 'listening' ? 'animate-pulse bg-red-500' : 'bg-zinc-500'}`} />
          {voice.state === 'listening' ? <>Listening… release to send · <kbd>Esc</kbd> cancel</> : 'Finishing…'}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          readOnly={Boolean(voice)}
          ref={ref}
          value={text}
          rows={Math.min(8, Math.max(2, text.split('\n').length))}
          onChange={(e) => setDraft(id, e.target.value)}
          onFocus={() => set({ zone: 'composer' })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={running ? 'Running… queue the next message' : 'Message · Enter to send'}
          className={`w-full resize-none rounded border bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-600 ${voice ? 'border-red-800' : 'border-zinc-800'}`}
        />
        <ComposerButtons id={id} canSend={Boolean(draft.trim()) && !voice} onSend={submit} />
      </div>
    </div>
  );
}

/** Touch controls: hold-to-talk mic, send, and the board toggle on phones. Keyboard users never need them. */
function ComposerButtons({ id, canSend, onSend }: { id: string; canSend: boolean; onSend: () => void }) {
  const listening = useStore((s) => s.voice?.sessionId === id && s.voice.state === 'listening');
  const boardOpen = useStore((s) => s.mobileBoard);
  const btn = 'flex h-10 w-10 shrink-0 items-center justify-center rounded border border-zinc-700 bg-zinc-900 text-base';
  return (
    <div className="flex gap-1.5">
      {voiceSupported() && (
        <button
          className={`${btn} touch-none select-none ${listening ? 'border-red-600 bg-red-950 text-red-300' : 'text-zinc-300'}`}
          title="Hold to talk"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startVoice(id); }}
          onPointerUp={stopVoice}
          onPointerCancel={stopVoice}
          onContextMenu={(e) => e.preventDefault()}
        >🎙</button>
      )}
      <button className={`${btn} md:hidden ${boardOpen ? 'border-sky-600 text-sky-300' : 'text-zinc-300'}`} title="Commands" onClick={() => set({ mobileBoard: !boardOpen })}>⌗</button>
      <button className={`${btn} ${canSend ? 'text-sky-300' : 'text-zinc-600'}`} title="Send (Enter)" disabled={!canSend} onClick={onSend}>➤</button>
    </div>
  );
}

function MobileBoard() {
  const open = useStore((s) => s.mobileBoard);
  if (!open) return null;
  return (
    <div className="max-h-[45vh] overflow-y-auto border-t border-zinc-800 md:hidden">
      <CommandBoard focused={false} compact />
    </div>
  );
}
