import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ACTIONS, bindingsFor, comboOf, displayCombo, validateBinding, type ActionId } from '../bindings.ts';
import { HINTS_LABEL } from '../hints.ts';
import { cycleHints } from '../keys.ts';
import { flash, get, NO_BINDINGS, set, useStore } from '../store.ts';
import { send } from '../ws.ts';
import { DialogKeys, Overlay } from './Overlay.tsx';
import { Key } from './ui.tsx';

/**
 * B: key hints (the first row: Enter, Space or ← → cycle it), then the rebindable shortcuts:
 * ↑↓ pick, Enter then press the new combo, Backspace resets to default.
 */
/** The settings rows above the shortcuts: key hints, then trusting worktrees. */
const SETTING_ROWS = 2;

export function BindingsDialog() {
  const overrides = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  const hints = useStore((s) => s.settings.keyHints ?? 'always');
  const trust = useStore((s) => s.settings.trustWorktrees === true);
  // Rows 0 and 1 are settings; the actions follow.
  const [index, setIndex] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');
  const rows = ACTIONS.length + SETTING_ROWS;
  const toggleTrust = () => {
    send({ type: 'settings.set', settings: { ...get().settings, trustWorktrees: !trust } });
    flash(trust ? 'New worktrees: Claude Code asks to trust them in the tab' : 'New worktrees: marked trusted before the tab opens');
  };

  function save(id: ActionId, combos: string[] | undefined) {
    const next = { ...overrides };
    if (combos) next[id] = combos;
    else delete next[id];
    send({ type: 'settings.set', settings: { ...get().settings, bindings: next } });
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    e.preventDefault();
    const action = ACTIONS[index - SETTING_ROWS];
    if (capturing && action) {
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
      case 'ArrowDown': setIndex(Math.min(rows - 1, index + 1)); break;
      case 'ArrowUp': setIndex(Math.max(0, index - 1)); break;
      case 'ArrowLeft': case 'ArrowRight': case ' ': if (index === 0) cycleHints(); else if (index === 1) toggleTrust(); break;
      case 'Enter': if (index === 0) cycleHints(); else if (index === 1) toggleTrust(); else { setCapturing(true); setError(''); } break;
      case 'Backspace':
      case 'Delete': if (action) { save(action.id, undefined); flash(`${action.label}: back to default`); } break;
      case 'Escape': set({ modal: { kind: 'help' } }); break;
    }
  }

  return (
    <Overlay label="Keyboard shortcuts" keepKeys>
      {/* Focusable wrapper so every key lands here, including ones the app would otherwise act on. */}
      <div tabIndex={0} autoFocus ref={(el) => el?.focus()} onKeyDown={onKeyDown} className="outline-none">
        <h2 className="mb-1 text-[19px] font-bold tracking-tight">Keys and hints</h2>
        <p className="mb-4 text-sm text-sub">Saved on this computer, for every browser you open Command Center in.</p>
        <ul className="space-y-0.5">
          <li onClick={() => { setIndex(0); cycleHints(); }} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${index === 0 ? 'is-focus bg-raise' : ''}`} title="The keycaps on buttons, chips and headers, and the key bar at the bottom. The keys work whatever you pick; ? always lists them.">
            <span className="grow text-sub">Key hints on the screens</span>
            <span className="font-semibold">{HINTS_LABEL[hints]}</span>
            <span className="text-xs text-faint">always · on hover · off</span>
          </li>
          <li onClick={() => { setIndex(1); toggleTrust(); }} className={`grid gap-0.5 rounded-xl px-3 py-2 text-sm ${index === 1 ? 'is-focus bg-raise' : ''}`}>
            <div className="flex items-center gap-3">
              <span className="grow text-sub">Trust a card’s new worktrees in Claude Code</span>
              <span className="font-semibold">{trust ? 'On' : 'Off'}</span>
              <span className="text-xs text-faint">on · off</span>
            </div>
            <span className="text-xs text-faint">On: before a worktree card’s tab opens, cc-control sets <span className="font-mono">projects["&lt;folder&gt;"].hasTrustDialogAccepted = true</span> for each new folder in <span className="font-mono">~/.claude.json</span>, Claude Code’s own file, so the tab doesn’t stop at “trust this folder?”. Nothing else in that file is touched. Off: answer the prompt in the tab.</span>
          </li>
          {ACTIONS.map((a, i) => {
            const at = i + SETTING_ROWS;
            const custom = Boolean(overrides[a.id]);
            return (
              <li key={a.id} onClick={() => setIndex(at)} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${at === index ? 'is-focus bg-raise' : ''}`}>
                <span className="grow text-sub">{a.label}</span>
                {capturing && at === index
                  ? <span className="pulse font-semibold text-acc">press the new keys…</span>
                  : bindingsFor(a.id, overrides).map((c) => <Key key={c} k={displayCombo(c)} size="sm" />)}
                {custom && !(capturing && at === index) && <span className="rounded bg-acc-soft px-1.5 text-[11px] font-semibold text-acc">yours</span>}
              </li>
            );
          })}
        </ul>
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
        <DialogKeys items={[['↑ ↓', 'choose'], ['Enter', 'change, then press the new keys (on the settings rows: the next value)'], ['Backspace', 'back to default'], ['Esc', 'back']]} />
      </div>
    </Overlay>
  );
}
