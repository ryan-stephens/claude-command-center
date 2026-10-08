// The bar at the bottom of the screen: the few keys that matter right now, as keycaps.
// Pure (tested in legend.test.ts). The full list lives in keys.ts keymap() and the ? overlay.

import { bindingsFor, displayCombo, type ActionId, type Bindings } from './bindings.ts';
import { CARD_PANELS, type CardPanel } from './line-model.ts';
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
  /** Board: a ticket to start is focused (n starts work on it). */
  onTicket?: boolean;
  /** Board (§126): some card needs you (a goes to it); the focused one asks y / n can answer, or finished unseen (m). */
  anyNeeds?: boolean;
  focusAsks?: boolean;
  focusUnread?: boolean;
  /** The focused card's session has linked (the expand key opens it). */
  hasSession?: boolean;
  /** The focused or open card has a terminal tab (g brings it forward); it is waiting on you there and the page can't answer. */
  hasTab?: boolean;
  needsTab?: boolean;
  /** The focused or open card's session runs in the app (§93): g opens it in a terminal; `working`: its turn is running, so Esc on the open card stops it. */
  inApp?: boolean;
  working?: boolean;
  /** The focused or open card has changed files (D shows the diffs). */
  hasChanges?: boolean;
  /** Board: a half-built card was kept (c picks it up, Shift+C starts fresh). */
  hasDraft?: boolean;
  /** The / filter has text in it. */
  filtered?: boolean;
  /** New-card screen: adding to a running card (this key), not making one. */
  addingTo?: string;
  /** A card (focused or open) has a run recipe (t tries it), its app is running (t stops it), serving (o opens it). */
  canTry?: boolean;
  appRunning?: boolean;
  appUp?: boolean;
  /** A card (focused or open) can ship (s), has an open PR (s merges it), or a ship stopped part-way (s ships the rest); a QA or review card shows its report. */
  ship?: 'ship' | 'rest' | 'merge' | 'report';
  /** A card (focused or open) in Ship: d marks it done by hand. */
  canDone?: boolean;
  /** It has a pull request to open (o, when no app is up). */
  hasPr?: boolean;
  /** A card (focused or open) has worktrees of its own (Shift+X lists them, removes them when it is done). */
  hasWorktrees?: boolean;
  /** Open card: its terminal can be typed into from here (Enter), and it is asking something y / n can answer. */
  canSay?: boolean;
  asking?: boolean;
  /** Open card: Claude's question form is up (§91): digits pick, Tab moves on, y submits. */
  question?: boolean;
  /** New-card screen, panel 1: which tab (Folders has its own keys). */
  tab?: 'tickets' | 'repos' | 'folders';
  /** Drawer: the card can take more context (c), and has some still waiting (x takes it back). */
  canAdd?: boolean;
  hasWaiting?: boolean;
  /** Drawer: the dock panel open beside the chat (§81), if any; `hasStack`: the lane has a stack, so Try it is a list of services (§82). */
  panel?: CardPanel | null;
  hasStack?: boolean;
  /** New-card screen: which panel, and whether panel 2 shows the exact text. */
  pane?: 'src' | 'pkt' | 'go';
  preview?: boolean;
  /** New-card screen, panel 2: the highlighted row is a repo this card added (w keeps it for the workspace). */
  cardRepo?: boolean;
  /** New-card screen in its simple look (§59): which block, a picker open, the options open, a ticket picked. */
  simple?: { block: 'ticket' | 'context' | 'msg' | 'how' | 'start'; adding: boolean; /** The context picker (Repos / Folders / Tickets tabs), not the ticket search. */ context?: boolean; /** Its Folders tab is showing. */ folders?: boolean; /** Its Repos tab is showing; `onSource`: the highlighted row is the heading of a folder added for this card (§65). */ repos?: boolean; onSource?: boolean; /** The list of saved prompts is open under the opening message. */ prompt?: boolean; more: boolean; hasTicket: boolean; /** The ticket's drawer is open; the ticket has a link to the tracker (§70). */ details?: boolean; ticketLink?: boolean; ownChip: boolean };
  bindings: Bindings;
}

