import type { ReactNode } from 'react';
import { bindingsFor, displayCombo, type ActionId } from '../bindings.ts';
import { get, NO_BINDINGS, set, useStore } from '../store.ts';
import { Overlay, useDialogKeys } from './Overlay.tsx';
import { Key } from './ui.tsx';

// v2: the cockpit redesign changed the keys, so everyone sees the tour once more.
const SEEN_KEY = 'cc-control.welcomed.v2';

/** Show the welcome card once per browser. localStorage may be unavailable; then it just shows again. */
export function maybeShowWelcome(): void {
  try {
    if (localStorage.getItem(SEEN_KEY)) return;
  } catch { /* show it */ }
  set({ modal: { kind: 'welcome' } });
}

function dismiss(setup: boolean): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
  // Straight into making the first workspace, so the first real screen isn't empty.
  set({ modal: setup && !get().workspaces.length ? { kind: 'workspace', id: null } : null });
}

/** The four groups of keys that run the app, drawn as physical key clusters. */
export function Welcome() {
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  const hasWorkspaces = useStore((s) => s.workspaces.length > 0);
  const k = (id: ActionId) => displayCombo(bindingsFor(id, bindings)[0] ?? '');

  useDialogKeys((e) => {
    if (e.key === 'Enter') dismiss(true);
    else if (e.key === 'Escape') dismiss(false);
    else return false;
    return true;
  });

  return (
    <Overlay label="Welcome to Command Center" wide keepKeys>
      <div className="text-center">
        <h2 className="text-[26px] font-bold tracking-tight">Your keyboard runs Claude Code</h2>
        <p className="mx-auto mt-1.5 max-w-xl text-sub">Everything works with the mouse too, but these keys get you through the day. The ones that work right now are always shown along the bottom of the screen.</p>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cluster title="Move around" body={<>Left and right between columns, up and down to choose. <Key k="Enter" size="sm" /> opens.</>}>
          <div className="grid grid-cols-3 gap-1.5"><span /><Key k="↑" size="lg" /><span /><Key k="←" size="lg" /><Key k="↓" size="lg" /><Key k="→" size="lg" /></div>
        </Cluster>
        <Cluster title="Start work" body={<><Key k="n" size="sm" /> on a ticket (or <Key k="c" size="sm" /> for a card) builds its context and starts Claude on it, right in the card. The card moves by itself; <Key k="t" size="sm" /> tries the change, <Key k="s" size="sm" /> ships it.</>}>
          <div className="flex gap-1.5"><Key k="n" size="lg" tone="acc" /><Key k="c" size="lg" /><Key k="t" size="lg" /><Key k="s" size="lg" /></div>
        </Cluster>
        <Cluster title="Answer Claude" body={<>Yes, always, or no, when Claude asks to do something. <Key k={k('nextAttention')} size="sm" /> finds the next question.</>}>
          <div className="flex gap-1.5"><Key k="Y" size="lg" tone="attn" /><Key k="A" size="lg" tone="attn" /><Key k="N" size="lg" tone="attn" /></div>
        </Cluster>
        <Cluster title="Stop · talk" body={<><Key k="Esc" size="sm" /> stops Claude right away. Hold <Key k={k('pushToTalk')} size="sm" /> and speak instead of typing.</>}>
          <div className="flex gap-1.5"><Key k="Esc" size="lg" tone="bad" /><Key k={k('pushToTalk')} size="lg" /></div>
        </Cluster>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button className="btn btn-primary px-5" onClick={() => dismiss(true)}>{hasWorkspaces ? 'Let’s go' : 'Set up my first lane'}<Key k="Enter" size="sm" tone="ghost" /></button>
        <button className="btn btn-ghost" onClick={() => dismiss(false)}>Skip<Key k="Esc" size="sm" /></button>
      </div>
      <p className="mt-4 text-center text-sm text-faint"><Key k={k('help')} size="sm" /> lists every key · <Key k={k('palette')} size="sm" /> searches everything</p>
    </Overlay>
  );
}

function Cluster({ title, body, children }: { title: string; body: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-raise/50 p-4 text-center">
      <div className="flex h-[100px] items-center">{children}</div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="mt-1 text-sm leading-relaxed text-sub">{body}</div>
      </div>
    </div>
  );
}
