// Keys on the Ticket Line, the home page: the board, a card's drawer and the new-card screen, plus the workspace keys that used to live on Home. keys.ts routes here
// while the line is on screen, before the global shortcuts, so Ctrl+Enter starts work instead of
// expanding a session. Every key here has a row in LINE_SECTIONS (the ? overlay) and in
// lineLegendFor (the bar at the bottom).

import { askOf, cardRepos, ownFolders, waiting } from '../shared/cards.ts';
import { cardRecipe, wsRecipeKey } from '../shared/recipes.ts';
import type { StackChoice } from '../shared/stack.ts';
import { repoName } from '../shared/workspaces.ts';
import { inbox, INBOX_VIEWS, type Ticket } from '../shared/tickets.ts';
import { exportWorkspace, importWorkspace } from './commands.ts';
import { openSession } from './keys.ts';
import { closeComposer, currentWorkspace, flash, get, set, setFilter, setInboxView, takeDraft, type WorkspaceAction } from './store.ts';
import {
  addComposer, additionOf, cardFolders, stepCard, cardHasRepo, composerKey, cycleKind, cycleModel, draftOf, nextTab, dropTicket, focusedTicket, goRows, keepForWorkspace, lanes, lineSessions, moveFocus, newComposer, packetRows, PANES, pickTicket,
  sources, stepOption, ticketFocus, ticketSources, togglePacketRow, toggleSource,
  type Composer,
} from './line-model.ts';
import { addCardContext, answerCard, focusCardTab, sayToCard, send, startCard, tryCard } from './ws.ts';

export const LINE_SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Ticket Line',
    keys: [
      ['← → ↑ ↓', 'Move between cards'],
      ['Enter', 'Open the card full screen: Overview, Context (how it started, what Claude was given), and its live Transcript beside them'],
      ['n / Enter (a ticket in the Inbox)', 'Start work on it: the new-card screen, with the ticket as its context'],
      ['v', 'Inbox: your tickets, or every ticket Ready for QA in your projects'],
      ['Delete (a ticket in the Inbox)', 'Hide it from the Inbox (nothing changes in Jira or Trello; Shift+T shows it again)'],
      ['Shift+T', 'Tickets: demo tickets (D), Jira and Trello (R refreshes), which workspace each project goes to, and tickets you hid'],
      ['Ctrl+Enter', 'The card’s session in the app, to read along (Esc comes back; typing here forks it, the terminal tab is where you answer)'],
      ['c', 'New card: build its context and start work in a terminal tab. A card you left half-built (Esc, Alt+L) is picked up again; Shift+C starts a fresh one'],
      ['1–9  /  0', 'Show one workspace’s cards / all of them'],
      ['/', 'Filter the cards by words'],
      ['Tab (card open)', 'Overview or Context (on a narrow window, Transcript too)'],
      ['Esc (card open)', 'Back to the board, the card still focused; on the board, clear the filter'],
      ['← → (card open)', 'The previous / next card on the board, in column order'],
      ['Enter (card open)', 'Type to its terminal: the message box under the transcript sends into the session itself (Esc leaves the box)'],
      ['y / n (card open)', 'Allow or deny what Claude is asking to do (a plan to approve counts), straight to its terminal'],
      ['g (a card)', 'Go to its terminal tab: brings the Windows Terminal tab forward, for what the page can’t relay (the trust-the-folder prompt, a picker)'],
      ['Shift+D (a card)', 'Changes: what it changed as git sees it, file by file with the diffs (↑ ↓ file, s ships from there)'],
      ['c (card open)', 'Add context: repos, tickets or a note wait on the card and go in with your next message in its tab'],
      ['x (card open)', 'Take back the last thing still waiting on the card'],
      ['t (a card)', 'Try it: run its repo’s recipe in the card’s folder; again stops the app. With a workspace stack, pick the environment and the APIs first. A workspace with no stack yet: what its repos say the stack is (okteto.yml, angular.json, the proxy file), Enter keeps it, e edits it first'],
      ['t picker: ← →  /  ↑ ↓ Space  /  a n  /  Enter', 'Environment (dev, uat …)  /  which APIs run (changed ones are ticked)  /  all or none  /  start them, then the UI'],
      ['o (a card)', 'Open the app its run is serving; with nothing running, its pull request'],
      ['e (a card)', 'Write or edit the run recipe (Alt+W in the editor: for the card’s repo, the whole workspace, or the workspace’s stack of APIs and UI)'],
      ['s (a card)', 'Ship: commit the files you tick, push, and open a PR written from the ticket; on a card in Ship, merge it. On a QA or review card: its report (Enter copies, j posts it on the Jira ticket and m moves the ticket, each after you confirm; o opens the PR, d moves the card to Done)'],
      ['d (a card in Ship)', 'Done: the PR was merged or closed by hand, or the host isn’t one Ship can follow'],
      ['Shift+X (a card)', 'Worktrees: the folders the card made, with what each still holds; on a Done card, remove them and their branch (Enter the clean ones, f all of them)'],
      ['Delete', 'Take the card off the line (its terminal session keeps running); w there removes its worktrees too'],
    ],
  },
  {
    title: 'Workspaces (Ticket Line)',
    keys: [
      ['W', 'New workspace'],
      ['E (or e with no card focused)', 'Edit the workspace shown (with All showing, pick which)'],
      ['+ / −', 'Add a repo from the library to the workspace shown / remove one (every card and session in it can use them all)'],
      ['F', 'Choose the folders the repo library lists'],
      ['Shift+E / Shift+I', 'Share the workspace as a file / import one'],
      ['Shift+Delete', 'Delete the workspace shown (its repos and sessions stay)'],
    ],
  },
  {
    title: 'New card',
    keys: [
      ['Tab / Shift+Tab', 'Next / previous panel: add context → what Claude will know → how it starts'],
      ['↑ ↓', 'Move in the panel'],
      ['← → (add context)', 'Tickets, Repos or Folders'],
      ['Enter (Folders)', 'Add any folder on disk as context (it goes in with --add-dir); Space on one takes it out'],
      ['Space', 'Pick a ticket (the first is the card’s, later ones are related) or a repo; include or leave out a line of the context'],
      ['/', 'Search the tickets (by key or words; Jira is searched too, for anyone’s ticket) or the repo library'],
      ['k', 'Kind of work: Develop, QA (test someone’s change) or Code review'],
      ['x', 'Remove something you added to this card (on the card’s ticket: take it off)'],
      ['w (what Claude will know)', 'Keep a repo you added to this card for the whole workspace'],
      ['e', 'Write your own note for Claude'],
      ['← → (how it starts)', 'Change the option: workspace, the repo it starts in, branch, mode, model'],
      ['m', 'Change the model: your default, Opus, Sonnet or Haiku'],
      ['p', 'Preview exactly what Claude gets'],
      ['Ctrl+Enter', 'Start work (also while typing); adding to a running card, add it'],
      ['Esc', 'Leave the text field, then cancel'],
    ],
  },
];

