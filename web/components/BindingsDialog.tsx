import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ACTIONS, bindingsFor, comboOf, displayCombo, validateBinding, type ActionId } from '../bindings.ts';
import { flash, get, NO_BINDINGS, set, useStore } from '../store.ts';
import { send } from '../ws.ts';
import { DialogKeys, Overlay } from './Overlay.tsx';
import { Key } from './ui.tsx';

/** Rebind global shortcuts: ↑↓ pick, Enter then press the new combo, Backspace resets to default. */
export function BindingsDialog() {
  const overrides = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  const [index, setIndex] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');

  function save(id: ActionId, combos: string[] | undefined) {
    const next = { ...overrides };
    if (combos) next[id] = combos;
    else delete next[id];
    send({ type: 'settings.set', settings: { ...get().settings, bindings: next } });
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    e.preventDefault();
    const action = ACTIONS[index];
    if (capturing) {
      if (e.key === 'Escape') { setCapturing(false); setError(''); return; }
      const combo = comboOf(e.nativeEvent);
      if (!combo) return; // waiting for a non-modifier key
      const problem = validateBinding(action.id, combo, overrides);
      if (problem) { setError(problem); return; }
      save(action.id, [combo]);
      setCapturing(false);
      setError('');
      flash(`${action.label}: ${displayCombo(combo)}`);
      return;
    }
    switch (e.key) {
      case 'ArrowDown': setIndex(Math.min(ACTIONS.length - 1, index + 1)); break;
      case 'ArrowUp': setIndex(Math.max(0, index - 1)); break;
      case 'Enter': setCapturing(true); setError(''); break;
      case 'Backspace':
      case 'Delete': save(action.id, undefined); flash(`${action.label}: back to default`); break;
      case 'Escape': set({ modal: { kind: 'help' } }); break;
    }
  }

  return (
    <Overlay label="Keyboard shortcuts">
      {/* Focusable wrapper so every key lands here, including ones the app would otherwise act on. */}
      <div tabIndex={0} autoFocus ref={(el) => el?.focus()} onKeyDown={onKeyDown} className="outline-none">
        <h2 className="mb-1 text-[19px] font-bold tracking-tight">Change shortcuts</h2>
        <p className="mb-4 text-sm text-sub">Saved on this computer, for every browser you open Command Center in.</p>
        <ul className="space-y-0.5">
          {ACTIONS.map((a, i) => {
            const custom = Boolean(overrides[a.id]);
            return (
              <li key={a.id} onClick={() => setIndex(i)} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${i === index ? 'is-focus bg-raise' : ''}`}>
                <span className="grow text-sub">{a.label}</span>
                {capturing && i === index
                  ? <span className="pulse font-semibold text-acc">press the new keys…</span>
                  : bindingsFor(a.id, overrides).map((c) => <Key key={c} k={displayCombo(c)} size="sm" />)}
                {custom && !(capturing && i === index) && <span className="rounded bg-acc-soft px-1.5 text-[11px] font-semibold text-acc">yours</span>}
              </li>
            );
          })}
        </ul>
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
        <DialogKeys items={[['↑ ↓', 'choose'], ['Enter', 'change, then press the new keys'], ['Backspace', 'back to default'], ['Esc', 'back']]} />
      </div>
    </Overlay>
  );
}
