// How a single repo runs, as a form (PLAN §86): what starts it, an install step before it, where
// it serves, what runs on stop. The lines are written from the answers (shared/run-setup.ts) and
// kept as they are when they say more than the answers can. Ctrl+Enter saves, Esc closes.

import { useState } from 'react';
import { recipeFor } from '../../shared/recipes.ts';
import { runFormFrom, runFromForm, stepsFromRun, type RunForm } from '../../shared/run-setup.ts';
import { repoName } from '../../shared/workspaces.ts';
import { flash, useStore } from '../store.ts';
import { saveRecipe } from '../ws.ts';
import { close, DialogKeys, DialogTitle, Overlay, useDialogKeys } from './Overlay.tsx';
import { Key } from './ui.tsx';

const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')); };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-[12.5px]">
      <span className="font-semibold text-sub">{label}{hint && <span className="ml-1.5 font-normal text-faint">{hint}</span>}</span>
      {children}
    </label>
  );
}

export function RunSetup({ repo }: { repo: string }) {
  const recipe = useStore((s) => recipeFor(s.recipes, repo));
  const [form, setForm] = useState<RunForm>(() => runFormFrom(recipe));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = repoName(repo);
  const up = (patch: Partial<RunForm>) => { setForm({ ...form, ...patch }); setError(null); };
  // An answer changed: the lines follow it (and stop being custom).
  const answer = (patch: Partial<Pick<RunForm, 'install' | 'start' | 'stop'>>) => { const next = { ...form, ...patch, custom: false }; up({ ...next, steps: stepsFromRun(next) }); };
  const save = () => {
    if (busy) return;
    let out: { steps: string[]; url?: string };
    try { out = runFromForm(form); } catch (e) { setError((e as Error).message); return; }
    setBusy(true);
    saveRecipe({ repo }, out.steps, out.url).then(() => { close(); flash(`Saved how ${name} runs`); }, (e: Error) => { setError(e.message); setBusy(false); });
  };
  const reset = () => {
    if (busy) return;
    setBusy(true);
    saveRecipe({ repo }, []).then(() => { close(); flash(`${name} runs as detected again`); }, (e: Error) => { setError(e.message); setBusy(false); });
  };
  useDialogKeys((e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { save(); return true; }
    if (typing(e)) { if (e.key === 'Escape') { (e.target as HTMLElement).blur(); return true; } return false; }
    if (e.key === 'Escape') { close(); return true; }
    return false;
  });
  return (
    <Overlay label="How it runs" wide>
      <DialogTitle>How {name} runs</DialogTitle>
      <p className="mb-4 text-[13px] text-sub">What Try it does for a card in {name}: these run in the card’s own folder, and the one that keeps running is the app. {recipe ? `Now: ${recipe.source}.` : 'Nothing in the repo says how it starts, so say it here.'}</p>
      <div className="grid gap-4">
        <Field label="Start" hint="the command that starts the app and keeps running">
          <input type="text" spellCheck={false} autoComplete="off" autoFocus value={form.custom ? '' : form.start} disabled={form.custom} onChange={(e) => answer({ start: e.target.value })} placeholder={form.custom ? 'see the lines below' : 'pnpm dev'} className="field font-mono text-[13px]" aria-label="Start" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Install first" hint="optional; runs before the app, once">
            <input type="text" spellCheck={false} autoComplete="off" value={form.custom ? '' : form.install} disabled={form.custom} onChange={(e) => answer({ install: e.target.value })} placeholder="pnpm install" className="field font-mono text-[13px]" aria-label="Install first" />
          </Field>
          <Field label="When stopped" hint="optional; runs after the app is stopped">
            <input type="text" spellCheck={false} autoComplete="off" value={form.custom ? '' : form.stop} disabled={form.custom} onChange={(e) => answer({ stop: e.target.value })} placeholder="docker compose down" className="field font-mono text-[13px]" aria-label="When stopped" />
          </Field>
        </div>
        <Field label="Where it serves" hint="optional; otherwise read from what it prints">
          <input type="text" spellCheck={false} autoComplete="off" value={form.url} onChange={(e) => up({ url: e.target.value })} placeholder="http://localhost:5173" className="field max-w-sm font-mono text-[13px]" aria-label="Where it serves" />
        </Field>
        <details open={form.custom} className="text-[12.5px]">
          <summary className="cursor-pointer text-faint hover:text-ink">Advanced: the lines{form.custom ? ' (they say more than the answers can, so they are kept as written; change an answer to start over from it)' : ', as the answers write them'}</summary>
          <textarea value={form.steps.join('\n')} onChange={(e) => up({ steps: e.target.value.split('\n'), custom: true })} rows={Math.max(4, form.steps.length + 1)} spellCheck={false}
            className="field mt-1.5 w-full font-mono text-[12px] leading-relaxed" aria-label="The lines" />
          <p className="mt-1.5 text-faint">One command per line. <code>stop: …</code> runs on stop · <code>NAME=value</code> before a command sets a variable for it · <code>wait:port:8080</code>, <code>wait:http:8080/health</code> or <code>wait:"Now listening"</code> says when a step that keeps running is ready · <code>ps:</code> runs it in PowerShell · <code>! …</code> is a step to do by hand.</p>
        </details>
      </div>
      {error && <div className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{error}</div>}
      <div className="mt-5 flex items-center gap-3">
        <span className="grow text-[12.5px] text-faint">{recipe?.edited ? <button className="text-acc underline decoration-dotted underline-offset-2 hover:decoration-solid" onClick={reset}>Back to what the repo says</button> : 'Saved for every card in this repo.'}</span>
        <button className="btn" onClick={close}>Close<Key k="Esc" size="sm" /></button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}<Key k="Ctrl Enter" size="sm" tone="ghost" /></button>
      </div>
      <DialogKeys items={[['Ctrl Enter', 'save'], ['Esc', 'close']]} />
    </Overlay>
  );
}