/** The Inbox: tickets no card has started, in the workspace shown. */
export function inboxOf(s: ReturnType<typeof get>): Ticket[] {
  return inbox(s.tickets, new Set(s.cards.map((c) => c.key)), s.line.filter, s.line.view);
}

/** v: the Inbox's other view. The focus moves to the first card or ticket it shows. */
export function switchInbox(): void {
  const s = get();
  const at = INBOX_VIEWS.findIndex((v) => v.id === s.line.view);
  const next = INBOX_VIEWS[(at + 1) % INBOX_VIEWS.length];
  setInboxView(next.id);
  set({ line: { ...get().line, focus: moveFocus(boardOf(get()), null, 1, 0) } });
  flash(`Inbox: ${next.name}`);
}

/** The board's columns, with the Inbox's tickets. */
export function boardOf(s: ReturnType<typeof get>) {
  return lanes(s.cards, s.line.filter, s.line.q, inboxOf(s));
}

export function openLine(): void {
  const s = get();
  const cols = boardOf(s);
  const known = cols.some((l) => l.cards.some((c) => c.id === s.line.focus) || l.tickets.some((t) => ticketFocus(t.key) === s.line.focus));
  const focus = known ? s.line.focus : moveFocus(cols, null, 1, 0);
  set({ screen: 'line', line: { ...s.line, focus }, modal: null });
}

/**
 * Home: the board, from anywhere. Leaves a session, closes the card that is open, the new-card
 * screen (its draft is dropped, as Esc drops it) and any dialog; the workspace shown and the
 * card focused stay as they were. The logo and Alt+L (rebindable) do this.
 */
export function goHome(): void {
  const s = get();
  const kept = closeComposer();
  set({ openId: null, modal: null, line: { ...s.line, drawer: null, searching: false } });
  openLine();
  if (kept) flash('Kept the card you were building · c picks it up again');
}

/** The cards' sessions, in column order (what Alt+↑ ↓ walk from a session). Ctrl+K finds any other session. */
export function lineSessionIds(): string[] {
  const s = get();
  return lineSessions(lanes(s.cards, s.line.filter, s.line.q));
}

/** The expand key on the line: the focused card's session full screen. */
export function expandFromLine(): void {
  const s = get();
  if (s.screen !== 'line' || s.composer) return;
  const id = s.line.drawer ?? s.line.focus;
  const card = s.cards.find((c) => c.id === id);
  if (focusedTicket(id)) { flash(`${focusedTicket(id)} has no session yet: n starts work on it`); return; }
  if (!card) { flash('Pick a card first'); return; }
  if (!card.sessionId) { flash(`${card.key} has no session yet: it links once its terminal tab starts`); return; }
  openSession(card.sessionId);
}

