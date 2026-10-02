// Small shared pieces: keycaps, icons, workspace badges, status pills.

import type { ReactNode } from 'react';
import type { Workspace } from '../../shared/protocol.ts';
import type { TicketSource } from '../../shared/tickets.ts';
import type { Tone } from '../home-model.ts';

/**
 * A keycap. With key hints off (web/hints.ts) the hint ones disappear; `inline` marks a key named
 * inside a sentence ("Press t to try it"), which then reads as bold text instead. Large keycaps are
 * content (the answer buttons, the tour) and always show.
 */
export function Key({ k, size, tone, inline, className = '' }: { k: ReactNode; size?: 'sm' | 'lg'; tone?: 'acc' | 'attn' | 'bad' | 'ghost'; inline?: boolean; className?: string }) {
  return <kbd className={`kc ${size ? `kc-${size}` : ''} ${tone ? `kc-${tone}` : ''} ${inline ? 'kc-inline' : ''} ${className}`}>{k}</kbd>;
}

/** A labelled key, as used in the legend and on buttons: [K] Label. */
export function KeyHint({ k, children, tone }: { k: ReactNode | ReactNode[]; children?: ReactNode; tone?: 'acc' | 'attn' | 'bad' }) {
  const keys = Array.isArray(k) ? k : [k];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {keys.map((x, i) => <Key key={i} k={x} tone={tone} />)}
      {children && <span>{children}</span>}
    </span>
  );
}

const PATHS: Record<string, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  send: <path d="M12 19V5M5 12l7-7 7 7" />,
  repo: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  home: <><path d="m3 11 9-7 9 7" /><path d="M5 10v10h14V10" /></>,
  shield: <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  warn: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>,
  edit: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  read: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  run: <path d="m5 8 4 4-4 4M12 17h7" />,
  web: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  agent: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  plan: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  tool: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />,
  back: <path d="m15 18-6-6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  down: <path d="m6 9 6 6 6-6" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" />,
  auto: <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 21a2 2 0 0 0 4 0" /></>,
  bellOff: <><path d="M6 8a6 6 0 0 1 9.3-5M18 8c0 7 3 8 3 8H8M10 21a2 2 0 0 0 4 0M3 3l18 18" /></>,
  keyboard: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
  link: <><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1" /><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" /></>,
  bg: <path d="M4 14h10v6H4zM10 4h10v10" />,
  dots: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  expand: <path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7" />,
  collapse: <path d="M4 14h6v6M10 14l-7 7M20 10h-6V4M14 10l7-7" />,
  /** A file with a diff in it: a plus line and a minus line. */
  diff: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M10 12h4M12 10v4" /><path d="M10 17h4" /></>,
  /** An app window with play in it: the app, running. */
  window: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /><path d="m10.5 12 4 2.5-4 2.5z" /></>,
  /** A clipboard with a check: what was verified. */
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v2H9z" /><path d="m8.5 13 2.5 2.5 4.5-4.5" /></>,
  /** An open book: what Claude was given. */
  book: <><path d="M12 6c-2-1.5-4.5-2-8-2v14c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2V4c-3.5 0-6 .5-8 2z" /><path d="M12 6v14" /></>,
  /** A rocket, upright: ship it. */
  rocket: <><path d="M12 3c3 1.5 5 5 5 9v3H7v-3c0-4 2-7.5 5-9z" /><path d="M7 12l-3 3 3 1M17 12l3 3-3 1M10 18l2 3 2-3" /><circle cx="12" cy="10" r="1.5" /></>,
  /** An arrow out of a box: open it in its own window. */
  popout: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
  grip: <><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>,
};
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

// Workspace swatches: white text on each passes AA for bold initials in both themes.
export const SWATCH: Record<string, string> = {
  orange: '#c2521f', green: '#0f7f63', blue: '#4a5fdc', violet: '#874bcf', pink: '#c23c78', teal: '#0e7580', amber: '#9c6310', slate: '#56606f',
};

export function WsBadge({ ws, size = 30 }: { ws: Pick<Workspace, 'name' | 'color'> | null; size?: number }) {
  const bg = ws ? SWATCH[ws.color] ?? SWATCH.slate : 'var(--c-raise)';
  return (
    <span
      className="inline-grid shrink-0 place-items-center font-bold text-white"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.27), background: bg, fontSize: Math.round(size * 0.44), color: ws ? '#fff' : 'var(--c-sub)' }}
      aria-hidden="true"
    >
      {ws ? ws.name.trim().charAt(0).toUpperCase() : <Icon name="grid" size={Math.round(size * 0.5)} />}
    </span>
  );
}

export const TONE_PILL: Record<Tone, string> = {
  amber: 'bg-attn-bg text-attn',
  blue: 'bg-busy-bg text-busy',
  green: 'bg-ok-bg text-ok',
  violet: 'bg-calm-bg text-calm',
  grey: 'bg-raise text-sub',
};

export function Pill({ tone, children, spin }: { tone: Tone; children: ReactNode; spin?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold ${TONE_PILL[tone]}`}>
      {spin && <span className="spinner" style={{ width: 10, height: 10 }} />}
      {children}
    </span>
  );
}

/** A card's or ticket's key as a badge: Jira keys in blue, Trello in its own colour, plain cards grey. */
export function TicketKey({ k, source }: { k: string; source?: TicketSource }) {
  return <span className={`whitespace-nowrap rounded-md px-1.5 font-mono text-[11.5px] font-bold ${source === 'trello' ? 'bg-calm-bg text-calm' : source === 'jira' ? 'bg-busy-bg text-busy' : 'bg-raise text-sub'}`}>{k}</span>;
}
