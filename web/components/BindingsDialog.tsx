import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ACTIONS, bindingsFor, comboOf, displayCombo, validateBinding, type ActionId } from '../bindings.ts';
import { flash, get, NO_BINDINGS, set, useStore } from '../store.ts';
import { send } from '../ws.ts';
import { Overlay } from './Overlay.tsx';

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
        <h2 className="mb-3 text-base font-medium text-zinc-100">Keyboard shortcuts</h2>
        <table className="w-full text-sm">
          <tbody>
            {ACTIONS.map((a, i) => {
              const custom = Boolean(overrides[a.id]);
              return (
                <tr key={a.id} onClick={() => setIndex(i)} className={i === index ? 'bg-zinc-800' : ''}>
                  <td className="py-1 pl-2 text-zinc-300">{a.label}</td>
                  <td className="py-1 pr-2 text-right">
                    {capturing && i === index
                      ? <span className="animate-pulse text-sky-300">press keys…</span>
                      : bindingsFor(a.id, overrides).map((c) => <kbd key={c} className="ml-1">{displayCombo(c)}</kbd>)}
                    {custom && !(capturing && i === index) && <span className="ml-2 text-[10px] uppercase text-sky-400">custom</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <p className="mt-3 text-xs text-zinc-500">
          <kbd>↑ ↓</kbd> pick · <kbd>Enter</kbd> rebind, then press the new keys · <kbd>Backspace</kbd> reset · <kbd>Esc</kbd> back.
          Saved on this machine for every browser.
        </p>
      </div>
    </Overlay>
  );
}
