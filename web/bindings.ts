// Rebindable global shortcuts. Screen-local keys (arrows, Enter, Esc, the numpad board, Y/A/N)
// stay fixed; these are the ones people actually want to move. Overrides persist server-side.

export type ActionId =
  | 'palette' | 'help' | 'nextAttention' | 'prevSession' | 'nextSession'
  | 'newSession' | 'interrupt' | 'background' | 'sound' | 'theme' | 'pushToTalk';

export interface ActionDef {
  id: ActionId;
  label: string;
  defaults: string[];
  /** Fires even while typing in a text field, so its combo needs a modifier. */
  inText: boolean;
}

export const ACTIONS: ActionDef[] = [
  { id: 'palette', label: 'Command palette', defaults: ['Ctrl+K'], inText: true },
  { id: 'help', label: 'Keyboard help', defaults: ['Shift+/'], inText: false },
  { id: 'nextAttention', label: 'Jump to the next session that needs you', defaults: ['Alt+N'], inText: true },
  { id: 'prevSession', label: 'Previous session', defaults: ['Alt+ArrowUp'], inText: true },
  { id: 'nextSession', label: 'Next session', defaults: ['Alt+ArrowDown'], inText: true },
  { id: 'newSession', label: 'New session', defaults: ['Alt+Shift+N'], inText: true },
  { id: 'interrupt', label: 'Interrupt the open session (Esc also works while it is busy)', defaults: ['Ctrl+.'], inText: true },
  { id: 'background', label: 'Send the running tool or subagent to the background', defaults: ['Ctrl+B'], inText: true },
  { id: 'sound', label: 'Sound on / off', defaults: ['M'], inText: false },
  { id: 'theme', label: 'Switch theme (match Windows, light, dark)', defaults: ['Alt+T'], inText: true },
  // Voice follows the numpad rule instead (only while not mid-message), so a plain key is fine.
  { id: 'pushToTalk', label: 'Push-to-talk (hold)', defaults: ['`', 'NumpadDecimal'], inText: false },
];

export type Bindings = Partial<Record<ActionId, string[]>>;

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight']);
const CODE_NAMES: Record<string, string> = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Space: 'Space',
};

/** Layout-independent combo name built from the physical key: "Ctrl+K", "Alt+ArrowUp", "Shift+/", "NumpadDecimal". */
export function comboOf(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3)
    : /^Digit\d$/.test(e.code) ? e.code.slice(5)
    : CODE_NAMES[e.code] ?? e.code;
  return [e.ctrlKey && 'Ctrl', e.metaKey && 'Meta', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+');
}

/** Human form for the UI: "Shift+/" reads as "?", arrows as symbols. */
export function displayCombo(combo: string): string {
  if (combo === 'Shift+/') return '?';
  return combo
    .replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→')
    .replace('NumpadDecimal', 'Numpad .');
}

export function bindingsFor(id: ActionId, overrides: Bindings): string[] {
  return overrides[id] ?? ACTIONS.find((a) => a.id === id)!.defaults;
}

/** Which action (if any) this combo triggers. */
export function actionFor(combo: string, overrides: Bindings): ActionId | null {
  for (const a of ACTIONS) if (bindingsFor(a.id, overrides).includes(combo)) return a.id;
  return null;
}

const hasModifier = (combo: string) => /(^|\+)(Ctrl|Alt|Meta)\+/.test(combo);

// Keys the app itself relies on; rebinding onto them would break navigation.
const RESERVED = new Set([
  'Enter', 'Escape', 'Tab', 'Shift+Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete',
  'Home', 'End', 'PageUp', 'PageDown', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z',
  // Screen keys: home (/ N W E R X + digits, F in the library), session (i T R X + D), approvals (Y A N D),
  // number pad (E [ ] Shift+E Shift+I Ctrl+arrows).
  'Y', 'A', 'N', 'E', 'I', 'R', 'X', 'T', 'W', 'D', 'F', '/', '[', ']', '=', 'Shift+=', 'Shift+E', 'Shift+I',
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(String),
  'Ctrl+ArrowUp', 'Ctrl+ArrowDown', 'Ctrl+ArrowLeft', 'Ctrl+ArrowRight',
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `Alt+${n}`),
]);

/** Returns an error message, or null if `combo` can be bound to `id`. */
export function validateBinding(id: ActionId, combo: string, overrides: Bindings): string | null {
  const action = ACTIONS.find((a) => a.id === id)!;
  if (RESERVED.has(combo) || /^Numpad\d$/.test(combo) || /^Numpad(Add|Subtract|Enter)$/.test(combo)) {
    return `${displayCombo(combo)} is used by the app itself.`;
  }
  if (action.inText && !hasModifier(combo)) {
    return `${action.label} works while typing, so it needs Ctrl, Alt or Meta.`;
  }
  const other = actionFor(combo, overrides);
  if (other && other !== id) return `${displayCombo(combo)} is already bound to "${ACTIONS.find((a) => a.id === other)!.label}".`;
  return null;
}
