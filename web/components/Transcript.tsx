import { memo, startTransition, useEffect, useLayoutEffect, useMemo, useState, type ReactElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TranscriptItem } from '../../shared/protocol.ts';
import { diffStats, lineDiff } from '../diff.ts';
import { toolStep, type StepIcon } from '../plain.ts';
import { useStore } from '../store.ts';
import { streamBlocks } from '../stream-md.ts';
import { DiffView } from './Approval.tsx';
import { Icon, type IconName } from './ui.tsx';

type Tool = Extract<TranscriptItem, { kind: 'tool' }>;
type Result = Extract<TranscriptItem, { kind: 'tool_result' }>;
type Block =
  | { kind: 'item'; item: Exclude<TranscriptItem, Tool | Result> }
  | { kind: 'steps'; key: string; tools: Tool[] };

/** Consecutive tool calls become one "steps" card between Claude's messages. */
export function toBlocks(items: TranscriptItem[]): Block[] {
  const blocks: Block[] = [];
  for (const it of items) {
    if (it.kind === 'tool_result') continue;
    if (it.kind === 'tool') {
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'steps') last.tools.push(it);
      else blocks.push({ kind: 'steps', key: it.uuid, tools: [it] });
    } else blocks.push({ kind: 'item', item: it });
  }
  return blocks;
}

const STEP_ICON: Record<StepIcon, IconName> = { read: 'read', edit: 'edit', run: 'run', search: 'search', web: 'web', agent: 'agent', plan: 'plan', tool: 'tool' };
/** Long runs show the last few steps; the rest fold away. */
const SHOW_LAST = 4;
/** Blocks drawn at once when a transcript shows; the rest follow in a transition (§99), so a long chat opens in a frame. */
const FIRST_BLOCKS = 40;
/** Parsed messages kept (§99), the least recently drawn going first. */
const MD_KEEP = 600;
const parsed = new Map<string, ReactElement>();

/**
 * A message's markdown, parsed once (§99): react-markdown's `Markdown` is a pure function of its
 * text, so its output is kept by text, and a card opened again (or a chat drawn again) doesn't parse
 * its messages again. On a slow laptop parsing 300 items' messages was most of a card switch.
 */
export function md(text: string): ReactElement {
  let el = parsed.get(text);
  if (el) {
    parsed.delete(text);
    parsed.set(text, el);
    return el;
  }
  el = Markdown({ children: text, remarkPlugins: [remarkGfm] });
  parsed.set(text, el);
  if (parsed.size > MD_KEEP) parsed.delete(parsed.keys().next().value!);
  return el;
}

/**
 * The conversation. Memoised (§96): it renders again only when its items change, and each message
 * and run of steps only when its own items do, so a streaming reply or a card's change elsewhere
 * doesn't re-render 300 messages.
 */
export const Transcript = memo(function Transcript({ items, cwd, expand }: { items: TranscriptItem[]; cwd?: string; expand: boolean }) {
  const results = useMemo(() => {
    const m = new Map<string, Result>();
    for (const it of items) if (it.kind === 'tool_result') m.set(it.toolUseId, it);
    return m;
  }, [items]);
  const blocks = useMemo(() => toBlocks(items), [items]);
  // The newest blocks first; the older ones in a transition that yields to keys (§99). The chat sits at
  // the bottom, so what arrives a moment later is above the view and the scroll keeps its place.
  const [whole, setWhole] = useState(false);
  useEffect(() => { if (!whole && blocks.length > FIRST_BLOCKS) startTransition(() => setWhole(true)); }, [whole, blocks.length]);
  const shown = whole || blocks.length <= FIRST_BLOCKS ? blocks : blocks.slice(-FIRST_BLOCKS);
  return (
    <>
      {shown.map((b) => (b.kind === 'steps'
        ? <Steps key={b.key} tools={b.tools} results={results} cwd={cwd} expand={expand} />
        : <Item key={b.item.uuid} it={b.item} />))}
    </>
  );
});

/** One block of a streaming reply: a finished one is parsed once (and kept); the last, still growing, each time. */
const StreamBlock = memo(function StreamBlock({ text, done }: { text: string; done: boolean }) {
  return done ? md(text) : <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>;
});

/**
 * What Claude is writing right now, word by word, until the message lands (§96). Its own component,
 * so a token re-renders this and not the transcript; finished blocks are parsed once and only the
 * last is parsed again. `onGrow` runs after each change (the chat keeps to the bottom).
 */
