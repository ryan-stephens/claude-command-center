import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PermissionRequest, TranscriptItem } from '../../shared/protocol.ts';
import { respondPermission } from '../keys.ts';
import { set, setDraft, useStore } from '../store.ts';
import { send } from '../ws.ts';
import { CommandBoard } from './CommandBoard.tsx';
import { shortPath, StatusBadge } from './StatusBadge.tsx';

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
      <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2 text-sm">
        {session && <StatusBadge s={session} />}
        <span className="truncate font-medium text-zinc-100">{session?.title ?? id}</span>
        <span className="truncate text-zinc-500">
          {session && shortPath(session.cwd)}{session?.branch && ` · ${session.branch}`}
          {session?.ctxPct !== undefined && ` · ctx ${Math.round(session.ctxPct)}%`}
        </span>
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
        </div>
        <CommandBoard focused={zone === 'board'} />
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
  const text = useStore((s) => s.drafts[id] ?? '');
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
    if (!text.trim()) return;
    send({ type: 'session.send', id, text });
    setDraft(id, '');
  }

  return (
    <div className="border-t border-zinc-800 p-3">
      <textarea
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
        placeholder={running ? 'Running… you can queue the next message  (Ctrl+. to interrupt)' : 'Message  (Enter to send · Numpad fires commands while empty · Esc for the board)'}
        className="w-full resize-none rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-600"
      />
    </div>
  );
}
