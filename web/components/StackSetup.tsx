// Set up the lane's stack as a form (PLAN §83, §86): the environments, the UI, the APIs to tick
// with their names and routes, and how an API starts on the dev environment as three plain
// answers from which the step lines are written (shared/stack-setup.ts). Ports, folders, health
// paths, the proxy rule and the lines themselves sit behind Advanced. Read top to bottom;
// Ctrl+Enter saves (and starts the card it was opened for), Esc closes. What the repos say fills
// the form in when the lane has no stack yet.

import { useEffect, useState } from 'react';
import { apiStepsFrom, formFromStack, stackFromForm, type SetupApi, type SetupForm } from '../../shared/stack-setup.ts';
import { wsRecipeKey } from '../../shared/recipes.ts';
import type { Stack } from '../../shared/stack.ts';
import { repoName } from '../../shared/workspaces.ts';
import { tryIt } from '../line-keys.ts';
import { flash, useStore } from '../store.ts';
import { detectStack, saveStack } from '../ws.ts';
import { close, DialogKeys, DialogTitle, Overlay, useDialogKeys } from './Overlay.tsx';
import { Key } from './ui.tsx';

const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')); };

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`grid gap-1 text-[12.5px] ${wide ? 'col-span-full' : ''}`}>
      <span className="font-semibold text-sub">{label}{hint && <span className="ml-1.5 font-normal text-faint">{hint}</span>}</span>
      {children}
    </label>
  );
}

const Text = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input type="text" spellCheck={false} autoComplete="off" {...p} className={`field py-1.5 text-[13px] ${p.className ?? ''}`} />;

