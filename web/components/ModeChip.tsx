// A session's permission mode as a chip: what it is, its hint on hover, and a click that switches it
// (Shift+Tab does the same, as in Claude Code). The full-screen session shows it under its box, an
// open card in its chat's header (§129).

import type { PermissionMode } from '../../shared/protocol.ts';
import { MODE_LABEL } from '../questions.ts';
import { Icon } from './ui.tsx';

const MODE_TONE: Record<string, string> = { default: 'bg-raise text-sub', acceptEdits: 'bg-busy-bg text-busy', plan: 'bg-calm-bg text-calm', auto: 'bg-ok-bg text-ok' };

export function ModeChip({ mode, onClick, className = '' }: { mode: PermissionMode; onClick: () => void; className?: string }) {
  const label = MODE_LABEL[mode];
  return (
    <button onClick={onClick} data-mode={mode} title={`${label.name}: ${label.hint}. Shift+Tab switches.`} className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${MODE_TONE[mode] ?? 'bg-raise text-sub'} ${className}`}>
      <Icon name={mode === 'plan' ? 'plan' : mode === 'acceptEdits' ? 'edit' : mode === 'auto' ? 'auto' : 'shield'} size={12} />{label.name}
    </button>
  );
}
