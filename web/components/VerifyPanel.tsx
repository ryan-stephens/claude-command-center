// The Verify panel (PLAN §105, §107, §132): one sub-section per tool, as tabs under the environment
// row. The tools' addresses and names come from this machine's Verify file; the sections are the
// SECTIONS list (web/verify-model.ts) and one component each. Lookup values stay in this page's
// memory (web/verify-state.ts).

import { useEffect } from 'react';
import type { Card } from '../../shared/cards.ts';
import { ENV_NAME, VERIFY_ENVS } from '../../shared/verify.ts';
import { useStore } from '../store.ts';
import { SECTIONS, sectionName, sectionShown, type VerifySection } from '../verify-model.ts';
import { armProd, cycleEnv, showSection, useVerify, verifyFor } from '../verify-state.ts';
import { Key } from './ui.tsx';
import { VerifyBuilder } from './VerifyBuilder.tsx';
import { VerifyLookup } from './VerifyLookup.tsx';
import { VerifySet } from './VerifySet.tsx';
import { FileNote } from './verify-ui.tsx';

const BODIES: Record<VerifySection, (p: { file?: string }) => React.JSX.Element> = { builder: VerifyBuilder, lookup: VerifyLookup, set: VerifySet };

export function VerifyPanel({ card }: { card: Card }) {
  useEffect(() => { verifyFor(card); }, [card]);
  const v = useVerify();
  const file = useStore((s) => s.verify);
  const config = file?.config ?? {};
  if (v.cardId !== card.id) return null;
  const shown = sectionShown(v.section, config);
  const Body = shown ? BODIES[shown] : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5" role="radiogroup" aria-label="Environment">
        {VERIFY_ENVS.map((e) => (
          <button key={e} role="radio" aria-checked={v.env === e} onClick={() => (e === 'prod' ? armProd() : e !== v.env && cycleEnv())}
            className={`rounded-full border px-2.5 py-0.5 text-[12.5px] font-semibold ${v.env === e ? (e === 'prod' ? 'border-bad bg-bad/10 text-bad' : 'border-acc bg-acc-soft text-acc') : 'border-line text-sub hover:bg-raise'}`}>
            {ENV_NAME[e]}
          </button>
        ))}
        <Key k="e" size="sm" /><Key k="⇧P" size="sm" />
      </div>

      {file?.problem && <FileNote file={file} />}
      {!shown && !file?.problem && <FileNote file={file} />}

      {shown && (
        <div className="flex items-end gap-0.5 overflow-x-auto border-b border-line px-3 pt-2" role="tablist" aria-label="Verify tools">
          {SECTIONS.map((s) => {
            const on = s.id === shown;
            const set = s.configured(config);
            return (
              <button key={s.id} role="tab" aria-selected={on} onClick={() => showSection(s.id)} title={set ? undefined : 'Not set up on this machine'}
                className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg border px-2 py-1 text-[12.5px] font-semibold ${on ? 'border-line border-b-[var(--c-surface)] bg-surface text-ink' : 'border-transparent text-sub hover:text-ink'}`}>
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${set ? 'bg-ok' : 'border border-faint'}`} />
                {sectionName(s.id, config)}
              </button>
            );
          })}
          <span className="grow" />
          <span className="shrink-0 pb-1.5 pl-1"><Key k="Alt ← →" size="sm" /></span>
        </div>
      )}

      {Body && <Body file={file?.file} />}
    </>
  );
}