/** `then`: the card to start once the stack is saved (t on a lane with no stack yet). */
export function StackSetup({ workspaceId, then }: { workspaceId: string; then?: string }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const saved = useStore((s) => s.recipes[wsRecipeKey(workspaceId)]?.stack);
  const [form, setForm] = useState<SetupForm | null>(null);
  const [detected, setDetected] = useState<Stack | undefined>(undefined);
  const [kube, setKube] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const repos = (ws?.repos ?? []).map(repoName);
  // The repos are read once: what they say fills a lane with no stack, and marks drift for one that has.
  useEffect(() => {
    let on = true;
    detectStack(workspaceId).then((d) => { if (on) { setDetected(d.stack); setKube(d.kubeconfigs ?? []); } }, () => { /* the form still opens */ }).finally(() => { if (on) setForm((f) => f ?? formFromStack(saved, undefined, repos)); });
    return () => { on = false; };
  }, [workspaceId]);
  useEffect(() => { if (detected && !form) setForm(formFromStack(saved, detected, repos)); }, [detected]);
  const save = () => {
    if (!form || busy) return;
    let stack: Stack;
    try { stack = stackFromForm(form); } catch (e) { setError((e as Error).message); return; }
    setBusy(true);
    // The stack reaches the page before the ok (the server sends it first), so t finds it.
    saveStack(workspaceId, stack).then(() => { close(); flash(`Saved ${ws?.name ?? 'the lane'}’s stack`); if (then) tryIt(then); }, (e: Error) => { setError(e.message); setBusy(false); });
  };
  useDialogKeys((e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { save(); return true; }
    if (typing(e)) { if (e.key === 'Escape') { (e.target as HTMLElement).blur(); return true; } return false; }
    if (e.key === 'Escape') { close(); return true; }
    if (e.key === 'a') { setAdvanced((v) => !v); return true; }
    return false;
  });
  if (!form) return <Overlay label="Set up the stack" wide><DialogTitle>Set up the stack</DialogTitle><p className="flex items-center gap-2 text-sm text-faint"><span className="spinner" />Reading the repos…</p></Overlay>;
  const up = (patch: Partial<SetupForm>) => { setForm({ ...form, ...patch }); setError(null); };
  const api = (i: number, patch: Partial<SetupApi>) => up({ apis: form.apis.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  // An answer changed: the lines are written afresh; lines that were open (hand-edited) stay in view so the change can be seen.
  const knob = (patch: Partial<SetupForm['knobs']>) => { if (form.custom) setAdvanced(true); up({ knobs: { ...form.knobs, ...patch }, custom: false, steps: apiStepsFrom({ ...form.knobs, ...patch }) }); };
  const uiRepos = repos.filter((r) => !form.apis.some((a) => a.on && a.repo === r));
  const envUpper = form.envs.map((e) => e.trim().toUpperCase()).filter(Boolean);
  const missing = form.knobs.kubeconfig ? envUpper.filter((e) => !kube.includes(`KUBECONFIG_${e}`)) : [];
  const cols = advanced ? 'grid-cols-[1.5rem_1.2fr_1fr_1fr_5rem_1fr_1fr]' : 'grid-cols-[1.5rem_1.2fr_1fr_1fr]';
  return (
    <Overlay label="Set up the stack" wide="xl">
      <DialogTitle>Set up {ws?.name ?? 'the lane'}’s stack</DialogTitle>
      <p className="mb-4 text-[13px] text-sub">{then && !saved ? <b className="text-ink">This lane has no stack yet. </b> : null}What Try it starts for a card in this lane: the APIs you tick, each on its own dev environment and a local port of its own, and the UI pointed at them through a copy of its proxy file. Two cards can run the same stack at once. What the repos say is filled in already.</p>
      <div className="grid max-h-[calc(100vh-17rem)] gap-5 overflow-y-auto pr-1">
        <section className="grid gap-2">
          <div className="eyebrow">Environments</div>
          <Field label="What Try it offers, the first the default" hint="comma-separated">
            <Text value={form.envs.join(', ')} onChange={(e) => up({ envs: e.target.value.split(',').map((x) => x.trim()) })} className="max-w-sm" />
          </Field>
        </section>

        <section className="grid gap-2">
          <div className="eyebrow">The UI</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Repo">
              <select className="field py-1.5 text-[13px]" value={form.ui?.repo ?? ''} onChange={(e) => up({ ui: e.target.value ? { repo: e.target.value, proxyFile: form.ui?.proxyFile ?? 'proxy.conf.json', start: form.ui?.start ?? 'npm start -- --proxy-config {{proxy}} --port {{uiPort}}', url: form.ui?.url ?? 'http://localhost:{{uiPort}}', path: form.ui?.path ?? '' } : undefined })}>
                <option value="">No UI: the APIs only</option>
                {uiRepos.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            {form.ui && <>
              <Field label="Proxy file, inside the repo" hint="a copy of it is pointed at the APIs that run; empty: none">
                <Text value={form.ui.proxyFile} onChange={(e) => up({ ui: { ...form.ui!, proxyFile: e.target.value } })} />
              </Field>
              {advanced && <>
                <Field label="How it starts" hint="{{proxy}} is the proxy copy, {{uiPort}} the port picked for the run" wide>
                  <Text value={form.ui.start} onChange={(e) => up({ ui: { ...form.ui!, start: e.target.value } })} className="font-mono" />
                </Field>
                <Field label="Where it serves" hint="empty: the port in its start line, or the app’s own">
                  <Text value={form.ui.url} onChange={(e) => up({ ui: { ...form.ui!, url: e.target.value } })} className="font-mono" />
                </Field>
                <Field label="The app’s path" hint="after the port, like /summary/; empty: its baseHref">
                  <Text value={form.ui.path} onChange={(e) => up({ ui: { ...form.ui!, path: e.target.value } })} className="font-mono" />
                </Field>
              </>}
            </>}
          </div>
        </section>

        <section className="grid gap-2">
          <div className="eyebrow">The APIs</div>
          {form.apis.length === 0 && <p className="text-[13px] text-faint">No other repos in this lane. Add the API repos to the lane first (+ on the board), and they appear here to tick.</p>}
          {form.apis.length > 0 && <p className="text-[12.5px] text-faint">Tick the ones Try it can start. Each gets a port of its own per run; its name and route come from its repo.</p>}
          <div className="grid gap-1.5">
            <div className={`grid ${cols} gap-2 px-1 text-[11.5px] font-semibold text-faint`}><span /><span>repo</span><span>name on the dev environment</span><span>route in the proxy</span>{advanced && <><span>container port</span><span>project folder</span><span>ready when this answers</span></>}</div>
            {form.apis.map((a, i) => (
              <div key={a.repo} className={`grid ${cols} items-center gap-2 rounded-lg px-1 py-1 ${a.on ? '' : 'opacity-60'}`}>
                <input type="checkbox" checked={a.on} aria-label={`${a.repo} is part of the stack`} onChange={(e) => api(i, { on: e.target.checked })} className="h-4 w-4 accent-[var(--c-acc)]" />
                <span className="truncate font-mono text-[13px] font-semibold" title={a.repo}>{a.repo}</span>
                <Text aria-label={`${a.repo}: name`} value={a.name} onChange={(e) => api(i, { name: e.target.value })} disabled={!a.on} className="font-mono" />
                <Text aria-label={`${a.repo}: route`} value={a.route} onChange={(e) => api(i, { route: e.target.value })} disabled={!a.on} className="font-mono" />
                {advanced && <>
                  <Text aria-label={`${a.repo}: container port`} value={a.appPort} onChange={(e) => api(i, { appPort: e.target.value })} disabled={!a.on} className="font-mono" />
                  <Text aria-label={`${a.repo}: project folder`} value={a.dir} onChange={(e) => api(i, { dir: e.target.value })} disabled={!a.on} placeholder="src/LoansApi" className="font-mono" />
                  <Text aria-label={`${a.repo}: health path`} value={a.health} onChange={(e) => api(i, { health: e.target.value })} disabled={!a.on} placeholder="/self" className="font-mono" />
                </>}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-2">
          <div className="eyebrow">Starting an API on the dev environment</div>
          <p className="text-[12.5px] text-faint">The same for every API: the lines are written from these answers.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Before okteto up, the command that makes the API’s deployment for the branch" hint="PowerShell; empty: nothing runs first" wide>
              <Text value={form.knobs.deploy} onChange={(e) => knob({ deploy: e.target.value })} placeholder="New-DevDeployment -Name {{name}} -Environment {{env}}" className="font-mono" />
            </Field>
            <Field label="What it asks, answered in order" hint='comma-separated, like "y,n"; empty: it asks nothing'>
              <Text value={form.knobs.answers} onChange={(e) => knob({ answers: e.target.value })} className="font-mono max-w-xs" />
            </Field>
            <Field label="Inside the container, what runs the API" hint="empty: okteto up alone starts it">
              <Text value={form.knobs.run} onChange={(e) => knob({ run: e.target.value })} className="font-mono" />
            </Field>
            <label className="flex items-start gap-2 text-[12.5px]">
              <input type="checkbox" checked={form.knobs.kubeconfig} onChange={(e) => knob({ kubeconfig: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[var(--c-acc)]" />
              <span><span className="font-semibold text-sub">A kubeconfig per environment</span><br /><span className="text-faint">Every command runs with KUBECONFIG=%KUBECONFIG_ENV%, from <span className="font-mono">~/.cc-control/config.env</span>: </span>
                {form.knobs.kubeconfig && (missing.length
                  ? <span className="text-attn">not set yet: {missing.map((e) => `KUBECONFIG_${e}`).join(', ')}. Add a line per environment there (restart the server after).</span>
                  : <span className="text-ok">{envUpper.map((e) => `KUBECONFIG_${e}`).join(', ')} are set.</span>)}
              </span>
            </label>
            <Field label="On stop, also delete the deployment from this namespace" hint="empty: okteto down alone">
              <Text value={form.knobs.teardown} onChange={(e) => knob({ teardown: e.target.value })} placeholder="team-{{env}}" className="font-mono max-w-xs" />
            </Field>
          </div>
        </section>

        <section className="grid gap-2">
          <button type="button" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced} className="flex w-fit items-center gap-2 text-[12.5px] text-sub hover:text-ink">
            <span className={`inline-block transition-transform ${advanced ? 'rotate-90' : ''}`}>▸</span><span className="font-semibold">Advanced</span><Key k="a" size="sm" /><span className="text-faint">ports, folders, health paths, the UI’s start line, the proxy rule, the lines themselves</span>
          </button>
          {(advanced || form.custom) && <>
            <p className="text-[12.5px] text-faint">In the answers and lines, {'{{name}}'}, {'{{env}}'}, {'{{dir}}'}, {'{{port}}'} (the local port picked for the run), {'{{appPort}}'} and {'{{deployment}}'} ({'{{name}}'}-{'{{branch}}'}) fill in from each API and the environment picked.</p>
            <details open={form.custom} className="text-[12.5px]">
              <summary className="cursor-pointer text-faint hover:text-ink">The lines{form.custom ? ' (edited by hand: the answers above don’t change them until one is changed)' : ', as the answers write them'}</summary>
              <textarea value={form.steps.join('\n')} onChange={(e) => up({ steps: e.target.value.split('\n'), custom: true })} rows={Math.max(4, form.steps.length + 1)} spellCheck={false}
                className="field mt-1.5 font-mono text-[12px] leading-relaxed" aria-label="The step lines" />
            </details>
            <details className="text-[12.5px]">
              <summary className="cursor-pointer text-faint hover:text-ink">The proxy rule each API adds (JSON; {'{{route}}'} and {'{{port}}'} fill in)</summary>
              <textarea value={form.proxyRule} onChange={(e) => up({ proxyRule: e.target.value })} rows={6} spellCheck={false} className="field mt-1.5 font-mono text-[12px] leading-relaxed" aria-label="The proxy rule" />
            </details>
          </>}
        </section>
      </div>
      {error && <div className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{error}</div>}
      <div className="mt-4 flex items-center gap-3">
        <span className="grow text-[12.5px] text-faint">The stack is the lane’s: every card in it starts this way. Nothing here holds a secret; tokens and kubeconfigs stay in config.env.</span>
        <button className="btn" onClick={close}>Close<Key k="Esc" size="sm" /></button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : then ? 'Save and start' : 'Save'}<Key k="Ctrl Enter" size="sm" tone="ghost" /></button>
      </div>
      <DialogKeys items={[['Ctrl Enter', then ? 'save and start' : 'save'], ['a', 'advanced'], ['Esc', 'close']]} />
    </Overlay>
  );
}
