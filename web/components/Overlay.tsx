import { useEffect, useRef, type ReactNode } from 'react';
import { set } from '../store.ts';
import { Key } from './ui.tsx';

/** `keepKeys`: its keycaps show whatever the key-hints setting (the dialogs that are about keys). */
export function Overlay({ children, label, wide = false, keepKeys = false }: { children: ReactNode; label: string; wide?: boolean | 'xl'; keepKeys?: boolean }) {
  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-scrim p-3 pt-[8vh] md:p-4 md:pt-[10vh]" role="dialog" aria-modal="true" aria-label={label}>
      <div className={`w-full ${wide === 'xl' ? 'max-w-6xl' : wide ? 'max-w-3xl' : 'max-w-xl'} rounded-2xl border border-line bg-surface p-5 shadow-2xl md:p-6 ${keepKeys ? 'kc-keep' : ''}`}>{children}</div>
    </div>
  );
}

/** Title row with the dismiss key on the right. */
export function DialogTitle({ children, hint = 'Esc' }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <h2 className="min-w-0 grow text-[19px] font-bold leading-snug tracking-tight">{children}</h2>
      <button onClick={close} className="mt-0.5 flex shrink-0 items-center gap-1.5 text-sm text-faint hover:text-ink">Cancel <Key k={hint} size="sm" /></button>
    </div>
  );
}

/** The keys that work in a dialog, as a footer line. */
export function DialogKeys({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-faint">
      {items.map(([k, label]) => <span key={label} className="flex items-center gap-1.5"><Key k={k} size="sm" />{label}</span>)}
    </div>
  );
}

export const close = () => set({ modal: null });

/**
 * Window-level keys for a dialog with no focused input (confirmations, the welcome card).
 * React can mount the dialog and attach this listener while the keypress that *opened* it is
 * still bubbling, so events older than the dialog are ignored; otherwise the Enter that picked
 * "End session" in the palette would also confirm it.
 */
export function useDialogKeys(handler: (e: KeyboardEvent) => boolean): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const openedAt = performance.now();
    const onKey = (e: KeyboardEvent) => {
      if (e.timeStamp < openedAt) return;
      if (ref.current(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
