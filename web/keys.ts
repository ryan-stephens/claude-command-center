// One keydown handler routes every key by modal → screen → focus (home column or session zone),
// so behaviour is deterministic. keymap() is the single source for the `?` overlay and legend.ts
// for the bar at the bottom; add a row to both whenever you add a key. Global shortcuts come
// from bindings.ts so they can be rebound.

import type { PermissionDecision, PermissionRequest } from '../shared/protocol.ts';
import { workspacesFor } from '../shared/workspaces.ts';
import { ACTIONS, actionFor, bindingsFor, comboOf, displayCombo, type ActionId, type Bindings } from './bindings.ts';
import { cycleGroup, exportPack, exportWorkspace, fireSlot, importPack, importWorkspace } from './commands.ts';
import { sessionsIn } from './home-model.ts';
import { nextTheme, applyTheme, THEME_LABEL } from './theme.ts';
import { cancelVoice, isListening, startVoice, stopVoice } from './voice.ts';
import { BUCKET_TITLE } from './home-model.ts';
import {
  activeSession, attention, bucketOfSelected, currentGroup, currentWorkspace, flash, get, HOME_COLS, markRead, pendingFor, sameScope, scopes, sessionById, set, setScope,
  isDocked, toggleBucket, toggleFold, toggleSound, unfoldAllBuckets, visibleSessions, type HomeCol,
} from './store.ts';
import { lastPermissionAt, send } from './ws.ts';
import { answersFor, enterOnRow, firstOpen, freshQa, goTo, MODE_LABEL, nextMode, pick } from './questions.ts';
import { explainPermission } from './plain.ts';

/** Keys pressed this soon after an approval card appears were aimed at something else. */
const APPROVAL_GRACE_MS = 400;

const FIXED_SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Home',
    keys: [
      ['← →', 'Move between columns: workspaces, sessions, and the selected session beside them'],
      ['↑ ↓  Home End', 'Choose in the current column (the selected session shows beside the list)'],
      ['1–9  /  0', 'Jump to workspace 1–9 / everything outside your workspaces'],
      ['Enter / →', 'Go into the selected session beside the list: type, answer Claude, run workflows (a narrow window opens it full screen; in the workspace column, Enter goes to its sessions)'],
      ['Ctrl+Enter', 'Open the selected session full screen (again: back beside the list)'],
      ['Esc / Numpad 0 (in the session beside the list)', 'Back to the list (while Claude is working, Esc stops it first)'],
      ['Double-click a session', 'Open it full screen'],
      ['N', 'New session in this workspace'],
      ['W', 'New workspace'],
      ['E / Delete (workspace column)', 'Edit / delete the workspace'],
      ['Shift+E / Shift+I (workspace column)', 'Export the workspace to share it / import one'],
      ['+ / −', 'Add a repo to this workspace / remove one (every session in it can use them all)'],
      ['Tab', 'Go to the repo library (Enter adds the repo here, N starts a session in it, F picks the folders it lists)'],
      ['/', 'Filter sessions'],
      ['C', 'Collapse or expand what you are in: the workspace column, the selected session’s group, the repo library, the session beside the list (from its number pad)'],
      ['Shift+C', 'Expand every group of sessions'],
      ['R / X', 'Rename / end the selected session'],
    ],
  },
  {
    title: 'Folder picker',
    keys: [
      ['F (repo library)', 'Choose the folders the repo library lists'],
      ['↑ ↓  PgUp PgDn', 'Choose a folder'],
      ['→ / Enter', 'Open the highlighted folder'],
      ['← / Backspace', 'Up one folder'],
      ['Space / Ctrl+Enter', 'Use the folder you are in (Ctrl+Enter also works while typing)'],
      ['Type a name / a path', 'Filter this folder / jump to that path (pasted "quotes" are fine)'],
      ['Esc', 'Clear what you typed, then go back'],
      ['Tab, then Delete (folders dialog)', 'Go to your folders and remove one'],
      ['Ctrl+O (new session, add a repo)', 'Browse to any folder'],
    ],
  },
  {
    title: 'Session',
    keys: [
      ['Enter / Shift+Enter', 'Send / new line (message box)'],
      ['Shift+Tab', 'Switch mode, like Claude Code: asks first → accepts edits → plan first'],
      ['/ (start of a message)', 'Suggests commands and skills as you type, like Claude Code: ↑ ↓ choose, Tab completes, Enter runs, Esc hides'],
      ['/model, /effort … then ↑ ↓', 'Commands with choices list them (models, effort levels, on/off): pick one with the arrows and Enter'],
      ['@ (message box)', 'Suggests files in the repos Claude can use; Tab or Enter puts it in'],
      ['↑ ↓ (empty message box)', 'Your earlier messages, like Claude Code'],
      ['Ctrl+V / drop (message box)', 'Attach an image; Backspace in an empty box takes the last one off'],
      ['Esc', 'While Claude is working: stop it. Otherwise step out: message box → number pad → home'],
      ['Numpad 0 / Alt+0', 'Back to home (or to the list, beside it), even while Claude is working'],
      ['Tab (message box)', 'Go to the number pad or the approval card without stopping Claude'],
      ['i', 'Back to the message box'],
      ['+ / −', 'Give this session another repo to work in / take one it was given back out (or its × above the conversation)'],
      ['PgUp PgDn  Home End', 'Scroll the conversation'],
      ['T', 'Show or hide every step’s details'],
      ['L', 'Fold or open Claude’s to-do list'],
      ['C (number pad)', 'Fold the number pad away, or keep it open (folded, it still opens while you use it)'],
      ['R / X', 'Rename / end the session'],
    ],
  },
  {
    title: 'Approvals',
    keys: [
      ['Y', 'Allow once'],
      ['A', 'Always allow (the card says exactly what)'],
      ['N', 'Don’t allow; Claude tries another way'],
      ['D', 'Show or hide the raw details'],
    ],
  },
  {
    title: 'Questions from Claude',
    keys: [
      ['↑ ↓  then Enter', 'Choose an answer and pick it, like Claude Code (a single choice moves on to the next question)'],
      ['1–4', 'Pick an answer directly (on a multi-select, turn it on or off; Space does too)'],
      ['← →', 'Previous / next question'],
      ['O', 'Type your own answer'],
      ['Enter', 'Send the answers'],
      ['N', 'Skip: Claude decides'],
      ['Y / A / N (plan)', 'Start the plan asking first / accepting edits / keep planning'],
      ['← →  then Enter (any card)', 'Choose Allow / Always / Don’t allow (or a plan’s answer) with the arrows, like Claude Code'],
    ],
  },
  {
    title: 'Number pad (workflows)',
    keys: [
      ['Numpad 1–9', 'Run workflow N (from the message box only while it is empty)'],
      ['Alt+1–9', 'Run workflow N, always'],
      ['Numpad + / −  or  ] / [', 'Next / previous group'],
      ['Numpad /', 'Type a message'],
      ['Numpad *', 'Search everything'],
      ['↑ ↓ ← →  then Enter', 'Move on the pad and run the focused key'],
      ['E', 'Edit the focused key (on a skill: save your own copy)'],
      ['Delete', 'Remove the focused workflow'],
      ['Ctrl+↑ ↓ ← →', 'Move the focused workflow to the neighbouring key'],
      ['Shift+E / Shift+I', 'Export / import your own workflows as JSON'],
    ],
  },
  {
    title: 'Voice (Chrome / Edge)',
    keys: [
      ['Esc (while holding)', 'Cancel without sending'],
      ['Say a workflow’s name', 'Runs it instead of sending the words, e.g. “run the tests”; “slot 3” runs key 3'],
    ],
  },
];

