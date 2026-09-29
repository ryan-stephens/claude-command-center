import { bindingsFor, displayCombo, type ActionId } from '../bindings.ts';
import { NO_BINDINGS, set, useStore } from '../store.ts';
import { Overlay, useDialogKeys } from './Overlay.tsx';

const SEEN_KEY = 'cc-control.welcomed';

/** Show the welcome card once per browser. localStorage may be unavailable; then it just shows again. */
export function maybeShowWelcome(): void {
  try {
    if (localStorage.getItem(SEEN_KEY)) return;
  } catch { /* show it */ }
  set({ modal: { kind: 'welcome' } });
}

function dismiss(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
  set({ modal: null });
}

/** The five things worth knowing, with the user's current bindings. */
export function Welcome() {
  const bindings = useStore((s) => s.settings.bindings ?? NO_BINDINGS);
  const k = (id: ActionId) => displayCombo(bindingsFor(id, bindings)[0] ?? '');

  useDialogKeys((e) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return false;
    dismiss();
    return true;
  });

  const tips: [string, string, string][] = [
    ['↑ ↓  Enter', 'Pick a session and open it', 'Every Claude Code session on this machine is listed, and live ones show their status.'],
    ['N', 'Start a new session', 'Pick a repo, optionally give it a first prompt.'],
    ['Numpad 1–9', 'Fire a saved command', 'The board beside each session is a hotbar. Press E on a tile to make it yours.'],
    [`Hold ${k('pushToTalk')}`, 'Talk to the session', 'Release to send. Say a command’s name to run it.'],
    [k('nextAttention'), 'Jump to whatever needs you', 'Approvals first (answer with Y / A / N), then finished turns.'],
  ];

  return (
    <Overlay label="Welcome to cc-control">
      <h2 className="text-lg font-semibold text-zinc-100">Welcome to cc-control</h2>
      <p className="mb-4 text-sm text-zinc-400">A keyboard-first command center for your Claude Code sessions.</p>
      <ul className="space-y-3">
        {tips.map(([key, title, body]) => (
          <li key={title} className="grid grid-cols-[7.5rem_1fr] items-baseline gap-3">
            <kbd className="justify-self-start">{key}</kbd>
            <div>
              <div className="text-sm text-zinc-100">{title}</div>
              <div className="text-xs text-zinc-500">{body}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-zinc-500">
        <kbd>{k('palette')}</kbd> searches everything · <kbd>{k('help')}</kbd> lists every key · <kbd>Enter</kbd> to start
      </p>
    </Overlay>
  );
}