/** The workspace keys: act on the workspace shown, or with All showing, ask which. */
export function workspaceKey(then: WorkspaceAction): void {
  const s = get();
  const ws = currentWorkspace(s);
  if (ws) { runWorkspaceAction(then, ws.id); return; }
  if (!s.workspaces.length) {
    if (then === 'addRepo') set({ modal: { kind: 'workspace', id: null } });
    else flash('No workspaces yet. W makes one.');
    return;
  }
  if (s.workspaces.length === 1) { runWorkspaceAction(then, s.workspaces[0].id); return; }
  set({ modal: { kind: 'pickWorkspace', then } });
}

export function runWorkspaceAction(then: WorkspaceAction, id: string): void {
  const ws = get().workspaces.find((w) => w.id === id);
  if (!ws) return;
  switch (then) {
    case 'addRepo': set({ modal: { kind: 'repoPicker', target: { kind: 'workspace', id } } }); return;
    case 'removeRepo':
      if (ws.repos.length) set({ modal: { kind: 'repoRemove', target: { kind: 'workspace', id } } });
      else { set({ modal: null }); flash(`${ws.name} has no repos yet. + adds one.`); }
      return;
    case 'edit': set({ modal: { kind: 'workspace', id } }); return;
    case 'share': set({ modal: null }); exportWorkspace(id); return;
    case 'delete': set({ modal: { kind: 'deleteWorkspace', id } }); return;
  }
}

/**
 * The new-card screen: blank (c), or for a ticket (n on it in the Inbox), in its project's workspace.
 * c with a card you left half-built picks that up instead (Shift+C starts fresh, keeping it).
 */
export function openComposer(ticket: Ticket | null = null, fresh = false): void {
  const s = get();
  if (!ticket && !fresh && s.draft) {
    const d = takeDraft()!;
    set({ composer: d, line: { ...s.line, drawer: null } });
    flash(`Picked up the card you were building${d.ticket ? ` (${d.ticket.key})` : ''} · Shift+C starts a fresh one`);
    return;
  }
  const mapped = ticket?.workspaceId ? s.workspaces.find((w) => w.id === ticket.workspaceId) : undefined;
  const ws = mapped ?? (s.line.filter !== 'all' ? s.workspaces.find((w) => w.id === s.line.filter) ?? null : s.workspaces[0] ?? null);
  set({ composer: newComposer(ws, s.nextKey, ticket, s.recipes), line: { ...s.line, drawer: null } });
  if (!ticket) setTimeout(() => document.getElementById('cp-title')?.focus(), 0);
}

/** Esc (or the Cancel button) on the new-card screen: a card with work on it is kept for c. */
export function leaveComposer(): void {
  const c = get().composer;
  if (!c) return;
  if (c.addTo) { set({ composer: null }); return; }
  const kept = closeComposer();
  if (kept) flash('Kept the card you were building · c picks it up again, Shift+C starts fresh');
}

/** c in a card's drawer: the new-card screen, adding to that card. Esc goes back to the drawer. */
export function openAddComposer(id: string): void {
  const s = get();
  const card = s.cards.find((c) => c.id === id);
  if (!card) return;
  if (card.stage === 'done') { flash(`${card.key} is done`); return; }
  set({ composer: addComposer(card, s.tickets) });
}

export function updateComposer(change: (c: Composer) => Composer | string): void {
  const c = get().composer;
  if (!c) return;
  const next = change(c);
  if (typeof next === 'string') flash(next);
  else set({ composer: { ...next, error: null } });
}

export function startWork(): void {
  const c = get().composer;
  if (!c || c.starting) return;
  if (c.addTo) { addToCard(c); return; }
  const draft = draftOf(c);
  if (typeof draft === 'string') {
    set({ composer: { ...c, error: draft } });
    if (!c.title.trim()) document.getElementById('cp-title')?.focus();
    return;
  }
  set({ composer: { ...c, starting: true, error: null } });
  startCard(draft).then(
    (id) => {
      set({ composer: null, line: { ...get().line, focus: id, drawer: id, tab: 'ctx' } });
      flash('Started in a terminal tab');
    },
    (e: Error) => {
      const now = get().composer;
      if (now) set({ composer: { ...now, starting: false, error: e.message } });
    },
  );
}

/** Ctrl+Enter when adding to a running card: it waits on the card, and the drawer shows it under Added since. */
function addToCard(c: Composer): void {
  const add = additionOf(c);
  if (typeof add === 'string') { set({ composer: { ...c, error: add } }); return; }
  const { id, key } = c.addTo!;
  set({ composer: { ...c, starting: true, error: null } });
  addCardContext(id, add.items, add.note).then(
    () => {
      set({ composer: null, line: { ...get().line, focus: id, drawer: id, tab: 'ctx' } });
      setTimeout(() => document.getElementById('added-since')?.scrollIntoView({ block: 'nearest' }), 0);
      const card = get().cards.find((x) => x.id === id);
      flash(card?.sessionId ? `Waiting on ${key}: it goes in with your next message in its tab` : `Waiting on ${key}: it goes in when the session starts`);
    },
    (e: Error) => {
      const now = get().composer;
      if (now) set({ composer: { ...now, starting: false, error: e.message } });
    },
  );
}