const ACTION_HELP: Partial<Record<ActionId, string>> = {
  nextAttention: 'Jump to the next session that needs you (approvals first, then finished)',
  sound: 'Sound on / off (outside text fields)',
  pushToTalk: 'Push-to-talk: hold, speak, release to send (not while you are mid-message)',
  theme: 'Theme: match Windows → light → dark',
  expand: 'The session you are in: full screen, and back beside the list on home',
};

/** Help sections with the current bindings filled in. */
export function keymap(overrides: Bindings): { title: string; keys: [string, string][] }[] {
  const row = (id: ActionId): [string, string] => [
    bindingsFor(id, overrides).map(displayCombo).join(' / '),
    ACTION_HELP[id] ?? ACTIONS.find((a) => a.id === id)!.label,
  ];
  const global = ACTIONS.filter((a) => a.id !== 'pushToTalk').map((a) => row(a.id));
  global.push(['B (in this overlay)', 'Change these shortcuts']);
  const sections = [{ title: 'Anywhere', keys: global }, ...FIXED_SECTIONS.map((s) => ({ ...s, keys: [...s.keys] }))];
  const voice = sections.find((x) => x.title.startsWith('Voice'))!;
  voice.keys = [row('pushToTalk'), ...voice.keys];
  return sections;
}

function isTextTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}

// ---- Shared actions -------------------------------------------------------------------

export function openSession(id: string): void {
  const s = get();
  markRead(id);
  // Keep home in step: coming back should show this session in its workspace.
  const session = sessionById(id);
  if (session && !sessionsIn(s.scope, [session], s.workspaces).length) {
    const ws = workspacesFor(session.cwd, s.workspaces)[0];
    setScope(ws ? { kind: 'workspace', id: ws.id } : { kind: 'rest' });
  }
  set({ screen: 'session', openId: id, selectedId: id, zone: pendingFor(id) ? 'board' : 'composer', filterFocused: false, board: null, homeCol: 'sessions' });
  send({ type: 'session.open', id });
  send({ type: 'board.get', sessionId: id });
}