/** The simple look's bar: few keys, the ones for where you are. */
function simpleLegend(x: LineLegendInput): LegendItem[] {
  const sp = x.simple!;
  if (x.preview) return [{ keys: ['p', 'Esc'], label: 'Back' }, { keys: ['Ctrl Enter'], label: 'Start work', tone: 'acc' }];
  if (sp.prompt) return [{ keys: ['↑', '↓'], label: 'Move' }, { keys: ['Enter'], label: 'Use this prompt', tone: 'acc' }, { keys: ['⇧E'], label: 'Edit prompts' }, { keys: ['Esc'], label: 'Close' }];
  if (sp.adding) {
    return [
      ...(sp.context ? [{ keys: ['←', '→'], label: 'Repos · Folders · Tickets' }] : []),
      { keys: ['↑', '↓'], label: 'Move' },
      { keys: ['Enter'], label: sp.folders ? 'Add the path / leave out' : sp.context ? 'Add / take out' : 'Choose this ticket', tone: 'acc' },
      ...(sp.folders ? [{ keys: ['b'], label: 'Browse' }, { keys: ['x'], label: 'Take off' }]
        : sp.repos ? [{ keys: ['b'], label: 'A folder of repos' }, ...(sp.onSource ? [{ keys: ['x'], label: 'Take the folder off' }] : []), { keys: ['/'], label: 'Search' }]
        : [{ keys: ['/'], label: 'Search' }]),
      // + Context on an open card (§88): Ctrl+Enter adds to it, Esc goes back to the chat.
      ...(x.addingTo ? [{ keys: ['Ctrl Enter'], label: `Add to ${x.addingTo}`, tone: 'acc' as const }, { keys: ['Esc'], label: 'Cancel' }] : [{ keys: ['Esc'], label: sp.context ? 'Done' : 'Close' }]),
    ];
  }
  const here: LegendItem[] = sp.block === 'ticket' ? [{ keys: ['Enter'], label: sp.hasTicket ? 'Change ticket' : 'Find a ticket' }, ...(sp.hasTicket ? [{ keys: ['Space'], label: sp.details ? 'Hide details' : 'Details' }, ...(sp.ticketLink ? [{ keys: ['o'], label: 'Open in the tracker' }] : []), { keys: ['x'], label: 'No ticket' }] : [])]
    : sp.block === 'context' ? [{ keys: ['←', '→'], label: 'Along the chips' }, { keys: ['Enter'], label: 'Include / leave out' }, { keys: ['+'], label: 'Add context' }, ...(sp.ownChip ? [{ keys: ['x'], label: 'Take out' }, { keys: ['w'], label: 'Keep for the lane' }] : [])]
    : sp.block === 'msg' ? [{ keys: ['Enter'], label: 'Write the message' }, { keys: ['Space'], label: 'Pick a prompt' }, { keys: ['w'], label: 'Have Claude write it' }, { keys: ['s'], label: 'Save as a prompt' }, { keys: ['⇧E'], label: 'Edit prompts' }]
    : sp.block === 'how' ? (sp.more ? [{ keys: ['←', '→'], label: 'Change' }, { keys: ['Enter'], label: 'Close the options' }] : [{ keys: ['Enter'], label: 'Options' }])
    : [{ keys: ['Enter'], label: 'Start work', tone: 'acc' }];
  return [
    { keys: ['↑', '↓'], label: 'Move' },
    ...here,
    { keys: ['p'], label: 'Preview' },
    ...(sp.block === 'start' ? [] : [{ keys: ['Ctrl Enter'], label: 'Start work', tone: 'acc' as const }]),
    // Labels double as React keys in the bar: never the same as Enter's above.
    { keys: ['Esc'], label: sp.more ? 'Close' : 'Cancel' },
    { keys: ['⇧L'], label: 'Full look' },
  ];
}

/** The workspace keys, shown on the board. */
const WORKSPACE_KEYS: LegendItem[] = [
  { keys: ['+', '−'], label: 'Repos' },
  { keys: ['W', 'E', '⇧Del'], label: 'Lane' },
  { keys: ['⇧E', '⇧I'], label: 'Share / import' },
  { keys: ['F'], label: 'Folders' },
];