/** x in a card's drawer: take back the latest thing still waiting on it. */
export function withdrawLast(id: string): void {
  const card = get().cards.find((c) => c.id === id);
  const last = card && waiting(card).at(-1);
  if (!last) { flash('Nothing is waiting on this card'); return; }
  send({ type: 'card.withdraw', id, itemId: last.id });
  flash(`Took back: ${last.label}`);
}

/** Is the card's app running (or still starting)? Then t stops it. */
export function running(id: string): boolean {
  const r = get().runs[id];
  return r?.state === 'running' || r?.state === 'up';
}

/** t: run the card's recipe, or stop the app when it is running. The drawer opens on Overview to show it. */
export function tryIt(id: string): void {
  const s = get();
  const card = s.cards.find((c) => c.id === id);
  if (!card) return;
  if (running(id)) { send({ type: 'card.stopRun', id }); flash(`Stopped ${card.key}’s app`); return; }
  const home = cardRepos(card)[0];
  set({ line: { ...s.line, focus: id, drawer: id, tab: 'over' } });
  const recipe = cardRecipe(s.recipes, card.workspaceId, home);
  // A workspace of several repos with no recipe or stack of its own: what its repos say the stack is, to keep with one key (§54).
  const wsRepos = s.workspaces.find((w) => w.id === card.workspaceId)?.repos.length ?? 0;
  if (card.workspaceId && !s.recipes[wsRecipeKey(card.workspaceId)] && wsRepos > 1) { set({ modal: { kind: 'tryPick', id, detect: true } }); return; }
  if (!recipe) { flash(`No run recipe for ${home ? repoName(home) : card.key} yet: e writes one`); return; }
  // A stack asks first: which environment, which APIs.
  if (recipe.stack) { set({ modal: { kind: 'tryPick', id } }); return; }
  tryCard(id).then(() => {
    setTimeout(() => document.getElementById('try-it')?.scrollIntoView({ block: 'nearest' }), 0);
  }, (e: Error) => flash(e.message));
}

/** Start a card's stack with what the picker chose, and remember the pick for next time. */
export function tryStack(id: string, choice: StackChoice): void {
  rememberPick(id, choice);
  set({ modal: null });
  tryCard(id, choice).then(() => {
    setTimeout(() => document.getElementById('try-it')?.scrollIntoView({ block: 'nearest' }), 0);
  }, (e: Error) => flash(e.message));
}

const PICK_KEY = 'cc-control.stackPick';

/** What was picked last time for this card, if anything (this browser only). */
export function lastPick(id: string): StackChoice | undefined {
  try { return (JSON.parse(localStorage.getItem(PICK_KEY) ?? '{}') as Record<string, StackChoice>)[id]; } catch { return undefined; }
}

function rememberPick(id: string, choice: StackChoice): void {
  try {
    const all = JSON.parse(localStorage.getItem(PICK_KEY) ?? '{}') as Record<string, StackChoice>;
    all[id] = choice;
    // Only the most recent cards: an old card's pick doesn't matter.
    const keep = Object.fromEntries(Object.entries(all).slice(-50));
    localStorage.setItem(PICK_KEY, JSON.stringify(keep));
  } catch { /* storage off: the picker starts from the suggestion */ }
}

/** o: the app the card's run is serving, in a new browser tab. */
export function openApp(id: string): void {
  const s = get();
  const run = s.runs[id];
  const card = s.cards.find((c) => c.id === id);
  const pr = card?.ship?.pr ?? card?.pr;
  if (run?.state === 'up' && run.url) window.open(run.url, '_blank', 'noopener');
  else if (run?.state === 'running') flash('The app is still starting');
  else if (pr) window.open(pr.url, '_blank', 'noopener');
  else flash('Nothing running yet: t tries it');
}

/** d on a card in Ship: done by hand (the PR merged or closed elsewhere, or a host Ship can't follow). */
export function doneKey(id: string): void {
  const card = get().cards.find((c) => c.id === id);
  if (!card) return;
  if (card.stage !== 'ship') { flash(card.stage === 'done' ? `${card.key} is done` : `${card.key} isn’t in Ship yet: s ships it`); return; }
  send({ type: 'card.done', id });
  flash(`${card.key} is done`);
}

/** s: the Ship sheet (commit, push, PR), or once it has a PR, the merge sheet. A QA or review card: its report. */
export function shipKey(id: string): void {
  const card = get().cards.find((c) => c.id === id);
  if (!card) return;
  if (card.kind === 'qa' || card.kind === 'review') {
    if (!card.report && !card.live?.lastMessage) { flash(`${card.key} has no report yet: Claude writes it at the end`); return; }
    set({ modal: { kind: 'report', id } });
    return;
  }
  if (card.stage === 'done' && card.ship?.pr?.state === 'MERGED') { flash(`${card.key} is merged`); return; }
  if (!card.sessionId && !card.ship?.pr) { flash(`${card.key} hasn’t started yet`); return; }
  set({ modal: { kind: 'ship', id } });
}