/**
 * Step into a session beside the list on home: it takes the session keys there (type, answer,
 * workflows) without leaving home. Where it doesn't fit (under 1024 px) it opens full screen.
 */
export function dockSession(id: string): void {
  if (!shownCols().includes('preview')) { openSession(id); return; }
  const s = get();
  const fresh = s.openId !== id;
  markRead(id);
  set({ screen: 'list', openId: id, selectedId: id, homeCol: 'preview', zone: pendingFor(id) ? 'board' : 'composer', filterFocused: false, ...(fresh ? { board: null } : {}) });
  // The pane usually loaded the transcript already, while the row was selected.
  if (!s.transcripts[id]) send({ type: 'session.open', id });
  if (fresh || !s.board) send({ type: 'board.get', sessionId: id });
  document.getElementById(`row-${id}`)?.scrollIntoView({ block: 'nearest' });
}

/** Out to the session list: from full screen, or from the session beside it. */
export function backToList(): void {
  set({ screen: 'list', openId: null, homeCol: 'sessions' });
}

/** Ctrl+Enter: the session you are in (or the selected one) full screen, and back beside the list. */
export function toggleExpand(): void {
  const s = get();
  if (s.screen === 'session' && s.openId) {
    if (shownCols().includes('preview')) dockSession(s.openId);
    else flash('Widen the window to keep a session beside the list');
    return;
  }
  const id = activeSession(s) ?? visibleSelection();
  if (id) openSession(id);
}

export function respondPermission(decision: PermissionDecision, sessionId = get().openId): boolean {
  const req = pendingFor(sessionId);
  if (!req) return false;
  if (performance.now() - lastPermissionAt < APPROVAL_GRACE_MS) return true; // swallow, don't answer
  // A question wants answers, not a yes: only "skip" goes through from here.
  if (req.questions && decision !== 'deny') { flash('Pick an answer (1–4), then Enter'); return true; }
  // A plan: Y starts it asking before changes, A starts it accepting edits.
  if (req.plan !== undefined && decision !== 'deny') {
    send({ type: 'permission.respond', reqId: req.reqId, decision: 'allow', mode: decision === 'always' ? 'acceptEdits' : 'default' });
    return true;
  }
  send({ type: 'permission.respond', reqId: req.reqId, decision });
  return true;
}

/** Send the answers on the open session's question card, or jump to the one still unanswered. */
export function submitAnswers(): void {
  const s = get();
  const req = pendingFor(s.openId);
  if (!req?.questions) return;
  const qa = s.qa?.reqId === req.reqId ? s.qa : freshQa(req.reqId, req.questions.length);
  const open = firstOpen(qa, req.questions);
  if (open >= 0) { set({ qa: { ...qa, at: open } }); flash('This one still needs an answer'); return; }
  send({ type: 'permission.respond', reqId: req.reqId, decision: 'allow', answers: answersFor(qa, req.questions) });
  set({ qa: null });
}

/** The answers a tool or plan card offers, in the order they are drawn (← → walk them). */
export function approvalChoices(req: PermissionRequest): PermissionDecision[] {
  if (req.plan !== undefined) return ['allow', 'always', 'deny'];
  return req.canAlways ? ['allow', 'always', 'deny'] : ['allow', 'deny'];
}

/** Which answer is highlighted before you move: the card's main button ("Don't allow" when it's risky). */
export function defaultChoice(req: PermissionRequest): number {
  const choices = approvalChoices(req);
  const careful = req.plan === undefined && explainPermission(req, sessionById(req.sessionId)?.cwd).risk === 'careful';
  return careful ? choices.indexOf('deny') : 0;
}

export function approvalIndex(req: PermissionRequest): number {
  const pick = get().approvalPick;
  return pick?.reqId === req.reqId ? pick.index : defaultChoice(req);
}

/**
 * Keys on the card waiting in the open session, like Claude Code's prompts: arrows choose, Enter
 * confirms. The letter and number keys (Y A N, 1–4) keep working alongside.
 */
function cardKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  if (!activeSession(s) || s.zone !== 'board' || typing || e.ctrlKey || e.altKey || e.metaKey) return false;
  const req = pendingFor(s.openId);
  if (!req) return false;
  if (req.questions?.length) return questionKeys(e, req);
  const choices = approvalChoices(req);
  const at = approvalIndex(req);
  switch (e.key) {
    case 'ArrowLeft': case 'ArrowUp': set({ approvalPick: { reqId: req.reqId, index: Math.max(0, at - 1) } }); return true;
    case 'ArrowRight': case 'ArrowDown': set({ approvalPick: { reqId: req.reqId, index: Math.min(choices.length - 1, at + 1) } }); return true;
    case 'Enter': respondPermission(choices[at]); return true;
  }
  return false;
}

