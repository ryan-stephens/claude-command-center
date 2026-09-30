// The bar at the bottom of the screen: the few keys that matter right now, as keycaps.
// Pure (tested in legend.test.ts). The full list lives in keys.ts keymap() and the ? overlay.

import { bindingsFor, displayCombo, type ActionId, type Bindings } from './bindings.ts';
import type { SessionZone } from './store.ts';

export interface LegendItem {
  keys: string[];
  label: string;
  tone?: 'attn' | 'bad' | 'acc';
}

/** A session full screen (the line has lineLegendFor). */
export interface LegendInput {
  zone: SessionZone;
  /** The open session is waiting on an approval. */
  pending: boolean;
  /** What is waiting: a tool to allow (default), a question to answer, or a plan to approve. */
  pendingKind?: 'tool' | 'question' | 'plan';
  /** Claude is working in the open session (Esc stops it). */
  busy: boolean;
  /** The message box has text in it (numpad and talk keys type instead). */
  drafting: boolean;
  bindings: Bindings;
}

const k = (b: Bindings, id: ActionId) => displayCombo(bindingsFor(id, b)[0] ?? '');

/** The keys that answer what is waiting, by kind. */
function answerKeys(kind: LegendInput['pendingKind']): LegendItem[] {
  if (kind === 'question') {
    return [
      { keys: ['↑', '↓'], label: 'Choose', tone: 'attn' },
      { keys: ['Enter'], label: 'Pick', tone: 'attn' },
      { keys: ['← →'], label: 'Question' },
      { keys: ['O'], label: 'Your own answer' },
      { keys: ['N'], label: 'Skip' },
    ];
  }
  if (kind === 'plan') {
    return [
      { keys: ['← →', 'Enter'], label: 'Choose' },
      { keys: ['Y'], label: 'Start the plan', tone: 'attn' },
      { keys: ['A'], label: 'Start, accepting edits', tone: 'attn' },
      { keys: ['N'], label: 'Keep planning', tone: 'attn' },
    ];
  }
  return [
    { keys: ['← →', 'Enter'], label: 'Choose' },
    { keys: ['Y'], label: 'Allow', tone: 'attn' },
    { keys: ['A'], label: 'Always', tone: 'attn' },
    { keys: ['N'], label: 'Don’t allow', tone: 'attn' },
    { keys: ['D'], label: 'Details' },
  ];
}

export function legendFor(x: LegendInput): LegendItem[] {
  const b = x.bindings;
  const stop: LegendItem = { keys: ['Esc'], label: 'Stop Claude', tone: 'bad' };
  const size: LegendItem[] = [{ keys: [k(b, 'expand')], label: 'Back to the line' }];
  if (x.zone === 'composer') {
    return [
      { keys: ['Enter'], label: 'Send' },
      ...(x.busy ? [stop] : []),
      ...(x.pending ? [{ keys: ['Tab'], label: 'Answer Claude', tone: 'attn' as const }] : [{ keys: ['Tab'], label: 'Number pad' }]),
      { keys: ['⇧Tab'], label: 'Mode' },
      ...(!x.drafting ? [{ keys: ['1–9'], label: 'Workflow (number pad)' }, { keys: [`Hold ${k(b, 'pushToTalk')}`], label: 'Talk' }] : []),
      ...size,
      { keys: [k(b, 'prevSession'), k(b, 'nextSession')], label: 'Other sessions' },
    ];
  }
  return [
    ...(x.pending
      ? answerKeys(x.pendingKind)
      : [{ keys: ['1–9'], label: 'Run a workflow' }, { keys: ['Enter'], label: 'Run focused key' }]),
    x.busy ? stop : { keys: ['Esc'], label: 'Ticket Line' },
    { keys: ['i'], label: 'Type a message' },
    ...size,
    { keys: ['+', '−'], label: 'Add / remove a repo' },
    ...(!x.pending ? [{ keys: ['E'], label: 'Edit key' }, { keys: ['C'], label: 'Fold pad' }] : []),
  ];
}

