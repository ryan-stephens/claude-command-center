import { useEffect, useRef, type ReactNode } from 'react';
import { set } from '../store.ts';

export function Overlay({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="fixed inset-0 z-10 flex items-start justify-center bg-black/60 p-4 pt-[12vh]" role="dialog" aria-label={label}>
      <div className="w-full max-w-xl rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">{children}</div>
    </div>
  );
}

export const close = () => set({ modal: null });

/**
 * Window-level keys for a dialog with no focused input (confirmations, the welcome card).
 * React can mount the dialog and attach this listener while the keypress that *opened* it is
 * still bubbling, so events older than the dialog are ignored; otherwise the Enter that picked
 * "Stop session" in the palette would also confirm the stop.
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