/** A question card: ↑ ↓ choose a row, Enter picks it (and moves on), ← → change question, 1–9 pick directly. */
function questionKeys(e: KeyboardEvent, req: PermissionRequest): boolean {
  const s = get();
  const qs = req.questions!;
  let qa = s.qa?.reqId === req.reqId ? s.qa : freshQa(req.reqId, qs.length);
  const q = qs[qa.at];
  const rows = q.options.length + 1; // the last row is "type your own"
  const focusOther = () => setTimeout(() => document.getElementById(`qa-other-${qa.at}`)?.focus(), 0);
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  if (digit) {
    const n = Number(digit[1]) - 1;
    const opt = q.options[n];
    if (opt) {
      qa = { ...pick(qa, q, qa.at, opt.label), hl: n };
      const next = firstOpen(qa, qs);
      if (!q.multiSelect && next >= 0) qa = goTo(qa, next, qs.length);
      set({ qa });
    }
    return true;
  }
  switch (e.key) {
    case 'ArrowDown': set({ qa: { ...qa, hl: Math.min(rows - 1, qa.hl + 1) } }); return true;
    case 'ArrowUp': set({ qa: { ...qa, hl: Math.max(0, qa.hl - 1) } }); return true;
    case 'ArrowRight': set({ qa: goTo(qa, qa.at + 1, qs.length) }); return true;
    case 'ArrowLeft': set({ qa: goTo(qa, qa.at - 1, qs.length) }); return true;
    case ' ':
      if (qa.hl >= rows - 1) { set({ qa }); focusOther(); } else set({ qa: pick(qa, q, qa.at, q.options[qa.hl].label) });
      return true;
    case 'Enter': {
      const r = enterOnRow(qa, qs);
      set({ qa: r.state });
      if (r.then === 'send') submitAnswers();
      else if (r.then === 'other') focusOther();
      return true;
    }
    case 'o': case 'O': set({ qa }); focusOther(); return true;
    case 'n': case 'N': if (respondPermission('deny')) set({ qa: null }); return true;
  }
  return false;
}

/** Shift+Tab: asks first → accepts edits → plan first, as in Claude Code. */
export function cycleMode(id: string | null): void {
  if (!id) return;
  const mode = nextMode(sessionById(id)?.mode);
  send({ type: 'session.mode', id, mode });
  flash(`${MODE_LABEL[mode].name}: ${MODE_LABEL[mode].hint}`);
}

/** Claude is mid-turn (including waiting on an approval): Esc stops it, like in Claude Code. */
function isBusy(id: string | null): boolean {
  const status = sessionById(id)?.status;
  return status === 'running' || status === 'requires_action';
}

export function interrupt(id: string | null): void {
  if (!id || !isBusy(id)) return;
  send({ type: 'session.interrupt', id });
  flash('Stopped');
}

export function askStop(id: string | null): void {
  if (sessionById(id)?.live) set({ modal: { kind: 'stop', id: id! } });
}

export function newSession(repo?: string): void {
  const ws = currentWorkspace(get());
  set({ modal: { kind: 'new', workspaceId: ws?.id ?? null, repo } });
}

export function cycleTheme(): void {
  const theme = nextTheme(get().theme);
  applyTheme(theme);
  set({ theme });
  flash(THEME_LABEL[theme]);
}

/** Alt+N: open the next session that needs you, cycling past the one already open. */
export function jumpToAttention(): void {
  const s = get();
  const list = attention(s);
  if (!list.length) { flash('Nothing needs you'); return; }
  const i = list.findIndex((x) => x.id === s.openId);
  const next = list[(i + 1) % list.length].id;
  if (isDocked(s)) dockSession(next);
  else openSession(next);
}

/** Alt+↑ / Alt+↓: previous / next session in the sessions column. */
export function hop(delta: number): void {
  const s = get();
  const list = visibleSessions(s);
  if (!list.length) return;
  const current = activeSession(s) ?? s.selectedId;
  const i = list.findIndex((x) => x.id === current);
  // Not in this list (e.g. filtered out): start from the matching end.
  const from = i < 0 ? (delta > 0 ? -1 : list.length) : i;
  const next = list[(from + delta + list.length) % list.length];
  if (s.screen === 'session') openSession(next.id);
  else if (isDocked(s)) dockSession(next.id);
  else selectSession(next.id);
}