/** t and o for a card: try it, stop it, open the app. */
function tryKeys(x: LineLegendInput): LegendItem[] {
  return [
    // On the open card the dock's Try it is the panel (⇧T), so t reads as what it does: start the app.
    ...(x.appRunning ? [{ keys: ['t'], label: x.hasStack ? 'Stop all' : 'Stop the app' }, { keys: ['⇧R'], label: 'Restart' }] : x.canTry ? [{ keys: ['t'], label: x.view === 'drawer' ? (x.hasStack ? 'Start all ticked' : 'Start the app') : 'Try it', tone: 'acc' as const }] : []),
    ...(x.appUp ? [{ keys: ['o'], label: 'Open the app' }] : x.hasPr ? [{ keys: ['o'], label: 'Open the PR' }] : []),
    ...(x.hasChanges ? [{ keys: ['⇧D'], label: 'Changes' }] : []),
    ...(x.ship ? [{ keys: ['s'], label: x.ship === 'merge' ? 'Merge' : x.ship === 'rest' ? 'Ship the rest' : x.ship === 'report' ? 'Report' : 'Ship' }] : []),
    ...(x.canDone ? [{ keys: ['d'], label: 'Done' }] : []),
  ];
}

/** The Ticket Line's bar: the board, a card's drawer, or the new-card screen. */
export function lineLegendFor(x: LineLegendInput): LegendItem[] {
  if (x.view === 'composer' && x.simple) return simpleLegend(x);
  if (x.view === 'composer') {
    return [
      { keys: ['Tab'], label: 'Next panel' },
      ...(x.pane === 'src'
        ? [{ keys: ['←', '→'], label: 'Tickets / Repos / Folders' }, { keys: ['↑', '↓'], label: 'Move' },
          ...(x.tab === 'folders' ? [{ keys: ['Enter'], label: 'Add a folder' }, { keys: ['Space'], label: 'Take one out' }] : [{ keys: ['Space'], label: 'Add or remove' }, { keys: ['/'], label: 'Search' }])]
        : x.pane === 'pkt'
          ? (x.preview ? [] : [
            { keys: ['↑', '↓'], label: 'Move' }, { keys: ['Space'], label: 'Include or leave out' }, { keys: ['x'], label: 'Remove' },
            ...(x.cardRepo && !x.addingTo ? [{ keys: ['w'], label: 'Keep for the lane' }] : []),
            { keys: ['e'], label: 'Your note' },
          ])
          : [{ keys: ['↑', '↓'], label: 'Option' }, { keys: ['←', '→'], label: 'Change' }]),
      ...(x.addingTo ? [] : [{ keys: ['k'], label: 'Kind' }, { keys: ['m'], label: 'Model' }]),
      { keys: ['p'], label: x.preview ? 'Back to the list' : 'Preview' },
      { keys: ['Ctrl Enter'], label: x.addingTo ? `Add to ${x.addingTo}` : 'Start work', tone: 'acc' },
      { keys: ['Esc'], label: 'Cancel' },
      ...(x.addingTo ? [] : [{ keys: ['⇧L'], label: 'Simple look' }]),
    ];
  }
  const full: LegendItem = { keys: [k(x.bindings, 'expand')], label: 'Its session' };
  if (x.view === 'drawer') {
    // The Verify panel (§105) takes Enter, e, o, r, a and its own keys while it is open.
    const verify = x.panel === 'verify';
    return [
      { keys: ['Esc'], label: x.working ? 'Stop Claude' : 'Back to the board' },
      ...(x.question ? [{ keys: ['1', '9'], label: 'Pick', tone: 'attn' as const }, { keys: ['Tab'], label: 'Next question' }, { keys: ['y'], label: 'Submit answers', tone: 'attn' as const }] : x.asking ? [{ keys: ['y', 'n'], label: 'Allow / deny', tone: 'attn' as const }] : []),
      ...(verify ? [{ keys: ['Enter'], label: 'Check', tone: 'acc' as const }, { keys: ['i', 'l'], label: 'Ids / record' }, { keys: ['e'], label: 'Dev / UAT' }, { keys: ['⇧P'], label: 'Prod' }, { keys: ['r'], label: 'Refresh set' }, { keys: ['a'], label: 'Advanced' }, { keys: ['o', '⇧O', '⇧L'], label: 'Open a tool' }]
        : x.canSay ? [{ keys: ['Enter'], label: x.inApp ? 'Message' : 'Type to it', tone: x.asking ? undefined : 'acc' as const }, ...(x.inApp ? [{ keys: ['⇧I'], label: 'Image' }] : []), { keys: ['Ctrl⇧↑', '↓'], label: 'Box size' }] : []),
      ...(x.hasTab ? [{ keys: ['g'], label: x.inApp ? 'In a terminal' : x.needsTab ? 'Answer in its tab' : 'Its tab', ...(x.needsTab && !x.inApp ? { tone: 'attn' as const } : {}) }] : []),
      { keys: ['←', '→'], label: 'Previous / next card' },
      // The dock: the panel open is named, the rest are one key each.
      ...(x.panel === 'changes' ? [{ keys: ['j', 'k'], label: 'File' }, { keys: ['Space'], label: 'Open / close diff' }, { keys: ['z'], label: 'Fold repo' }, { keys: ['f'], label: 'Pop out' }] : []),
      ...(x.panel === 'try' && x.hasStack ? [{ keys: ['j', 'k'], label: 'Service' }, { keys: ['Space'], label: 'Tick / environment' }, { keys: ['r'], label: 'Start this one' }, { keys: ['q'], label: 'Stop this one' }] : []),
      ...(x.panel === 'try' && (x.appRunning || x.canTry) ? [{ keys: ['f'], label: 'Output' }] : []),
      ...CARD_PANELS.map((p) => ({ keys: [p.key], label: x.panel === p.id ? `Close ${p.name}` : p.name })),
      ...(x.panel ? [{ keys: ['[', ']'], label: 'Panel width' }] : []),
      ...tryKeys(x).filter((i) => i.keys[0] !== '⇧D' && !(verify && i.keys[0] === 'o')),
      ...(verify ? [] : [{ keys: ['e'], label: 'How it runs' }]),
      ...(x.canAdd ? [{ keys: ['c'], label: 'Add context', tone: 'acc' as const }] : []),
      ...(x.hasWaiting ? [{ keys: ['x'], label: 'Take back' }] : []),
      ...(x.hasSession ? [{ ...full, label: 'Its session' }] : []),
      ...(x.hasWorktrees ? [{ keys: ['⇧X'], label: 'Worktrees' }] : []),
      { keys: ['Delete'], label: 'Remove card' },
    ];
  }
  return [
    { keys: ['←', '→', '↑', '↓'], label: 'Move' },
    ...(x.anyNeeds ? [{ keys: ['a'], label: 'Next that needs you', tone: 'attn' as const }] : []),
    ...(x.focusAsks ? [{ keys: ['y', 'n'], label: 'Allow / deny', tone: 'attn' as const }] : []),
    ...(x.focusUnread ? [{ keys: ['m'], label: 'Seen' }] : []),
    ...(x.onTicket ? [{ keys: ['n', 'Enter'], label: 'Start work', tone: 'acc' as const }, { keys: ['Delete'], label: 'Hide' }] : []),
    ...(x.hasFocus ? [{ keys: ['Enter'], label: 'Open the card' }, ...tryKeys(x), ...(x.hasTab ? [{ keys: ['g'], label: x.inApp ? 'In a terminal' : x.needsTab ? 'Answer in its tab' : 'Its tab', ...(x.needsTab && !x.inApp ? { tone: 'attn' as const } : {}) }] : []), { keys: ['e'], label: 'How it runs' }] : []),
    ...(x.hasSession ? [full] : []),
    ...(x.hasDraft ? [{ keys: ['c'], label: 'Pick up your card', tone: 'acc' as const }, { keys: ['⇧C'], label: 'New card' }] : [{ keys: ['c'], label: 'New card', tone: 'acc' as const }]),
    { keys: ['⇧T'], label: 'Tickets' },
    { keys: ['v'], label: 'Tickets: mine / QA' },
    { keys: ['i'], label: 'Fold tickets' },
    { keys: ['1–9', '0'], label: 'Lane / all' },
    { keys: ['/'], label: 'Filter' },
    ...(x.filtered ? [{ keys: ['Esc'], label: 'Clear filter' }] : []),
    ...(x.hasFocus && x.hasWorktrees ? [{ keys: ['⇧X'], label: 'Worktrees' }] : []),
    ...(x.hasFocus ? [{ keys: ['Delete'], label: 'Remove' }] : []),
    ...WORKSPACE_KEYS,
  ];
}
