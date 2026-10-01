import { useEffect, useState } from 'react';
import { cardRepos } from '../../shared/cards.ts';
import { cardRecipe, recipeFor } from '../../shared/recipes.ts';
import { choiceLabel, needsUiPort, type Stack, type StackApiRow } from '../../shared/stack.ts';
import type { Finding } from '../../shared/stack-detect.ts';
import { repoName } from '../../shared/workspaces.ts';
import { listStep } from '../list-step.ts';
import { lastPick, tryStack } from '../line-keys.ts';
import { flash, set, useStore } from '../store.ts';
import { detectStack, saveStack, stackPlan, tryCard } from '../ws.ts';
import { Findings } from './Dialogs.tsx';
import { close, DialogKeys, DialogTitle, Overlay, useDialogKeys } from './Overlay.tsx';
import { Key } from './ui.tsx';

/**
 * t on a card whose workspace has a stack: what to choose (dev or uat), then which APIs to run on
 * their dev environment. APIs changed on the card's branch start ticked; the rest are served by the
 * shared environment through the UI's usual proxy rules. With no stack yet (`detect`), it first
 * shows what the workspace's repos say the stack is: Enter keeps that as the stack, e edits it first.
 */
export function TryPick({ id, detect = false }: { id: string; detect?: boolean }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id));
  const stack = useStore((s) => (card ? cardRecipe(s.recipes, card.workspaceId, cardRepos(card)[0])?.stack : undefined));
  // The home repo's own recipe: what Enter runs when the repos give no stack.
  const homeRecipe = useStore((s) => (card ? recipeFor(s.recipes, cardRepos(card)[0]) : undefined));
  const [rows, setRows] = useState<StackApiRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Detect mode: what was found, until it is kept (then the stack arrives with the recipes and the picker takes over).
  const [found, setFound] = useState<{ findings: Finding[]; stack?: Stack } | null>(null);
  const [keeping, setKeeping] = useState(false);
  const detecting = detect && !stack;
  const choose = Object.entries(stack?.choose ?? {});
  const [values, setValues] = useState<Record<string, string>>({});
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [at, setAt] = useState(0);

  useEffect(() => {
    if (!detecting || !card?.workspaceId) return;
    let on = true;
    detectStack(card.workspaceId).then((d) => { if (on) setFound({ findings: d.findings, ...(d.stack ? { stack: d.stack } : {}) }); }, (e: Error) => { if (on) setError(e.message); });
    return () => { on = false; };
  }, [detecting, card?.workspaceId]);

  useEffect(() => {
    if (!stack) return;
    const last = lastPick(id)?.values ?? {};
    setValues(Object.fromEntries(Object.entries(stack.choose).map(([k, vals]) => [k, vals.includes(last[k]) ? last[k] : vals[0]])));
    stackPlan(id).then((p) => {
      setRows(p.rows);
      const l = lastPick(id);
      const have = new Set(p.rows.filter((r) => r.found).map((r) => r.repo));
      setTicked(new Set((l ? l.apis : p.suggested).filter((r) => have.has(r))));
    }, (e: Error) => setError(e.message));
  }, [id, stack]);

  // Rows you can move through: each question, then each API.
  const total = choose.length + (rows?.length ?? 0);
  const cycle = (k: string, delta: number) => {
    const vals = stack?.choose[k] ?? [];
    setValues((v) => ({ ...v, [k]: vals[(vals.indexOf(v[k]) + delta + vals.length) % vals.length] }));
  };
  const toggle = (repo: string) => {
    if (!rows?.find((r) => r.repo === repo)?.found) return;
    setTicked((t) => { const n = new Set(t); if (n.has(repo)) n.delete(repo); else n.add(repo); return n; });
  };
  const start = () => {
    if (!rows) return;
    tryStack(id, { values, apis: rows.filter((r) => ticked.has(r.repo)).map((r) => r.repo) });
  };
  /** Detect mode's Enter: keep what was found as the workspace's stack (the recipes update brings the picker); nothing found, run the home repo's own recipe. */
  const keep = () => {
    if (!card?.workspaceId || keeping) return;
    if (!found?.stack) {
      if (!homeRecipe) return;
      close();
      tryCard(id).then(() => flash(`Running ${repoName(cardRepos(card)[0])}’s own recipe`), (e: Error) => flash(e.message));
      return;
    }
    setKeeping(true);
    saveStack(card.workspaceId, found.stack).then(() => flash('Kept as the workspace’s stack · e changes it'), (e: Error) => { setError(e.message); setKeeping(false); });
  };
  const edit = () => {
    if (!card) return;
    set({ modal: { kind: 'recipe', repo: cardRepos(card)[0], ...(card.workspaceId ? { workspaceId: card.workspaceId } : {}), scope: 'table' } });
  };

  useDialogKeys((e) => {
    if (detecting) {
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter') keep();
      else if (e.key === 'e') edit();
      else return false;
      return true;
    }
    const onChoice = at < choose.length;
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter') start();
    else if (e.key === 'ArrowDown') setAt((i) => Math.min(Math.max(0, total - 1), i + listStep(e)));
    else if (e.key === 'ArrowUp') setAt((i) => Math.max(0, i - listStep(e)));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const k = choose[onChoice ? at : 0]?.[0]; if (k) cycle(k, e.key === 'ArrowRight' ? 1 : -1); }
    else if (e.key === ' ') { if (onChoice) cycle(choose[at][0], 1); else { const r = rows?.[at - choose.length]; if (r) toggle(r.repo); } }
    else if (e.key === 'a') setTicked(new Set(rows?.filter((r) => r.found).map((r) => r.repo) ?? []));
    else if (e.key === 'n') setTicked(new Set());
    else return false;
    return true;
  });

  if (!card) return null;
  if (detecting) {
    return (
      <Overlay label="Try it" wide>
        <DialogTitle>Try it · {card.key}</DialogTitle>
        <p className="mb-3 text-sm text-sub">This workspace has no stack yet, so here is what its repos say: how each API starts, the port it listens on, when it is ready, how the UI serves and which proxy rule reaches each API.</p>
        {error && <div className="mb-3 rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{error}</div>}
        {!found && !error && <p className="flex items-center gap-2 text-sm text-faint"><span className="spinner" />Reading the repos…</p>}
        {found && <Findings findings={found.findings} />}
        {found && !found.stack && <p className="text-sm text-sub">Nothing to make a stack from. <Key k="e" size="sm" inline /> opens the stack editor with a draft to fill in{homeRecipe ? <>; <Key k="Enter" size="sm" inline /> runs {repoName(cardRepos(card)[0])}’s own recipe instead ({homeRecipe.source})</> : ''}.</p>}
        {found?.stack && <p className="text-sm text-sub"><Key k="Enter" size="sm" inline /> keeps this as {card.key}’s workspace stack and goes on to pick the environment and the APIs; the <span className="text-attn">?</span> lines are assumptions to check in the editor (<Key k="e" size="sm" inline />) when they are wrong.</p>}
        <DialogKeys items={[...(found?.stack ? [['Enter', keeping ? 'keeping…' : 'keep it and go on'] as [string, string]] : found && homeRecipe ? [['Enter', `run ${repoName(cardRepos(card)[0])}’s recipe`] as [string, string]] : []), ['e', 'edit it first'] as [string, string], ['Esc', 'cancel'] as [string, string]]} />
      </Overlay>
    );
  }
  if (!stack) return null;
  const picked = rows?.filter((r) => ticked.has(r.repo)).map((r) => r.repo) ?? [];
  return (
    <Overlay label="Try it">
      <DialogTitle>Try it · {card.key}</DialogTitle>
      {choose.map(([k, vals], i) => (
        <div key={k} onMouseEnter={() => setAt(i)} className={`mb-2 flex items-center gap-2 rounded-xl px-2.5 py-2 ${at === i ? 'is-focus bg-raise' : ''}`}>
          <span className="eyebrow w-28 shrink-0">{k}</span>
          <div className="flex grow flex-wrap gap-1.5" role="radiogroup" aria-label={k}>
            {vals.map((v) => (
              <button key={v} role="radio" aria-checked={values[k] === v} onClick={() => setValues((x) => ({ ...x, [k]: v }))}
                className={`rounded-lg border px-2.5 py-1 font-mono text-[13px] ${values[k] === v ? 'border-ring bg-surface font-semibold text-ink shadow-[0_0_0_2px_color-mix(in_srgb,var(--c-ring)_22%,transparent)]' : 'border-line bg-raise text-sub'}`}>
                {v}{v === vals[0] ? <span className="ml-1 font-sans text-[11px] text-faint">default</span> : null}
              </button>
            ))}
          </div>
          <Key k="← →" size="sm" />
        </div>
      ))}
      <div className="eyebrow mb-1.5 mt-3">APIs to run{stack.apis.length ? '' : ': none set up in the stack'}</div>
      {error && <div className="rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{error}</div>}
      {rows && rows.length > 0 && rows.every((r) => !r.found) && (
        <div className="mb-2 rounded-lg bg-attn-bg px-3 py-2 text-[13px] text-attn" role="alert">
          None of this stack’s APIs ({rows.map((r) => r.repo).join(', ')}) is a repo in this card or its workspace{rows.some((r) => /orders-api/.test(r.repo)) ? ': the stack is still the example' : ''}. <Key k="Esc" size="sm" /> then <Key k="e" size="sm" /> and the stack tab (<Key k="Alt W" size="sm" />) to put in your own APIs.
        </div>
      )}
      {!rows && !error && <p className="flex items-center gap-2 text-sm text-faint"><span className="spinner" />Looking at what changed on this card’s branch…</p>}
      {rows && (
        <ul className="space-y-1" role="listbox" aria-label="APIs to run" aria-multiselectable="true">
          {rows.map((r, j) => {
            const i = choose.length + j;
            return (
              <li key={r.repo} role="option" aria-selected={ticked.has(r.repo)} aria-disabled={!r.found} onClick={() => { setAt(i); toggle(r.repo); }} onMouseEnter={() => setAt(i)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 ${at === i ? 'is-focus bg-raise' : 'hover:bg-raise/60'} ${r.found ? '' : 'opacity-55'}`}>
                <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[11px] font-bold ${ticked.has(r.repo) ? 'border-ring bg-ring text-bg' : 'border-line'}`}>{ticked.has(r.repo) ? '✓' : ''}</span>
                <span className="grow truncate font-mono text-[13.5px] font-semibold">{r.repo}</span>
                <span className={`shrink-0 text-[12.5px] ${r.changed ? 'font-semibold text-attn' : r.named ? 'text-busy' : 'text-faint'}`}>{r.why}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[13px] text-sub">
        {rows ? <>Starts <b>{choiceLabel(values, picked)}</b>{stack.ui ? `, then ${stack.ui.repo}${stack.ui.proxyFile ? ' with its proxy pointed at them' : ''}` : ''}. APIs left unticked are served by the shared environment. Each API{needsUiPort(stack) ? ' and the UI' : ''} gets a local port of its own for this run, so another card can run the same stack at the same time.</> : null}
      </p>
      <DialogKeys items={[['← →', choose[0]?.[0] ?? 'Choose'], ['↑ ↓', 'Move'], ['Space', 'Tick'], ['a / n', 'All / none'], ['Enter', 'Start'], ['Esc', 'Cancel']]} />
    </Overlay>
  );
}