function selectSession(id: string): void {
  set({ selectedId: id });
  document.getElementById(`row-${id}`)?.scrollIntoView({ block: 'nearest' });
}

function moveSelection(delta: number | 'first' | 'last'): void {
  const list = visibleSessions(get());
  if (!list.length) return;
  const i = list.findIndex((s) => s.id === get().selectedId);
  const next = delta === 'first' ? 0 : delta === 'last' ? list.length - 1 : Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta));
  selectSession(list[next].id);
}

function moveScope(delta: number): void {
  const s = get();
  const list = scopes(s);
  const i = Math.max(0, list.findIndex((x) => sameScope(x, s.scope)));
  setScope(list[Math.min(list.length - 1, Math.max(0, i + delta))]);
}

/** 1–9 pick workspace N, 0 picks "everything else". */
function scopeByDigit(n: number): void {
  const s = get();
  if (n === 0) { setScope({ kind: 'rest' }); return; }
  const w = s.workspaces[n - 1];
  if (w) setScope({ kind: 'workspace', id: w.id });
  else flash(s.workspaces.length ? `There is no workspace ${n}` : 'No workspaces yet. Press W to make one.');
}

/** The selected session, but only if the column actually shows it. Keys must never act on a hidden row. */
function visibleSelection(): string | null {
  const s = get();
  return visibleSessions(s).some((x) => x.id === s.selectedId) ? s.selectedId : null;
}

function removeRepoFromWorkspace(): void {
  const ws = currentWorkspace(get());
  if (ws) set({ modal: { kind: 'repoRemove', target: { kind: 'workspace', id: ws.id } } });
  else flash('Pick a workspace first (1–9)');
}

function addRepoToWorkspace(): void {
  const ws = currentWorkspace(get());
  if (ws) set({ modal: { kind: 'repoPicker', target: { kind: 'workspace', id: ws.id } } });
  else set({ modal: { kind: 'workspace', id: null } });
}

// ---- Home -------------------------------------------------------------------------------

/** Columns shown at this window width (the docked session needs 1024px, workspaces and the library 768px). */
export function shownCols(): HomeCol[] {
  const wide = (px: number) => typeof matchMedia === 'undefined' || matchMedia(`(min-width: ${px}px)`).matches;
  return HOME_COLS.filter((c) => (c === 'preview' ? wide(1024) : c === 'workspaces' ? wide(768) : true));
}
const libraryShown = () => typeof matchMedia === 'undefined' || matchMedia('(min-width: 768px)').matches;

function moveCol(delta: number): void {
  const col = get().homeCol;
  const cols = shownCols();
  const i = Math.max(0, cols.indexOf(col === 'library' ? 'sessions' : col));
  const to = cols[Math.min(cols.length - 1, Math.max(0, i + delta))];
  if (to !== 'preview') { set({ homeCol: to }); return; }
  // → into the session beside the list steps into it (its message box).
  const id = visibleSelection();
  if (id) dockSession(id);
}

function libraryKeys(e: KeyboardEvent): boolean {
  const s = get();
  const repos = s.library.repos;
  const repo = repos[Math.min(s.libIndex, repos.length - 1)];
  switch (e.key) {
    case 'ArrowLeft': set({ libIndex: Math.max(0, s.libIndex - 1) }); return true;
    case 'ArrowRight': set({ libIndex: Math.max(0, Math.min(repos.length - 1, s.libIndex + 1)) }); return true;
    case 'ArrowUp': case 'Escape': set({ homeCol: 'sessions' }); return true;
    case 'Home': set({ libIndex: 0 }); return true;
    case 'End': set({ libIndex: Math.max(0, repos.length - 1) }); return true;
    case 'Enter': case '+': case '=': {
      if (!repo) { set({ modal: { kind: 'sources' } }); return true; }
      const ws = currentWorkspace(s);
      if (!ws) { flash('Pick a workspace first (1–9), or press W to make one'); return true; }
      send({ type: 'workspace.addRepo', id: ws.id, path: repo.path });
      flash(`Added ${repo.name} to ${ws.name}`);
      return true;
    }
  }
  switch (e.key.toLowerCase()) {
    case 'n': if (repo) newSession(repo.path); return true;
    case 'f': set({ modal: { kind: 'sources' } }); return true;
    case 'c':
      toggleFold('library');
      // A folded library shows while you are in it, so folding it also steps back out to the sessions.
      if (get().folds.library) { set({ homeCol: 'sessions' }); flash('Repo library folded: Tab opens it'); }
      else flash('Repo library stays open');
      return true;
  }
  return false;
}

function homeKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  const selected = visibleSelection();
  if (typing) {
    // The filter box: arrows and Enter still drive the list.
    switch (e.key) {
      case 'ArrowUp': moveSelection(-1); return true;
      case 'ArrowDown': moveSelection(1); return true;
      case 'Enter': if (selected) dockSession(selected); return true;
      case 'Escape': set({ filter: '', filterFocused: false }); return true;
    }
    return false;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  if (e.key === 'Tab') { set({ homeCol: s.homeCol === 'library' || !libraryShown() ? 'sessions' : 'library' }); return true; }
  if (s.homeCol === 'library') return libraryKeys(e);

  const digit = /^(Digit|Numpad)(\d)$/.exec(e.code);
  if (digit && !e.shiftKey) { scopeByDigit(Number(digit[2])); return true; }

  // A column hidden at this width (the window shrank), or the session pane once its session is
  // gone (ended from a dialog), acts as the sessions column. A docked session has its own keys.
  const col: HomeCol = shownCols().includes(s.homeCol) && s.homeCol !== 'preview' ? s.homeCol : 'sessions';
  switch (e.key) {
    case 'ArrowLeft': moveCol(-1); return true;
    case 'ArrowRight': moveCol(1); return true;
    case 'ArrowUp': if (col === 'workspaces') moveScope(-1); else moveSelection(-1); return true;
    case 'ArrowDown': if (col === 'workspaces') moveScope(1); else moveSelection(1); return true;
    case 'Home': if (col === 'workspaces') moveScope(-99); else moveSelection('first'); return true;
    case 'End': if (col === 'workspaces') moveScope(99); else moveSelection('last'); return true;
    case 'Enter':
      if (col === 'workspaces') set({ homeCol: 'sessions' });
      else if (selected) dockSession(selected);
      return true;
    case 'Escape':
      if (s.filter) set({ filter: '' });
      else if (col !== 'sessions') set({ homeCol: 'sessions' });
      return true;
    case '/': set({ filterFocused: true, homeCol: 'sessions' }); return true;
    case '+': case '=': addRepoToWorkspace(); return true;
    case '-': removeRepoFromWorkspace(); return true;
    case 'Delete':
      if (col === 'workspaces' && s.scope.kind === 'workspace') set({ modal: { kind: 'deleteWorkspace', id: s.scope.id } });
      return true;
  }
  if (col === 'workspaces' && e.shiftKey) {
    if (e.key === 'E' && s.scope.kind === 'workspace') { exportWorkspace(s.scope.id); return true; }
    if (e.key === 'I') { importWorkspace(); return true; }
  }
  if (e.key === 'C') { unfoldAllBuckets(); return true; }
  if (e.key === 'c') {
    if (col === 'workspaces') toggleFold('workspaces');
    else if (col === 'sessions') {
      const bucket = bucketOfSelected();
      if (bucket && selected) { toggleBucket(bucket); flash(`${BUCKET_TITLE[bucket]} folded: Shift+C opens every group`); }
      else flash('Shift+C opens every group');
    }
    return true;
  }
  switch (e.key.toLowerCase()) {
    case 'n': newSession(); return true;
    case 'w': set({ modal: { kind: 'workspace', id: null } }); return true;
    case 'e':
      if (col === 'workspaces' && s.scope.kind === 'workspace') set({ modal: { kind: 'workspace', id: s.scope.id } });
      return true;
    case 'r': if (selected) set({ modal: { kind: 'rename', id: selected } }); return true;
    case 'x': askStop(selected); return true;
  }
  return false;
}

// ---- Session: number pad ------------------------------------------------------------------

// The pad is laid out like a numpad: 7 8 9 / 4 5 6 / 1 2 3.
const GRID = [[7, 8, 9], [4, 5, 6], [1, 2, 3]];
const ARROWS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

function neighbour(slot: number, key: string): number {
  const row = GRID.findIndex((r) => r.includes(slot));
  const col = GRID[row].indexOf(slot);
  const [dr, dc] = ARROWS[key];
  return GRID[Math.min(2, Math.max(0, row + dr))][Math.min(2, Math.max(0, col + dc))];
}

function focusedTile() {
  const s = get();
  const { group } = currentGroup(s);
  const command = group?.commands.find((c) => c.slot === s.boardSlot);
  return { s, group, command, editable: group && group.scope !== 'auto' ? group : null };
}