/** e in a card's drawer: write or edit the run recipe: its workspace's if it has one, else its repo's (the dialog switches). */
export function editRecipe(id: string): void {
  const card = get().cards.find((c) => c.id === id);
  const home = card && cardRepos(card)[0];
  if (home) set({ modal: { kind: 'recipe', repo: home, ...(card.workspaceId ? { workspaceId: card.workspaceId } : {}) } });
}

export function openCard(id: string): void {
  set({ line: { ...get().line, focus: id, drawer: id, tab: 'over' } });
}

const TABS = ['over', 'ctx', 'tx'] as const;

function focusField(id: string): void {
  setTimeout(() => document.getElementById(id)?.focus(), 0);
}

/** A text field on the new-card screen has focus: most keys type, a few still drive the screen. */
function composerTyping(e: KeyboardEvent, c: Composer): boolean {
  const el = e.target as HTMLElement;
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { el.blur(); startWork(); return true; }
  if (e.key === 'Escape') { el.blur(); return true; }
  if (e.key === 'Tab') {
    el.blur();
    // From the title, Tab goes to the first panel; from a panel's own field, to the next panel.
    if (el.id !== 'cp-title') updateComposer((x) => ({ ...x, pane: PANES[(PANES.indexOf(x.pane) + (e.shiftKey ? 2 : 1)) % 3] }));
    return true;
  }
  if (e.key === 'Enter' && el.tagName === 'INPUT') {
    el.blur();
    if (el.id === 'cp-q') {
      const s = get();
      if (c.tab === 'tickets') {
        const first = ticketSources(c, s.tickets, started(s), foundFor(s, c.q))[0];
        if (first) updateComposer((x) => { const r = pickTicket(x, first, s.workspaces, started(s), s.recipes); return typeof r === 'string' ? r : { ...r, q: '', si: 0 }; });
      } else {
        const first = sources(c, s.library.repos)[0];
        if (first) updateComposer((x) => ({ ...toggleSource(x, first.path), q: '', si: 0 }));
      }
    }
    return true;
  }
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && el.id === 'cp-q') {
    updateComposer((x) => ({ ...x, si: Math.max(0, x.si + (e.key === 'ArrowDown' ? 1 : -1)) }));
    return true;
  }
  return false;
}

function composerKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  const c = s.composer!;
  if (typing) return composerTyping(e, c);
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { startWork(); return true; }
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  if (e.key === 'Escape') { if (c.preview) updateComposer((x) => ({ ...x, preview: false })); else leaveComposer(); return true; }
  if (e.key === 'Tab') { updateComposer((x) => ({ ...x, pane: PANES[(PANES.indexOf(x.pane) + (e.shiftKey ? 2 : 1)) % 3] })); return true; }
  if (e.key === 'p') { updateComposer((x) => ({ ...x, preview: !x.preview })); return true; }
  if (e.key === 'e') { updateComposer((x) => ({ ...x, pane: 'pkt', preview: false })); focusField('cp-note'); return true; }
  if (e.key === 'm') {
    if (c.addTo) flash('The model was set when the card started');
    else updateComposer(cycleModel);
    return true;
  }
  if (e.key === 'k') {
    if (c.addTo) flash('The kind of work was set when the card started');
    else updateComposer((x) => cycleKind(x, composerKey(x, s.nextKey), s.workspaces, s.recipes));
    return true;
  }
  const up = e.key === 'ArrowUp';
  const down = e.key === 'ArrowDown';
  const step = up ? -1 : down ? 1 : 0;
  if (c.pane === 'src') {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { updateComposer((x) => ({ ...x, tab: nextTab(x.tab, e.key === 'ArrowRight' ? 1 : -1), si: 0, q: '' })); return true; }
    if (c.tab === 'folders') {
      const list = cardFolders(c, s.library.repos);
      if (step) { updateComposer((x) => ({ ...x, si: Math.max(0, Math.min(list.length, x.si + step)) })); return true; }
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'a') {
        const f = c.si > 0 ? list[c.si - 1] : undefined;
        if (f && e.key !== 'a') updateComposer((x) => ({ ...toggleSource(x, f.id), si: Math.max(0, x.si - 1) }));
        else set({ modal: { kind: 'addFolder' } });
        return true;
      }
      return false;
    }
    if (e.key === '/') { focusField('cp-q'); return true; }
    if (c.tab === 'tickets') {
      const list = ticketSources(c, s.tickets, started(s), foundFor(s, c.q));
      const t = list[Math.min(c.si, list.length - 1)];
      if (step) { updateComposer((x) => ({ ...x, si: Math.max(0, Math.min(list.length - 1, x.si + step)) })); return true; }
      if (e.key === ' ' || e.key === 'Enter') {
        if (t) updateComposer((x) => pickTicket(x, t, s.workspaces, c.addTo ? new Set() : started(s), s.recipes));
        else if (!s.tickets.length) flash('No tickets yet. Shift+T on the board connects them, or shows demo tickets.');
        return true;
      }
      if ((e.key === 'x' || e.key === 'Delete') && t && c.ticket?.key === t.key) { updateComposer((x) => dropTicket(x, s.nextKey)); return true; }
      return false;
    }
    const list = sources(c, s.library.repos);
    if (step) { updateComposer((x) => ({ ...x, si: Math.max(0, Math.min(list.length - 1, x.si + step)) })); return true; }
    if (e.key === ' ' || e.key === 'Enter') {
      const repo = list[Math.min(c.si, list.length - 1)];
      if (repo && cardHasRepo(c, repo.path)) flash(`${c.addTo!.key} can already use ${repo.name}`);
      else if (repo) updateComposer((x) => toggleSource(x, repo.path));
      else if (!s.library.repos.length) flash('The repo library is empty. On the board, F picks the folders it scans.');
      return true;
    }
    return false;
  }
  if (c.pane === 'pkt') {
    if (c.preview) return false;
    const rows = packetRows(c);
    if (step) { updateComposer((x) => ({ ...x, pi: Math.max(0, Math.min(rows.length - 1, x.pi + step)) })); return true; }
    if (e.key === ' ' || e.key === 'Enter') {
      if (rows[c.pi]?.layer === 'note') focusField('cp-note');
      else updateComposer((x) => togglePacketRow(x, x.pi));
      return true;
    }
    if (e.key === 'x' || e.key === 'Delete') { updateComposer((x) => togglePacketRow(x, x.pi, true)); return true; }
    if (e.key === 'w') { keepRepo(c.pi); return true; }
    return false;
  }
  const key = composerKey(c, s.nextKey);
  const rows = goRows(c, s.workspaces, key, { pinned: s.cardModel, user: s.userModel });
  if (step) { updateComposer((x) => ({ ...x, gi: Math.max(0, Math.min(rows.length - 1, x.gi + step)) })); return true; }
  const row = rows[Math.min(c.gi, rows.length - 1)];
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    updateComposer((x) => stepOption(x, row, e.key === 'ArrowRight' ? 1 : -1, s.workspaces, key, s.recipes));
    return true;
  }
  if (e.key === 'Enter' && row.id === 'msg') { focusField('cp-msg'); return true; }
  return false;
}

/** w on the new-card screen: the card's repo goes to the workspace, for every card after this one too. */
export function keepRepo(index: number): void {
  const c = get().composer;
  if (!c) return;
  const r = keepForWorkspace(c, index);
  if (typeof r === 'string') { flash(r); return; }
  send({ type: 'workspace.addRepo', id: c.workspaceId!, path: r.repo });
  set({ composer: { ...r.composer, error: null } });
  const ws = get().workspaces.find((w) => w.id === c.workspaceId);
  flash(`Kept for ${ws?.name ?? 'the workspace'}: every card there gets it`);
}

/** What the tracker's search found for this text (nothing while it answers an older search). */
export function foundFor(s: ReturnType<typeof get>, q: string): Ticket[] {
  return s.found.q === q.trim() ? s.found.tickets : [];
}

/** The keys of cards already on the line: a ticket gets one card. */
function started(s: ReturnType<typeof get>): Set<string> {
  return new Set(s.cards.map((c) => c.key));
}

