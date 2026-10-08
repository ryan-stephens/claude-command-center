// The ↓ over a chat you have scrolled up in (PLAN §130): how many of Claude's messages came since,
// and a click or End to go to the newest and follow it again.

import { Key } from './ui.tsx';

export function JumpDown({ fresh, writing, onClick }: { fresh: number; writing: boolean; onClick: () => void }) {
  return (
    <button
      data-jump
      onClick={onClick}
      title="To the newest message, following it again (End)"
      className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface py-1 pl-3 pr-1.5 text-[13px] font-semibold shadow-lg hover:bg-raise"
    >
      <span aria-hidden className="text-acc">↓</span>
      {fresh > 0 ? `${fresh} new message${fresh === 1 ? '' : 's'}` : 'Newest'}
      {writing && <span className="spinner" aria-label="Claude is writing" />}
      <Key k="End" size="sm" />
    </button>
  );
}