export interface LineLegendInput {
  view: 'board' | 'drawer' | 'composer';
  /** Board: a card is focused. */
  hasFocus?: boolean;
  /** Board: a ticket in the Inbox is focused (n starts work on it). */
  onTicket?: boolean;
  /** The focused card's session has linked (the expand key opens it). */
  hasSession?: boolean;
  /** The / filter has text in it. */
  filtered?: boolean;
  /** New-card screen: adding to a running card (this key), not making one. */
  addingTo?: string;
  /** A card (focused or open) has a run recipe (t tries it), its app is running (t stops it), serving (o opens it). */
  canTry?: boolean;
  appRunning?: boolean;
  appUp?: boolean;
  /** Drawer: the card can take more context (c), and has some still waiting (x takes it back). */
  canAdd?: boolean;
  hasWaiting?: boolean;
  /** New-card screen: which panel, and whether panel 2 shows the exact text. */
  pane?: 'src' | 'pkt' | 'go';
  preview?: boolean;
  /** New-card screen, panel 2: the highlighted row is a repo this card added (w keeps it for the workspace). */
  cardRepo?: boolean;
  bindings: Bindings;
}

/** The workspace keys, shown on the board. */
const WORKSPACE_KEYS: LegendItem[] = [
  { keys: ['+', '−'], label: 'Repos' },
  { keys: ['W', 'E', '⇧Del'], label: 'Workspace' },
  { keys: ['⇧E', '⇧I'], label: 'Share / import' },
  { keys: ['F'], label: 'Folders' },
];

/** t and o for a card: try it, stop it, open the app. */
function tryKeys(x: LineLegendInput): LegendItem[] {
  return [
    ...(x.appRunning ? [{ keys: ['t'], label: 'Stop the app' }] : x.canTry ? [{ keys: ['t'], label: 'Try it', tone: 'acc' as const }] : []),
    ...(x.appUp ? [{ keys: ['o'], label: 'Open the app' }] : []),
  ];
}

/** The Ticket Line's bar: the board, a card's drawer, or the new-card screen. */
export function lineLegendFor(x: LineLegendInput): LegendItem[] {
  if (x.view === 'composer') {
    return [
      { keys: ['Tab'], label: 'Next panel' },
      ...(x.pane === 'src'
        ? [{ keys: ['←', '→'], label: 'Tickets / Repos' }, { keys: ['↑', '↓'], label: 'Move' }, { keys: ['Space'], label: 'Add or remove' }, { keys: ['/'], label: 'Search' }]
        : x.pane === 'pkt'
          ? (x.preview ? [] : [
            { keys: ['↑', '↓'], label: 'Move' }, { keys: ['Space'], label: 'Include or leave out' }, { keys: ['x'], label: 'Remove' },
            ...(x.cardRepo && !x.addingTo ? [{ keys: ['w'], label: 'Keep for the workspace' }] : []),
            { keys: ['e'], label: 'Your note' },
          ])
          : [{ keys: ['↑', '↓'], label: 'Option' }, { keys: ['←', '→'], label: 'Change' }]),
      ...(x.addingTo ? [] : [{ keys: ['m'], label: 'Model' }]),
      { keys: ['p'], label: x.preview ? 'Back to the list' : 'Preview' },
      { keys: ['Ctrl Enter'], label: x.addingTo ? `Add to ${x.addingTo}` : 'Start work', tone: 'acc' },
      { keys: ['Esc'], label: 'Cancel' },
    ];
  }
  const full: LegendItem = { keys: [k(x.bindings, 'expand')], label: 'Full screen' };
  if (x.view === 'drawer') {
    return [
      { keys: ['Esc'], label: 'Back to the board' },
      { keys: ['Tab'], label: 'Overview · Context · Transcript' },
      ...tryKeys(x),
      { keys: ['e'], label: 'Run recipe' },
      ...(x.canAdd ? [{ keys: ['c'], label: 'Add context', tone: 'acc' as const }] : []),
      ...(x.hasWaiting ? [{ keys: ['x'], label: 'Take back' }] : []),
      ...(x.hasSession ? [full] : []),
      { keys: ['Delete'], label: 'Remove card' },
    ];
  }
  return [
    { keys: ['←', '→', '↑', '↓'], label: 'Move' },
    ...(x.onTicket ? [{ keys: ['n', 'Enter'], label: 'Start work', tone: 'acc' as const }] : []),
    ...(x.hasFocus ? [{ keys: ['Enter'], label: 'Open' }, ...tryKeys(x)] : []),
    ...(x.hasSession ? [full] : []),
    { keys: ['c'], label: 'New card', tone: 'acc' },
    { keys: ['⇧T'], label: 'Tickets' },
    { keys: ['1–9', '0'], label: 'Workspace / all' },
    { keys: ['/'], label: 'Filter' },
    ...(x.filtered ? [{ keys: ['Esc'], label: 'Clear filter' }] : []),
    ...(x.hasFocus ? [{ keys: ['Delete'], label: 'Remove' }] : []),
    ...WORKSPACE_KEYS,
  ];
}