export function Streaming({ id, onGrow }: { id: string; onGrow?: () => void }) {
  const text = useStore((s) => s.partials[id] ?? '');
  const blocks = useMemo(() => streamBlocks(text), [text]);
  useLayoutEffect(() => { onGrow?.(); }, [text, onGrow]);
  if (!text) return null;
  return <div className="md leading-relaxed" aria-live="off" data-partial>{blocks.map((b, i) => <StreamBlock key={i} text={b} done={i < blocks.length - 1} />)}</div>;
}

const Item = memo(function Item({ it }: { it: Exclude<TranscriptItem, Tool | Result> }) {
  switch (it.kind) {
    case 'user':
      return <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-acc-soft px-4 py-2.5">{it.text}</div>;
    case 'assistant':
      return <div className="md leading-relaxed">{md(it.text)}</div>;
    case 'result': {
      const ok = it.subtype === 'success';
      const text = ok ? 'Finished' : it.subtype === 'error_during_execution' ? 'Stopped' : `Ended: ${it.subtype.replaceAll('_', ' ')}`;
      return (
        <div className={`flex items-center gap-2 text-[13px] ${ok ? 'text-faint' : 'text-attn'}`} title={it.costUsd !== undefined ? `API cost $${it.costUsd.toFixed(4)}` : undefined}>
          <span className="h-px w-6 bg-line" />{text}{it.durationMs !== undefined && ` in ${(it.durationMs / 1000).toFixed(1)}s`}
        </div>
      );
    }
    case 'notice':
      return <div className="flex items-center gap-2 text-[13px] text-calm"><Icon name="bg" size={14} />{it.text.replace(/^⧉\s*/, '')}</div>;
  }
});

type StepsProps = { tools: Tool[]; results: Map<string, Result>; cwd?: string; expand: boolean };
/** The same steps with the same results: nothing to draw again (toBlocks makes new arrays each time). */
const sameSteps = (a: StepsProps, b: StepsProps) => a.cwd === b.cwd && a.expand === b.expand && a.tools.length === b.tools.length
  && a.tools.every((t, i) => t === b.tools[i] && a.results.get(t.toolUseId) === b.results.get(t.toolUseId));

const Steps = memo(function Steps({ tools, results, cwd, expand }: StepsProps) {
  const [all, setAll] = useState(false);
  const hidden = all || expand ? 0 : Math.max(0, tools.length - SHOW_LAST);
  const failed = tools.filter((t) => results.get(t.toolUseId)?.isError).length;
  return (
    <div className="rounded-xl border border-line bg-surface px-3.5 py-1.5">
      {hidden > 0 && (
        <button className="flex w-full items-center gap-2 py-1.5 text-left text-[13.5px] text-sub hover:text-ink" onClick={() => setAll(true)}>
          <Icon name="down" size={15} />{hidden} earlier step{hidden === 1 ? '' : 's'}{failed ? ` · ${failed} had a problem` : ''}
        </button>
      )}
      {tools.slice(hidden).map((t) => <Step key={t.uuid} t={t} r={results.get(t.toolUseId)} cwd={cwd} expand={expand} />)}
    </div>
  );
}, sameSteps);

function Step({ t, r, cwd, expand }: { t: Tool; r?: Result; cwd?: string; expand: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = expand !== open;
  const step = toolStep(t.name, t.fields, t.input, !r, cwd);
  const edit = t.fields?.edit;
  const stats = edit ? diffStats(lineDiff(edit.before, edit.after)) : null;
  return (
    <div className="py-1">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 py-0.5 text-left text-[14px]" aria-expanded={shown}>
        {r ? (r.isError ? <Icon name="x" size={16} className="text-bad" /> : <Icon name="check" size={16} className="text-ok" />) : <span className="spinner mx-0.5 text-busy" />}
        <Icon name={STEP_ICON[step.icon]} size={15} className="text-faint" />
        <span className={`min-w-0 grow truncate ${r ? '' : 'text-busy'}`}>{step.text}</span>
        {stats && <span className="shrink-0 font-mono text-xs"><span className="text-ok">+{stats.added}</span>{stats.removed > 0 && <span className="text-bad"> −{stats.removed}</span>}</span>}
        <span className="shrink-0 text-xs text-faint">{shown ? 'Hide' : edit ? 'See change' : 'Details'}</span>
      </button>
      {shown && (
        <div className="mb-1.5 ml-7 mt-1 space-y-2">
          {edit ? <DiffView before={edit.before} after={edit.after} /> : (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-2 font-mono text-[12.5px] text-sub">{t.fields?.command ?? t.input}</pre>
          )}
          {r?.text && <pre className={`max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-2 font-mono text-[12.5px] ${r.isError ? 'text-bad' : 'text-sub'}`}>{r.text}</pre>}
        </div>
      )}
    </div>
  );
}
