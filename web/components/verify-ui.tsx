// Pieces the Verify panel's sections share (PLAN §132): a titled block, the small button style, and
// the note that says where the machine's Verify file goes.

import type { ReactNode } from 'react';
import type { VerifyFile } from '../../shared/verify.ts';

export function Sec({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2.5 border-b border-line px-4 py-3.5">
      <div className="flex items-center gap-2"><h4 className="grow text-[13px] font-bold">{title}</h4>{right}</div>
      {children}
    </section>
  );
}

export const small = 'flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12.5px] text-sub hover:bg-raise hover:text-ink disabled:opacity-50';
export const primary = 'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-acc/60 bg-acc-soft px-2.5 py-1 text-[12.5px] font-semibold text-acc disabled:opacity-50';

/** No addresses yet, or a file that can't be read: where the file is and what goes in it (never the repo). */
export function FileNote({ file }: { file: VerifyFile | null }) {
  return (
    <Sec title="Where the tools are">
      {file?.problem
        ? <p role="alert" className="text-[13px] text-bad">{file.problem}</p>
        : <p className="text-[13px] text-sub">Verify reads where the team’s tools are, and what they’re called, from a file on this machine: <span className="font-mono">{file?.file ?? '~/.cc-control/verify.json'}</span>. It isn’t there yet. README’s Verify row shows what goes in it; a change to it shows here at once, no restart.</p>}
    </Sec>
  );
}

/** A section this machine's file doesn't set up yet: which key to add. */
export function NotSetUp({ name, keys, file }: { name: string; keys: string; file?: string }) {
  return <p className="text-[13px] text-sub">{name} isn’t set up on this machine: add <span className="font-mono">{keys}</span> to <span className="font-mono">{file ?? '~/.cc-control/verify.json'}</span> (README’s Verify row has the shape). It shows here at once.</p>;
}