function drawerKeys(e: KeyboardEvent): boolean {
  const s = get();
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  switch (e.key) {
    case 'Escape': set({ line: { ...s.line, drawer: null } }); return true;
    case 'ArrowLeft': case 'ArrowRight': if (s.line.drawer) openNeighbour(s.line.drawer, e.key === 'ArrowRight' ? 1 : -1); return true;
    case 'Tab': {
      // Wide screens show the transcript beside the tabs, so Tab only switches Overview and Context.
      const tabs = window.matchMedia?.('(min-width: 1024px)').matches ? TABS.filter((t) => t !== 'tx') : [...TABS];
      const i = Math.max(0, tabs.indexOf(s.line.tab));
      set({ line: { ...s.line, tab: tabs[(i + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length] } });
      return true;
    }
    case 'Delete': if (s.line.drawer) set({ modal: { kind: 'deleteCard', id: s.line.drawer } }); return true;
    case 'X': if (s.line.drawer) openWorktrees(s.line.drawer); return true;
    case 'Enter': if (s.line.drawer) focusSay(s.line.drawer); return true;
    case 'y': case 'n': if (s.line.drawer) answerAsk(s.line.drawer, e.key === 'y' ? 'allow' : 'deny'); return true;
    case 'g': if (s.line.drawer) goToTab(s.line.drawer); return true;
    case 'D': if (s.line.drawer) openChanges(s.line.drawer); return true;
    case 'c': if (s.line.drawer) openAddComposer(s.line.drawer); return true;
    case 'x': if (s.line.drawer) withdrawLast(s.line.drawer); return true;
    case 't': if (s.line.drawer) tryIt(s.line.drawer); return true;
    case 'o': if (s.line.drawer) openApp(s.line.drawer); return true;
    case 'e': if (s.line.drawer) editRecipe(s.line.drawer); return true;
    case 's': if (s.line.drawer) shipKey(s.line.drawer); return true;
    case 'd': if (s.line.drawer) doneKey(s.line.drawer); return true;
  }
  return false;
}

/** The workspace keys on the board. */
function workspaceKeys(e: KeyboardEvent): boolean {
  if (e.key === 'Delete' && e.shiftKey) { workspaceKey('delete'); return true; }
  switch (e.key) {
    case 'w': case 'W': set({ modal: { kind: 'workspace', id: null } }); return true;
    case 'e': workspaceKey('edit'); return true;
    case 'E': workspaceKey('share'); return true;
    case 'I': importWorkspace(); return true;
    case 'f': case 'F': set({ modal: { kind: 'sources' } }); return true;
    case '+': case '=': workspaceKey('addRepo'); return true;
    case '-': workspaceKey('removeRepo'); return true;
  }
  return false;
}

function boardKeys(e: KeyboardEvent): boolean {
  const s = get();
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (digit && !e.shiftKey) {
    const n = Number(digit[1]);
    const ws = s.workspaces[n - 1];
    if (n && !ws) { flash(s.workspaces.length ? `There is no workspace ${n}` : 'No workspaces yet. W makes one.'); return true; }
    const filter = n === 0 ? 'all' : ws.id;
    setFilter(filter);
    set({ line: { ...get().line, focus: moveFocus(boardOf(get()), null, 1, 0) } });
    flash(n === 0 ? 'Every workspace' : ws.name);
    return true;
  }
  if (e.key !== 'e' && workspaceKeys(e)) return true;
  if (e.key === '/' && !e.shiftKey) { set({ line: { ...s.line, searching: true } }); focusField('line-q'); return true; }
  if (e.key === 'T') { set({ modal: { kind: 'tickets' } }); return true; }
  if (e.key === 'v') { switchInbox(); return true; }
  const cols = boardOf(s);
  const focused = cols.some((l) => l.cards.some((c) => c.id === s.line.focus) || l.tickets.some((t) => ticketFocus(t.key) === s.line.focus)) ? s.line.focus : null;
  const ticket = cols[0].tickets.find((t) => ticketFocus(t.key) === focused);
  if (ticket) {
    if (e.key === 'Enter' || e.key === 'n') { openComposer(ticket); return true; }
    if (e.key === 'Delete') { hideTicket(ticket.key, cols); return true; }
  }
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key]) {
    const [dx, dy] = arrows[e.key];
    set({ line: { ...s.line, focus: moveFocus(cols, focused, dx, dy) } });
    return true;
  }
  switch (e.key) {
    case 'Enter': if (focused) openCard(focused); return true;
    case 't': if (focused) tryIt(focused); else flash('Pick a card first'); return true;
    case 'o': if (focused) openApp(focused); return true;
    case 'g': if (focused) goToTab(focused); else flash('Pick a card first'); return true;
    case 'D': if (focused) openChanges(focused); else flash('Pick a card first'); return true;
    case 's': if (focused) shipKey(focused); return true;
    case 'd': if (focused) doneKey(focused); return true;
    case 'e': if (focused) editRecipe(focused); else workspaceKey('edit'); return true;
    case 'c': openComposer(); return true;
    case 'C': openComposer(null, true); return true;
    case 'n': flash('n starts work on a ticket in the Inbox; c makes a card without one'); return true;
    case 'Delete': if (focused) set({ modal: { kind: 'deleteCard', id: focused } }); return true;
    case 'X': if (focused) openWorktrees(focused); else flash('Pick a card first'); return true;
    case 'Escape': if (s.line.q) set({ line: { ...s.line, q: '' } }); return true;
  }
  return false;
}

/** Enter on an open card: the message box to its terminal (when it has a channel). */
function focusSay(id: string): void {
  const card = get().cards.find((c) => c.id === id);
  if (!card?.channel) { flash(card?.sessionId ? `${card.key}’s terminal can’t be reached from here: type in its tab` : `${card?.key ?? 'It'} hasn’t started yet`); return; }
  focusField('card-say');
}

/** Send what's in the message box into the card's terminal session. */
export function saySubmit(id: string): void {
  const el = document.getElementById('card-say') as HTMLTextAreaElement | null;
  const text = el?.value.trim();
  if (!el || !text) return;
  const card = get().cards.find((c) => c.id === id);
  sayToCard(id, text).then(() => { el.value = ''; flash(`Sent to ${card?.key ?? 'the card'}’s terminal`); }, (e: Error) => flash(e.message));
}

