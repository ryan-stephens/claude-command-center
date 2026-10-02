// A run's output as it prints (PLAN §84): the Try it panel shows it under the highlighted service,
// and f pops it out full width (OutputSheet). The page follows the run while this is on screen; the
// view keeps to the newest line unless you scrolled up, and a step's start is a marked line.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CardRun, LogLine } from '../../shared/recipes.ts';
import { useStore } from '../store.ts';
import { followRun } from '../ws.ts';

const NONE: LogLine[] = [];
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** The lines that match the filter (case doesn't matter); step marks stay so the output keeps its shape. */
export function filterLines(lines: LogLine[], filter: string): LogLine[] {
  const q = filter.trim().toLowerCase();
  if (!q) return lines;
  return lines.filter((l) => l.mark || l.text.toLowerCase().includes(q));
}

/**
 * `runKey`: the run to follow. `run`: its state, for the empty line. `jump`: bumped to go back to the
 * newest line (End in the sheet). `wrap`: long lines fold instead of scrolling sideways.
 */
export function RunLog({ runKey: key, run, filter = '', wrap = true, jump = 0, className = '' }: { runKey: string; run: CardRun | undefined; filter?: string; wrap?: boolean; jump?: number; className?: string }) {
  const lines = useStore((s) => s.logs[key] ?? NONE);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [behind, setBehind] = useState(false);
  useEffect(() => followRun(key), [key]);
  useLayoutEffect(() => { stick.current = true; setBehind(false); }, [key, jump]);
  const shown = filterLines(lines, filter);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown, wrap, jump]);
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 12;
    stick.current = atEnd;
    setBehind(!atEnd);
  };
  const toEnd = () => { stick.current = true; setBehind(false); const el = box.current; if (el) el.scrollTop = el.scrollHeight; };
  return (
    <div className={`relative min-h-0 ${className}`}>
      <div ref={box} onScroll={onScroll} role="log" aria-label="Output" aria-live="off"
        className="h-full max-h-full overflow-auto rounded-lg border border-line bg-bg py-1.5 font-mono text-[11.5px] leading-[1.5] text-sub">
        {shown.length === 0 && (
          <p className="px-3 py-1 font-sans text-[12.5px] text-faint">
            {!run ? 'Not started yet. What it prints shows here as it runs.' : filter.trim() ? 'No line says that.' : run.state === 'running' ? 'Nothing printed yet.' : 'It printed nothing.'}
          </p>
        )}
        {shown.map((l) => (
          <div key={l.n} title={clock(l.t)} className={`px-3 ${wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'} ${l.mark ? 'mt-1 font-semibold text-busy first:mt-0' : ''}`}>{l.text}</div>
        ))}
      </div>
      {behind && (
        <button onClick={toEnd} className="absolute bottom-2 right-3 rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11.5px] font-semibold text-sub shadow hover:text-ink" title="Back to the newest line">↓ newest</button>
      )}
    </div>
  );
}
