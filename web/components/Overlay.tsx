import type { ReactNode } from 'react';
import { set } from '../store.ts';

export function Overlay({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="fixed inset-0 z-10 flex items-start justify-center bg-black/60 p-4 pt-[12vh]" role="dialog" aria-label={label}>
      <div className="w-full max-w-xl rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">{children}</div>
    </div>
  );
}

export const close = () => set({ modal: null });