/** y / n on an open card: answer the permission prompt its terminal relayed. */
/** Shift+X: the card's worktrees, to remove them (with their branch) once the card is done. */
export function openWorktrees(id: string, thenDelete = false): void {
  const card = get().cards.find((c) => c.id === id);
  if (!card) return;
  if (!ownFolders(card).length) { flash(`${card.key} has no worktrees: it works in ${card.cwd ? repoName(card.cwd) : 'its repo'}’s own folder`); return; }
  set({ modal: { kind: 'worktrees', id, ...(thenDelete ? { thenDelete } : {}) } });
}

/** D: what the card changed, file by file with the diffs, without leaving for an editor. */
export function openChanges(id: string): void {
  const card = get().cards.find((c) => c.id === id);
  if (!card) return;
  if (!card.cwd) { flash(`${card.key} hasn’t started yet: nothing changed`); return; }
  set({ modal: { kind: 'changes', id } });
}

/** g: the card's Windows Terminal tab, brought to the front (the trust prompt, or anything the channel can't relay). */
export function goToTab(id: string): void {
  const card = get().cards.find((c) => c.id === id);
  if (!card) return;
  if (!card.cwd) { flash(`${card.key} hasn’t opened a tab yet`); return; }
  focusCardTab(id).then(() => flash(`Brought the tab ${card.key} forward`), (e: Error) => flash(e.message));
}

export function answerAsk(id: string, behavior: 'allow' | 'deny'): void {
  const card = get().cards.find((c) => c.id === id);
  const ask = card && askOf(card);
  if (!ask) { flash(`${card?.key ?? 'It'} isn’t asking anything`); return; }
  if (!ask.requestId) { flash(ask.kind === 'question' ? 'Answer the question in the message box (Enter), or in its tab' : `Answer it in its terminal tab, ${card!.key}`); return; }
  answerCard(id, ask.requestId, behavior).then(() => flash(behavior === 'allow' ? (ask.kind === 'plan' ? 'Plan approved' : `Allowed ${ask.tool}`) : `Denied ${ask.tool}`), (e: Error) => flash(e.message));
}

/** The message box on an open card: Enter sends, Shift+Enter is a new line, Esc leaves it. */
function sayKeys(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement;
  if (el.id !== 'card-say') return false;
  const id = get().line.drawer;
  if (e.key === 'Escape') { el.blur(); return true; }
  if (e.key === 'Enter' && !e.shiftKey) { if (id) saySubmit(id); return true; }
  // The session keys that work while typing (Ctrl+Enter, Alt+arrows) must not fire from here.
  return e.ctrlKey || e.altKey;
}

/** The filter box (/): typing filters, Enter or ↓ goes back to the board with the filter kept, Esc clears it. */
function searchKeys(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement;
  if (el.id === 'card-say') return sayKeys(e);
  if (el.id !== 'line-q') return false;
  if (e.key === 'Escape') { el.blur(); set({ line: { ...get().line, q: '', searching: false } }); return true; }
  if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'Tab') { el.blur(); set({ line: { ...get().line, searching: false } }); return true; }
  return false;
}

export function lineKeys(e: KeyboardEvent, typing: boolean): boolean {
  const s = get();
  if (s.screen !== 'line' || s.modal) return false;
  if (s.composer) return composerKeys(e, typing);
  if (typing) return searchKeys(e);
  if (s.line.drawer) return drawerKeys(e);
  return boardKeys(e);
}

/** Delete on a ticket in the Inbox: hide it there (the tracker is untouched), and move to the next one. */
function hideTicket(key: string, cols: ReturnType<typeof boardOf>): void {
  const s = get();
  const ids = cols[0].tickets.map((t) => ticketFocus(t.key));
  const at = ids.indexOf(ticketFocus(key));
  const next = ids[at + 1] ?? ids[at - 1] ?? cols[0].cards[0]?.id ?? null;
  send({ type: 'tickets.hide', key, hidden: true });
  set({ line: { ...s.line, focus: next } });
  flash(`Hid ${key} from the Inbox. Shift+T shows hidden tickets again.`);
}

/** ← → with a card open: the next card the board shows opens in its place, on the same tab. */
export function openNeighbour(id: string, delta: number): void {
  const s = get();
  const next = stepCard(boardOf(s), id, delta);
  if (!next.id) { flash(delta > 0 ? 'That is the last card on the board' : 'That is the first card on the board'); return; }
  set({ line: { ...s.line, focus: next.id, drawer: next.id } });
}

/** Take a card off the line (the Delete dialog's yes). */
export function deleteCard(id: string): void {
  send({ type: 'card.delete', id });
  const s = get();
  const cols = lanes(s.cards.filter((c) => c.id !== id), s.line.filter, s.line.q, inboxOf(s));
  set({ line: { ...s.line, drawer: s.line.drawer === id ? null : s.line.drawer, focus: s.line.focus === id ? moveFocus(cols, null, 1, 0) : s.line.focus } });
}