function boardKeys(e: KeyboardEvent): boolean {
  const { s, group, command, editable } = focusedTile();
  if (e.key in ARROWS && !e.altKey && !e.metaKey) {
    const target = neighbour(s.boardSlot, e.key);
    if (e.ctrlKey) {
      if (!editable || !command || target === s.boardSlot) return true;
      const scope = editable.scope as 'workspace' | 'global' | 'repo';
      send({ type: 'command.swap', ref: { scope, cwd: sessionById(s.openId)?.cwd, workspaceId: editable.workspaceId, group: editable.name, slot: s.boardSlot }, otherSlot: target });
    }
    set({ boardSlot: target });
    return true;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  // On the pad nothing is being typed, so the top-row digits run workflows too (laptops without a numpad).
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && !e.shiftKey) { set({ boardSlot: Number(digit[1]) }); fireSlot(Number(digit[1])); return true; }
  switch (e.key) {
    case 'Enter': fireSlot(s.boardSlot); return true;
    case '[': cycleGroup(-1); return true;
    case ']': cycleGroup(1); return true;
    case 'E': exportPack(); return true;
    case 'I': importPack(); return true;
    case 'e': set({ modal: { kind: 'edit', group, slot: s.boardSlot } }); return true;
    case 'Delete':
    case 'Backspace':
      if (editable && command) set({ modal: { kind: 'delete', group: editable, slot: s.boardSlot } });
      return true;
  }
  return false;
}

/** Approval details (raw command) toggle, read by the card. */
export const approvalDetails = { open: false, listeners: new Set<() => void>() };
function toggleDetails(): void {
  approvalDetails.open = !approvalDetails.open;
  approvalDetails.listeners.forEach((l) => l());
}

function sessionKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey) { cycleMode(s.openId); return true; }
  if (s.zone === 'composer') {
    if (e.key === 'Escape') {
      if (isBusy(s.openId)) interrupt(s.openId);
      // Beside the list, the pad is a rail: Esc goes straight back to the list.
      else if (isDocked(s)) backToList();
      else set({ zone: 'board' });
      return true;
    }
    // Tab reaches the number pad and any approval card without stopping Claude.
    if (e.key === 'Tab' && !e.shiftKey) { set({ zone: 'board' }); return true; }
    return false; // Enter/Shift+Enter live on the composer itself
  }
  if (typing) return false;
  if (boardKeys(e)) return true;
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  switch (e.key) {
    case 'Escape':
      if (isBusy(s.openId)) interrupt(s.openId);
      else backToList();
      return true;
    case 'PageUp': scrollTranscript(-window.innerHeight * 0.8); return true;
    case 'PageDown': scrollTranscript(window.innerHeight * 0.8); return true;
    case 'Home': scrollTranscript('top'); return true;
    case 'End': scrollTranscript('bottom'); return true;
    case '+': case '=': if (s.openId) set({ modal: { kind: 'repoPicker', target: { kind: 'session', id: s.openId } } }); return true;
    case '-': if (s.openId) set({ modal: { kind: 'repoRemove', target: { kind: 'session', id: s.openId } } }); return true;
  }
  switch (e.key.toLowerCase()) {
    case 'i': set({ zone: 'composer' }); return true;
    case 't': set({ expandTools: !s.expandTools }); return true;
    case 'l': toggleFold('todos'); return true;
    case 'c':
      if (isDocked(s)) {
        // Like the repo library: a folded pane opens while you are in it, so folding it steps out.
        toggleFold('dock');
        if (get().folds.dock) { backToList(); flash('Session pane folded: → or Enter opens it'); }
        else flash('Session pane stays open beside the list');
        return true;
      }
      toggleFold('pad');
      flash(get().folds.pad ? 'Number pad folded: Tab opens it' : 'Number pad stays open');
      return true;
    case 'y': return respondPermission('allow');
    case 'a': return respondPermission('always');
    case 'n': return respondPermission('deny');
    case 'd': if (pendingFor(s.openId)) { toggleDetails(); return true; } return false;
    case 'r': if (s.openId) set({ modal: { kind: 'rename', id: s.openId } }); return true;
    case 'x': askStop(s.openId); return true;
  }
  return false;
}

function scrollTranscript(by: number | 'top' | 'bottom'): void {
  const el = document.getElementById('transcript');
  if (!el) return;
  if (by === 'top') el.scrollTop = 0;
  else if (by === 'bottom') el.scrollTop = el.scrollHeight;
  else el.scrollBy({ top: by });
}

// ---- Voice, numpad, global ----------------------------------------------------------------

const isPushToTalk = (e: KeyboardEvent) => {
  const combo = comboOf(e);
  return combo !== null && actionFor(combo, get().settings.bindings ?? {}) === 'pushToTalk';
};
/** Physical key that started push-to-talk; its keyup ends it even if modifiers were released first. */
let pttCode: string | null = null;

/** Push-to-talk keydown. Same rule as the numpad: voice keys type normally once you've started a message. */
function voiceKeys(e: KeyboardEvent): boolean {
  if (isListening()) {
    if (e.key === 'Escape') { cancelVoice(); return true; }
    return isPushToTalk(e); // swallow auto-repeat of the held key
  }
  const s = get();
  if (!isPushToTalk(e) || !activeSession(s) || !s.openId || e.repeat) return false;
  if (s.zone === 'composer' && (s.drafts[s.openId] ?? '').length > 0) return false;
  pttCode = e.code;
  startVoice(s.openId);
  return true;
}

