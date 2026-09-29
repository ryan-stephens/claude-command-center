import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TranscriptItem } from '../../shared/protocol.ts';
import { diffStats, lineDiff } from '../diff.ts';
import { toolStep, type StepIcon } from '../plain.ts';
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

export function Transcript({ items, cwd, expand }: { items: TranscriptItem[]; cwd?: string; expand: boolean }) {
  const results = new Map<string, Result>();
  for (const it of items) if (it.kind === 'tool_result') results.set(it.toolUseId, it);
  return (
    <>
      {toBlocks(items).map((b) => (b.kind === 'steps'
        ? <Steps key={b.key} tools={b.tools} results={results} cwd={cwd} expand={expand} />
        : <Item key={b.item.uuid} it={b.item} />))}
    </>
  );
}

function Item({ it }: { it: Exclude<TranscriptItem, Tool | Result> }) {
  switch (it.kind) {
    case 'user':
      return <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-acc-soft px-4 py-2.5">{it.text}</div>;
    case 'assistant':
      return <div className="md leading-relaxed"><Markdown remarkPlugins={[remarkGfm]}>{it.text}</Markdown></div>;
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
}

function Steps({ tools, results, cwd, expand }: { tools: Tool[]; results: Map<string, Result>; cwd?: string; expand: boolean }) {
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
}

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
