// The bar at the bottom of the screen: the few keys that matter right now, as keycaps.
// Pure (tested in legend.test.ts). The full list lives in keys.ts keymap() and the ? overlay.

import { bindingsFor, displayCombo, type ActionId, type Bindings } from './bindings.ts';
import type { HomeCol, SessionZone } from './store.ts';

export interface LegendItem {
  keys: string[];
  label: string;
  tone?: 'attn' | 'bad' | 'acc';
}

export interface LegendInput {
  screen: 'list' | 'session';
  homeCol: HomeCol;
  zone: SessionZone;
  /** The selected (home) or open (session) session is waiting on an approval. */
  pending: boolean;
  /** What is waiting: a tool to allow (default), a question to answer, or a plan to approve. */
  pendingKind?: 'tool' | 'question' | 'plan';
  /** Claude is working in the open session (Esc stops it). */
  busy: boolean;
  /** The message box has text in it (numpad and talk keys type instead). */
  drafting: boolean;
  /** Home: a session is selected; the library: a repo is selected. */
  hasSelection: boolean;
  /** Home: a real workspace is selected (not "everything else"). */
  inWorkspace: boolean;
  bindings: Bindings;
  /** The preview column fits on screen (otherwise approvals are answered by opening the session). */
  previewShown?: boolean;
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
  if (x.screen === 'list') {
    switch (x.homeCol) {
      case 'library':
        return [
          { keys: ['←', '→'], label: 'Choose a repo' },
          ...(x.inWorkspace ? [{ keys: ['Enter'], label: 'Add to this workspace' }] : []),
          { keys: ['N'], label: 'New session in it' },
          { keys: ['F'], label: 'Folders to scan' },
          { keys: ['C'], label: 'Fold / unfold' },
          { keys: ['Tab'], label: 'Back to sessions' },
        ];
      case 'workspaces':
        return [
          { keys: ['↑', '↓'], label: 'Choose' },
          { keys: ['1–9'], label: 'Jump to a workspace' },
          { keys: ['→'], label: 'Its sessions' },
          { keys: ['W'], label: 'New workspace' },
          { keys: ['C'], label: 'Fold column' },
          ...(x.inWorkspace ? [{ keys: ['E'], label: 'Edit' }, { keys: ['+'], label: 'Add a repo' }, { keys: ['−'], label: 'Remove one' }, { keys: ['⇧E'], label: 'Share' }] : []),
          { keys: ['⇧I'], label: 'Import' },
        ];
      case 'preview':
        return x.pending
          ? [
            ...(x.pendingKind === 'question' ? [{ keys: ['Enter'], label: 'Open to answer', tone: 'attn' as const }] : answerKeys(x.pendingKind).filter((i) => i.keys[0] !== 'D' && i.label !== 'Choose')),
            ...(x.pendingKind === 'question' ? [] : [{ keys: ['Enter'], label: 'Open' }]),
            { keys: ['←'], label: 'Back' },
          ]
          : [{ keys: ['Enter'], label: 'Open' }, { keys: ['←'], label: 'Back' }, { keys: ['R'], label: 'Rename' }, { keys: ['X'], label: 'End session' }];
      default:
        return [
          { keys: ['←', '→'], label: 'Columns' },
          { keys: ['↑', '↓'], label: 'Choose' },
          ...(x.hasSelection ? [{ keys: ['Enter'], label: 'Open' }] : []),
          ...(x.pending ? [x.previewShown === false ? { keys: ['Enter'], label: 'Open to answer', tone: 'attn' as const } : { keys: ['→'], label: 'Answer it here', tone: 'attn' as const }] : []),
          { keys: ['N'], label: 'New session', tone: 'acc' },
          { keys: ['/'], label: 'Filter' },
          { keys: ['C'], label: 'Fold group' },
          { keys: ['Tab'], label: 'Repo library' },
        ];
    }
  }
  const stop: LegendItem = { keys: ['Esc'], label: 'Stop Claude', tone: 'bad' };
  if (x.zone === 'composer') {
    return [
      { keys: ['Enter'], label: 'Send' },
      ...(x.busy ? [stop] : []),
      ...(x.pending ? [{ keys: ['Tab'], label: 'Answer Claude', tone: 'attn' as const }] : [{ keys: ['Tab'], label: 'Number pad' }]),
      { keys: ['⇧Tab'], label: 'Mode' },
      ...(!x.drafting ? [{ keys: ['1–9'], label: 'Workflow (number pad)' }, { keys: [`Hold ${k(b, 'pushToTalk')}`], label: 'Talk' }] : []),
      { keys: [k(b, 'prevSession'), k(b, 'nextSession')], label: 'Other sessions' },
    ];
  }
  return [
    ...(x.pending
      ? answerKeys(x.pendingKind)
      : [{ keys: ['1–9'], label: 'Run a workflow' }, { keys: ['Enter'], label: 'Run focused key' }]),
    x.busy ? stop : { keys: ['Esc'], label: 'Home' },
    { keys: ['i'], label: 'Type a message' },
    { keys: ['+', '−'], label: 'Add / remove a repo' },
    ...(!x.pending ? [{ keys: ['E'], label: 'Edit key' }, { keys: ['C'], label: 'Fold pad' }] : []),
  ];
}