export function onKeyUp(e: KeyboardEvent): void {
  if (isListening() && e.code === pttCode) {
    pttCode = null;
    stopVoice();
    e.preventDefault();
  }
}

/**
 * Numpad and Alt+digit workflow keys in the session view. The numpad acts on the pad
 * unless you're mid-message in the composer, so digits can still be typed there.
 */
function commandKeys(e: KeyboardEvent): boolean {
  const s = get();
  if (!activeSession(s) || !s.openId) return false;
  const digit = /^Digit([0-9])$/.exec(e.code);
  if (e.altKey && !e.ctrlKey && !e.shiftKey && digit) {
    // Alt + the number row mirrors the whole pad: 1–9 run workflows, 0 goes home like Numpad 0.
    if (digit[1] === '0') { backToList(); return true; }
    set({ boardSlot: Number(digit[1]) });
    fireSlot(Number(digit[1]));
    return true;
  }
  if (!e.code.startsWith('Numpad') || e.ctrlKey || e.altKey || e.metaKey) return false;
  if (s.zone === 'composer' && (s.drafts[s.openId] ?? '').length > 0) return false;
  const pad = /^Numpad([1-9])$/.exec(e.code);
  if (pad) {
    set({ boardSlot: Number(pad[1]) });
    fireSlot(Number(pad[1]));
    return true;
  }
  switch (e.code) {
    case 'Numpad0': backToList(); return true;
    case 'NumpadAdd': cycleGroup(1); return true;
    case 'NumpadSubtract': cycleGroup(-1); return true;
    case 'NumpadDivide': set({ zone: 'composer' }); return true;
    case 'NumpadMultiply': set({ modal: { kind: 'palette' } }); return true;
  }
  return false;
}

/** Rebindable shortcuts (see bindings.ts). Actions without a modifier don't fire inside text fields. */
function globalAction(e: KeyboardEvent, typing: boolean): boolean {
  const combo = comboOf(e);
  const id = combo ? actionFor(combo, get().settings.bindings ?? {}) : null;
  if (!id || id === 'pushToTalk') return false;
  if (typing && !ACTIONS.find((a) => a.id === id)!.inText) return false;
  const openId = activeSession(get());
  switch (id) {
    case 'palette': set({ modal: { kind: 'palette' } }); break;
    case 'help': set({ modal: { kind: 'help' } }); break;
    case 'nextAttention': jumpToAttention(); break;
    case 'prevSession': hop(-1); break;
    case 'nextSession': hop(1); break;
    case 'newSession': newSession(); break;
    case 'expand': toggleExpand(); break;
    case 'interrupt': interrupt(openId); break;
    case 'background': if (openId) send({ type: 'session.background', id: openId }); break;
    case 'sound': toggleSound(); break;
    case 'theme': cycleTheme(); break;
  }
  return true;
}

/** Dialogs that read keys from a focused field, not the window (those handle Esc themselves). */
const INPUT_DIALOGS = new Set(['sources', 'repoPicker', 'workspace', 'new', 'rename', 'palette']);

export function onKeyDown(e: KeyboardEvent): void {
  if (e.isComposing) return;
  // A dialog that handles a key may close itself before the event bubbles here; never let that
  // same keypress act on the screen underneath (Enter would fire a key, Esc would leave the session).
  if (e.target instanceof Element && e.target.closest('[role=dialog]')) return;
  const s = get();
  if (s.modal && INPUT_DIALOGS.has(s.modal.kind) && e.key === 'Escape') {
    // Focus fell out of a dialog whose keys live on its inputs (a focused row was removed, say): Esc must still close it.
    set({ modal: null });
    e.preventDefault();
    return;
  }
  if (s.modal) {
    // Dialogs own their keys; help closes on Esc or ?.
    if (s.modal.kind === 'help') {
      const combo = comboOf(e);
      if (e.key === 'Escape' || (combo && actionFor(combo, s.settings.bindings ?? {}) === 'help')) set({ modal: null });
      else if (e.code === 'KeyB' && !e.ctrlKey && !e.altKey) set({ modal: { kind: 'bindings' } });
      else return;
      e.preventDefault();
    }
    return;
  }
  const typing = isTextTarget(e.target);
  let handled = false;
  if (voiceKeys(e)) handled = true;
  else if (globalAction(e, typing)) handled = true;
  else if (cardKeys(e, typing)) handled = true;
  else if (commandKeys(e)) handled = true;
  else if (activeSession(s)) handled = sessionKeys(e, typing);
  else handled = homeKeys(e, typing);
  if (handled) e.preventDefault();
}
