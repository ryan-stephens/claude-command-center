// Answering Claude's multiple-choice questions (AskUserQuestion) and switching modes. Pure; tested
// in questions.test.ts. The card and the keys share this state through the store.

import { MODES, type PermissionMode, type Question } from '../shared/protocol.ts';

/** Where you are in a question card: the current question, what is picked, what was typed as "Other". */
export interface QaState {
  reqId: string;
  at: number;
  /** The highlighted row in the current question (↑ ↓); options.length is "Other". */
  hl: number;
  picks: string[][];
  other: string[];
}

export function freshQa(reqId: string, count: number): QaState {
  return { reqId, at: 0, hl: 0, picks: Array.from({ length: count }, () => []), other: Array.from({ length: count }, () => '') };
}

/** Pick an option: single choice replaces the pick (and clears "Other"); multi-select toggles it. */
export function pick(s: QaState, q: Question, qi: number, label: string): QaState {
  const picks = s.picks.map((p) => [...p]);
  const other = [...s.other];
  if (q.multiSelect) picks[qi] = picks[qi].includes(label) ? picks[qi].filter((x) => x !== label) : [...picks[qi], label];
  else { picks[qi] = [label]; other[qi] = ''; }
  return { ...s, picks, other };
}

/** Type an answer of your own ("Other"); for a single choice it replaces the picked option. */
export function typeOther(s: QaState, q: Question, qi: number, text: string): QaState {
  const picks = s.picks.map((p) => [...p]);
  const other = [...s.other];
  other[qi] = text;
  if (!q.multiSelect && text.trim()) picks[qi] = [];
  return { ...s, picks, other };
}

function answerOf(s: QaState, qi: number): string {
  return [...(s.picks[qi] ?? []), ...(s.other[qi]?.trim() ? [s.other[qi].trim()] : [])].join(', ');
}

export function answered(s: QaState, qi: number): boolean {
  return answerOf(s, qi) !== '';
}

/** The first question still without an answer, or -1 when all are answered. */
export function firstOpen(s: QaState, questions: Question[]): number {
  return questions.findIndex((_, i) => !answered(s, i));
}

/** What goes back to Claude: question text → the answer (multi-select joined with ", "). */
export function answersFor(s: QaState, questions: Question[]): Record<string, string> {
  const out: Record<string, string> = {};
  questions.forEach((q, i) => { if (answered(s, i)) out[q.question] = answerOf(s, i); });
  return out;
}

/** Move to question `at` (clamped), highlighting its first row. */
export function goTo(s: QaState, at: number, count: number): QaState {
  return { ...s, at: Math.max(0, Math.min(count - 1, at)), hl: 0 };
}

/**
 * Enter on the highlighted row, like Claude Code: a single choice is picked and you move on
 * (or it is sent, when that was the last one); on a multi-select it turns the row on or off,
 * or moves on once something is picked and the row is already on. Returns what to do next.
 */
export function enterOnRow(s: QaState, questions: Question[]): { state: QaState; then: 'stay' | 'other' | 'send' } {
  const q = questions[s.at];
  if (s.hl >= q.options.length) return { state: s, then: 'other' };
  const label = q.options[s.hl].label;
  if (q.multiSelect && !(answered(s, s.at) && s.picks[s.at].includes(label))) return { state: pick(s, q, s.at, label), then: 'stay' };
  const picked = q.multiSelect ? s : pick(s, q, s.at, label);
  const open = firstOpen(picked, questions);
  if (open < 0) return { state: picked, then: 'send' };
  return { state: goTo(picked, open, questions.length), then: 'stay' };
}

/** Shift+Tab: the next mode, as in Claude Code. */
export function nextMode(mode: PermissionMode | undefined): PermissionMode {
  const i = MODES.indexOf(mode ?? 'default');
  return MODES[(i + 1) % MODES.length];
}

export const MODE_LABEL: Record<PermissionMode, { name: string; hint: string }> = {
  default: { name: 'Asks first', hint: 'asks before anything you haven’t already allowed' },
  acceptEdits: { name: 'Accepts edits', hint: 'edits files without asking; still asks before commands' },
  plan: { name: 'Plan first', hint: 'looks around and proposes a plan; changes nothing until you approve' },
  bypassPermissions: { name: 'Never asks', hint: 'runs everything without asking' },
  dontAsk: { name: 'Only allowed', hint: 'never asks; skips what is not already allowed' },
  auto: { name: 'Auto', hint: 'a classifier decides what needs your OK' },
};
