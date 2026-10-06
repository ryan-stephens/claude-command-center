// Keys on the Ticket Line, the home page: the board, a card's drawer and the new-card screen, plus the workspace keys that used to live on Home. keys.ts routes here
// while the line is on screen, before the global shortcuts, so Ctrl+Enter starts work instead of
// expanding a session. Every key here has a row in LINE_SECTIONS (the ? overlay) and in
// lineLegendFor (the bar at the bottom).

import { askOf, cardRepos, ownFolders, reachable, waiting } from '../shared/cards.ts';
import { anyLive, cardRecipe, runKey, runsOf, wsRecipeKey } from '../shared/recipes.ts';
import { allMerged, openPrs, prsOf } from '../shared/ship.ts';
import type { StackChoice } from '../shared/stack.ts';
import { repoName } from '../shared/workspaces.ts';
import { finishedTickets, inbox, INBOX_VIEWS, type Ticket } from '../shared/tickets.ts';
import { exportWorkspace, importWorkspace } from './commands.ts';
import { openSession } from './keys.ts';
import { closeComposer, currentWorkspace, flash, get, set, setFilter, setInboxView, setPanelW, takeDraft, type WorkspaceAction } from './store.ts';
import {
  addComposer, additionOf, cardFolders, type CardPanel, stepCard, cardHasRepo, composerKey, cycleKind, cycleModel, draftOf, nextTab, dropTicket, focusedTicket, goRows, keepForWorkspace, lanes, lineSessions, moveFocus, newComposer, packetRows, PANES, pickTicket,
  sources, stepOption, ticketFocus, ticketSources, togglePacketRow, toggleSource,
  type Composer,
} from './line-model.ts';
import { simpleKeys, simpleLook, switchLook } from './simple-keys.ts';
import { withSimple } from './simple-model.ts';
import { addCardContext, answerCard, focusCardTab, sayToCard, send, startCard, stopRun, tryCard } from './ws.ts';

export const LINE_SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Ticket Line',
    keys: [
      ['← → ↑ ↓', 'Move between cards'],
      ['Enter', 'Open the card: its chat (the session the app runs for it, streaming as Claude writes, with the message box and what it is asking) and a dock on the left whose panels open beside it'],
      ['n / Enter (a ticket in the Inbox)', 'Start work on it: the new-card screen, with the ticket as its context'],
      ['v', 'Inbox: your tickets, or every ticket Ready for QA in your projects'],
      ['Delete (a ticket in the Inbox)', 'Hide it from the Inbox (nothing changes in Jira or Trello; Shift+T shows it again)'],
      ['Shift+T', 'Tickets: demo tickets (D), Jira and Trello (R refreshes), which lane each project goes to, and tickets you hid'],
      ['Ctrl+Enter', 'The card’s session full screen, in the app’s session view (Esc comes back)'],
      ['c', 'New card: build its context and start work; Claude runs in the app. A card you left half-built (Esc, Alt+L) is picked up again; Shift+C starts a fresh one'],
      ['1–9  /  0', 'Show one lane’s cards / all of them'],
      ['/', 'Filter the cards by words'],
      ['Shift+D / Shift+T / v / Shift+C / m (card open)', 'The dock’s panels, beside the chat: Changes (what it changed, by repo, with the diffs), Try it (its app, or its services, with their output), Verify (the team’s apps, later), Context (how it started, what Claude was given, what was added since), More (steps, where it runs, the PR, the report). The same key closes the panel; the panel stays open from card to card'],
      ['j / k  ·  Space  ·  f (Changes panel)', 'The next / previous file, its diff under it  ·  fold or unfold that diff  ·  pop the diff out full width, on the same file'],
      ['z  ·  Z (Changes panel, and popped out)', 'Fold or unfold the chosen file’s repo (its files go under the header, which keeps the count)  ·  fold every repo, or unfold them all. A header click does the same with the mouse; a second click on the chosen file folds its diff'],
      ['j / k  ·  Space  ·  r  ·  q (Try it panel, a lane with a stack)', 'The environment row and each service  ·  change the environment, or tick a service to run  ·  start the highlighted service, or start it again after a fix while the others keep running  ·  stop it alone. t starts every ticked service at once, or stops them all'],
      ['f (Try it panel)', 'The highlighted service’s output full width, as it prints (its tab for each run, j k switch; / filters the lines, w wraps them, End goes back to the newest, q and r stop and start it from there). The panel shows the same output under the service, following the newest line until you scroll up'],
      ['[ / ] (a panel open)', 'Narrower / wider: the panel’s edge drags too, and the width is remembered'],
      ['Esc (card open)', 'While Claude is working: stop it, as Esc does in Claude Code. Otherwise back to the board, the card still focused; on the board, clear the filter'],
      ['← → (card open)', 'The previous / next card on the board, in column order'],
      ['Enter (card open)', 'The message box under the chat: Enter sends to the session at once, Shift+Enter is a new line, Esc leaves the box. A session that isn’t running (the server restarted, or it ended) is resumed by the send itself'],
      ['y / n (card open)', 'Allow or deny what Claude is asking to do (a plan to approve counts: n keeps it planning)'],
      ['1–9  ·  Tab / Shift+Tab  ·  y (a question on the card)', 'Claude’s question form, drawn as it is in the tab: a digit picks an option (a single choice moves on to the next question; boxes toggle), the digit after the options is Type something  ·  the next / previous question, or Submit at the end  ·  submit the answers. A message from the box instead goes in as the next turn'],
      ['g (a card)', 'Open it in a terminal: between turns, the app lets go of the session and a Windows Terminal tab resumes it (claude --resume), the card following it there. A card already in a tab: brings that tab forward'],
      ['Shift+D (a card on the board)', 'Changes full width: what it changed as git sees it, in every repo the card works in (its worktrees, or a repo it edited in place), file by file with the diffs (↑ ↓ file, s ships from there)'],
      ['c (card open)', '+ Context: the same popup the new-card screen has, over the chat (Repos, Folders and Tickets tabs, ← → or Tab switch, / searches, Enter ticks, and a note), Ctrl+Enter adds, Esc goes back. What you add goes to Claude at once when it is between turns, or with your next message while it works. A repo gets a worktree on the card’s branch, and an API or UI among them joins the lane’s stack; a note naming an API makes t suggest it'],
      ['x (card open)', 'Take back the last thing still waiting on the card'],
      ['t (a card)', 'Try it: start its app in the card’s own folder; again stops it. With a lane stack, the Try it panel’s ticked services start, each on a port of its own. A lane with no stack yet: the stack form opens, filled from what the repos say (okteto.yml, angular.json, the proxy file), and Save and start goes on'],
      ['o (a card)', 'Open the app its run is serving; with nothing running, its pull request'],
      ['e (a card)', 'How it runs. A lane of several repos: its stack as a form (the environments, the UI, the APIs to tick with their names and routes, and how an API starts on the dev environment in three answers; ports, folders, health paths, the proxy rule and the lines behind Advanced). A single repo: what starts it, an install step, where it serves, what runs on stop; Ctrl+Enter saves either'],
      ['s (a card)', 'Ship: commit the files you tick, push, and open a PR written from the ticket, in each repo the card changed (one block per repo in the sheet; the PRs link each other); if it stops part-way, s again ships only the repos left; on a card in Ship with every PR open, merge them. On a QA or review card: its report (Enter copies, j posts it on the Jira ticket and m moves the ticket, each after you confirm; o opens the PR, d moves the card to Done)'],
      ['d (a card in Ship)', 'Done: the PR was merged or closed by hand, or the host isn’t one Ship can follow'],
      ['Shift+X (a card)', 'Worktrees: the folders the card made, with what each still holds; on a Done card, remove them and their branch (Enter the clean ones, f all of them)'],
      ['Delete', 'Take the card off the line (its session stays in the session list); w there removes its worktrees too'],
    ],
  },
  {
    title: 'Lanes (Ticket Line)',
    keys: [
      ['W', 'New lane'],
      ['E (or e with no card focused)', 'Edit the lane shown (with All showing, pick which)'],
      ['In the lane dialog: ← → / x / h / Enter', 'Along the repo chips / take one out / make it the home repo / + Repo: a popup with Repos (the library; ↑ ↓, Enter ticks one and keeps the list open) and Library folders (the folders the library scans); ← → or Tab switch tabs, Esc closes the popup'],
      ['+ / −', 'Add a repo from the library to the lane shown / remove one (every card and session in it can use them all)'],
      ['F', 'Choose the folders the repo library lists'],
      ['Shift+E / Shift+I', 'Share the lane as a file / import one'],
      ['Shift+Delete', 'Delete the lane shown (its repos and sessions stay)'],
    ],
  },
  {
    title: 'New card (simple look)',
    keys: [
      ['Shift+L', 'The other look: the full three-panel screen, or back to this one (remembered as a setting; also in ? B)'],
      ['↑ ↓ / Tab', 'Move through the blocks in reading order: ticket → what Claude can see → opening message → session settings → Start'],
      ['Enter (ticket)', 'Pick a ticket, or change it (/ searches, Jira too; x takes it off and a title can be typed instead)'],
      ['Space (ticket)', 'Show or hide the ticket’s details under its counts: every acceptance criterion, each comment with who and when, the linked tickets'],
      ['o (ticket)', 'Open the ticket in the tracker, in the browser (its key is a link too)'],
      ['← → (what Claude can see)', 'Move along the chips: the lane’s repos, this card’s repos, folders and related tickets, then + Context'],
      ['Enter / Space (a chip)', 'Include or leave out a lane repo; on + Context, open the picker'],
      ['+ or a (what Claude can see)', 'Add context: a popup with Repos (the library), Folders (ones from disk: type or paste a path and Enter, or b browses in the Windows folder dialog; on one listed, Enter leaves it out or brings it back, x takes it off) and Tickets (related ones; Jira is searched too). ← → or Tab switch tabs, ↑ ↓ move, Enter adds one and keeps the list open (on one already ticked, takes it out), Esc closes'],
      ['b (Repos tab)', 'Another folder of repos to pick from, for this card only (the lane and the library are not changed): b browses in the Windows folder dialog, or paste the folder’s path in the box and Enter, or Enter on the last row. Its repos are listed under its path; x on that heading takes the folder off, and repos you picked from it stay on the card'],
      ['x (a chip)', 'Take out something this card added'],
      ['w (a chip)', 'Keep a repo you added for the whole lane'],
      ['Enter or e (opening message)', 'Write the first thing Claude is told (the context itself arrives through the hook, so keep it to a prompt)'],
      ['Space (opening message)', 'Pick a saved prompt: its {{placeholders}} are filled from the card (ticket, repos, folders, lane, branch, kind) and it follows the card as you add context, until you edit the text; Write your own detaches it. ↑ ↓ Enter, Esc closes'],
      ['w (opening message)', 'Have Claude write it: the rough words in the box plus the card’s context go to a cheap model for one turn (no tools, nothing read from disk); its answer replaces the text'],
      ['s (opening message)', 'Save the message as a new prompt (what the card filled in goes back to placeholders)'],
      ['Shift+E', 'Saved prompts: ↑ ↓, n new, e or Enter edit (name, kind, body, with the placeholders and a live example from this card beside it; Ctrl+Enter saves), Delete twice removes, Esc'],
      ['Enter (session settings)', 'Open its options: lane, the repo it starts in, branch, mode, model (↑ ↓ a row, ← → change, Enter closes)'],
      ['k / m', 'Kind of work (Develop, QA, Code review) / the model, from anywhere on the screen'],
      ['p', 'Preview exactly what Claude gets'],
      ['Ctrl+Enter (or Enter on Start)', 'Start work'],
      ['Esc', 'Close the picker or the options, then cancel (a half-built card is kept for c)'],
    ],
  },
  {
    title: 'New card (full look)',
    keys: [
      ['Shift+L', 'The simple one-column look'],
      ['Tab / Shift+Tab', 'Next / previous panel: add context → what Claude will know → how it starts'],
      ['↑ ↓', 'Move in the panel'],
      ['← → (add context)', 'Tickets, Repos or Folders'],
      ['Enter (Folders)', 'Add any folder on disk as context (it goes in with --add-dir); Space on one takes it out'],
      ['Space', 'Pick a ticket (the first is the card’s, later ones are related) or a repo; include or leave out a line of the context'],
      ['/', 'Search the tickets (by key or words; Jira is searched too, for anyone’s ticket) or the repo library'],
      ['k', 'Kind of work: Develop, QA (test someone’s change) or Code review'],
      ['x', 'Remove something you added to this card (on the card’s ticket: take it off)'],
      ['w (what Claude will know)', 'Keep a repo you added to this card for the whole lane'],
      ['e', 'Write your own note for Claude'],
      ['← → (how it starts)', 'Change the option: lane, the repo it starts in, branch, mode, model'],
      ['m', 'Change the model: your default, Opus, Sonnet or Haiku'],
      ['p', 'Preview exactly what Claude gets'],
      ['Ctrl+Enter', 'Start work (also while typing); adding to a running card, add it'],
      ['Esc', 'Leave the text field, then cancel'],
    ],
  },
];

/** The Inbox: tickets no card has started, in the workspace shown. */
export function inboxOf(s: ReturnType<typeof get>): Ticket[] {
  return inbox(s.tickets, new Set(s.cards.map((c) => c.key)), s.line.filter, s.line.view, s.doneStatuses);
}

/** Tickets without a card that are past the work: in the Done column (§100). */
export function doneTicketsOf(s: ReturnType<typeof get>): Ticket[] {
  return finishedTickets(s.tickets, new Set(s.cards.map((c) => c.key)), s.line.filter, s.line.view, s.doneStatuses);
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
  return lanes(s.cards, s.line.filter, s.line.q, inboxOf(s), doneTicketsOf(s));
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
  if (!card.sessionId) { flash(`${card.key} has no session yet`); return; }
  openSession(card.sessionId);
}

/** The workspace keys: act on the workspace shown, or with All showing, ask which. */
export function workspaceKey(then: WorkspaceAction): void {
  const s = get();
  const ws = currentWorkspace(s);
  if (ws) { runWorkspaceAction(then, ws.id); return; }
  if (!s.workspaces.length) {
    if (then === 'addRepo') set({ modal: { kind: 'workspace', id: null } });
    else flash('No lanes yet. W makes one.');
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
  // The simple look starts in the ticket search (its list opens under it); the full one in the title.
  if (!ticket) setTimeout(() => document.getElementById(simpleLook() ? 'cp-q' : 'cp-title')?.focus(), 0);
}

/** Esc (or the Cancel button) on the new-card screen: a card with work on it is kept for c. */
export function leaveComposer(): void {
  const c = get().composer;
  if (!c) return;
  if (c.addTo) { set({ composer: null }); return; }
  const kept = closeComposer();
  if (kept) flash('Kept the card you were building · c picks it up again, Shift+C starts fresh');
}

/**
 * c on an open card: + Context, the same popup the new-card screen has (Repos, Folders, Tickets and
 * a note), over the chat, adding to that card (§88). Esc goes back to the chat. The full look keeps
 * its three-panel screen for it.
 */
export function openAddComposer(id: string): void {
  const s = get();
  const card = s.cards.find((c) => c.id === id);
  if (!card) return;
  if (card.stage === 'done') { flash(`${card.key} is done`); return; }
  const c = addComposer(card, s.tickets);
  set({ composer: (s.settings.newCardLook ?? 'simple') === 'simple' ? withSimple({ ...c, tab: 'repos' }, { adding: 'context', ai: 0 }) : c });
  if ((s.settings.newCardLook ?? 'simple') === 'simple') setTimeout(() => document.getElementById('cp-q')?.focus(), 0);
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
      set({ composer: null, line: { ...get().line, focus: id, drawer: id, panel: 'context' } });
      flash(get().cardsInTerminal ? 'Started in a terminal tab' : 'Started: Claude is on it');
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
      set({ composer: null, line: { ...get().line, focus: id, drawer: id, panel: 'context' } });
      setTimeout(() => document.getElementById('added-since')?.scrollIntoView({ block: 'nearest' }), 0);
      const card = get().cards.find((x) => x.id === id);
      flash(!card?.sessionId ? `Waiting on ${key}: it goes in when the session starts` : waiting(card).length ? `Waiting on ${key}: it goes in with your next message` : `Added to ${key}: Claude has it`);
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

/** Is any of the card's runs going (starting or up)? Then t stops them all. */
export function running(id: string): boolean {
  return anyLive(get().runs, id);
}

/**
 * t: run the card's recipe, or stop it when it runs. With a stack (§82): start every service the
 * Try it panel has ticked, in the environment it shows, or stop them all; the panel opens either way.
 */
export function tryIt(id: string): void {
  const s = get();
  const card = s.cards.find((c) => c.id === id);
  if (!card) return;
  if (running(id)) { stopRun(id); flash(`Stopping ${card.key}’s app`); return; }
  const home = cardRepos(card)[0];
  set({ line: { ...s.line, focus: id, drawer: id, panel: 'try' } });
  const recipe = cardRecipe(s.recipes, card.workspaceId, home);
  // A lane of several repos with no stack yet: the stack form, filled from what the repos say, with Save and start (§86).
  const wsRepos = s.workspaces.find((w) => w.id === card.workspaceId)?.repos.length ?? 0;
  if (card.workspaceId && !s.recipes[wsRecipeKey(card.workspaceId)] && wsRepos > 1) { set({ modal: { kind: 'stackSetup', workspaceId: card.workspaceId, then: id } }); return; }
  if (!recipe) { flash(`${home ? repoName(home) : card.key} doesn’t say how it runs: e sets it up`); return; }
  if (recipe.stack) {
    const pick = lastPick(id);
    if (!pick) { flash('Tick the services to run in the Try it panel, then t again'); return; }
    tryStack(id, pick);
    return;
  }
  tryCard(id).then(() => {
    setTimeout(() => document.getElementById('try-it')?.scrollIntoView({ block: 'nearest' }), 0);
  }, (e: Error) => flash(e.message));
}

/** Start a card's stack with what was picked (every picked service at once), and remember the pick for next time. */
export function tryStack(id: string, choice: StackChoice): void {
  rememberPick(id, choice);
  set({ modal: null });
  tryCard(id, choice).then(() => flash(`Starting ${choice.apis.length ? choice.apis.join(', ') : 'the UI'}`), (e: Error) => flash(e.message));
}

/** r in the Try it panel: start (or start again) the service highlighted, on its own; with nothing running yet, start everything picked. */
export function tryService(id: string, service: string): void {
  const s = get();
  if (!anyLive(s.runs, id) && !runsOf(s.runs, id).length) { tryIt(id); return; }
  tryCard(id, undefined, service).then(() => flash(`Starting ${service}`), (e: Error) => flash(e.message));
}

/** q in the Try it panel: stop the service highlighted, the others keep running. */
export function stopService(id: string, service: string): void {
  const run = get().runs[runKey(id, service)];
  if (!run || (run.state !== 'running' && run.state !== 'up')) { flash(`${service} isn’t running`); return; }
  stopRun(id, service);
  flash(`Stopping ${service}`);
}

/** The Try it panel's rows (the environment, then each service) and what j k Space r q do to them: the panel keeps them here for the keys. */
export interface TryRows {
  choose: [string, string[]][];
  /** Each service: an API's repo, or "ui"; `found`: the card has its repo; `fixed`: always runs (the UI). */
  services: { id: string; found: boolean; fixed: boolean }[];
}
export let tryRows: TryRows = { choose: [], services: [] };
export function setTryRows(rows: TryRows): void { tryRows = rows; }

/** Space in the Try it panel: cycle the environment on its row, or tick / untick the service highlighted. The pick is remembered for t. */
export function toggleTryRow(id: string): void {
  const s = get();
  const at = s.line.at;
  const pick = lastPick(id) ?? { values: {}, apis: [] };
  if (at < tryRows.choose.length) {
    const [k, vals] = tryRows.choose[at];
    const cur = pick.values[k] ?? vals[0];
    const next = vals[(vals.indexOf(cur) + 1) % vals.length];
    rememberPick(id, { ...pick, values: { ...pick.values, [k]: next } });
    if (anyLive(s.runs, id)) flash(`${k}: ${next} · takes effect when everything is started again (t twice)`);
    return;
  }
  const sv = tryRows.services[at - tryRows.choose.length];
  if (!sv || sv.fixed) return;
  if (!sv.found) { flash(`${sv.id} isn’t in this card or its lane`); return; }
  const apis = pick.apis.includes(sv.id) ? pick.apis.filter((a) => a !== sv.id) : [...pick.apis, sv.id];
  rememberPick(id, { ...pick, apis });
}

/** j / k in the Try it panel. */
export function stepTry(delta: number): void {
  const s = get();
  const n = tryRows.choose.length + tryRows.services.length;
  set({ line: { ...s.line, at: Math.max(0, Math.min(Math.max(0, n - 1), s.line.at + delta)) } });
}

/** The service on the Try it panel's highlighted row, if a service is highlighted. */
export function tryRowService(): string | undefined {
  return tryRows.services[get().line.at - tryRows.choose.length]?.id;
}

const PICK_KEY = 'cc-control.stackPick';

/** What was picked last time for this card, if anything (this browser only). */
export function lastPick(id: string): StackChoice | undefined {
  try { return (JSON.parse(localStorage.getItem(PICK_KEY) ?? '{}') as Record<string, StackChoice>)[id]; } catch { return undefined; }
}

export function rememberPick(id: string, choice: StackChoice): void {
  try {
    const all = JSON.parse(localStorage.getItem(PICK_KEY) ?? '{}') as Record<string, StackChoice>;
    all[id] = choice;
    // Only the most recent cards: an old card's pick doesn't matter.
    const keep = Object.fromEntries(Object.entries(all).slice(-50));
    localStorage.setItem(PICK_KEY, JSON.stringify(keep));
  } catch { /* storage off: the picker starts from the suggestion */ }
  // The panel reads the pick from the store's tick (storage has no events of its own in the same page).
  set({ line: { ...get().line, pickTick: (get().line.pickTick ?? 0) + 1 } });
}

/** o: the app the card's run is serving, in a new browser tab. */
export function openApp(id: string): void {
  const s = get();
  const run = s.runs[id];
  const card = s.cards.find((c) => c.id === id);
  // The card's PRs: the first still open, else the first; a QA or review card's is the one it looks at.
  const prs = card ? prsOf(card.ship) : [];
  const pr = openPrs(prs)[0] ?? prs[0] ?? card?.pr;
  if (run?.state === 'up' && run.url) window.open(run.url, '_blank', 'noopener');
  else if (run?.state === 'running') flash('The app is still starting');
  else if (pr) { window.open(pr.url, '_blank', 'noopener'); if (prs.length > 1) flash(`Opened PR #${pr.number}${pr.repo ? ` (${pr.repo})` : ''}; the others are in the Ship section`); }
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
  if (card.stage === 'done' && allMerged(prsOf(card.ship))) { flash(`${card.key} is merged`); return; }
  if (!card.sessionId && !prsOf(card.ship).length) { flash(`${card.key} hasn’t started yet`); return; }
  set({ modal: { kind: 'ship', id } });
}

/** e on a card: how it runs. A lane of several repos: its stack, as a form (§83). A single repo: its own form (§86). */
export function editRecipe(id: string): void {
  const s = get();
  const card = s.cards.find((c) => c.id === id);
  const home = card && cardRepos(card)[0];
  if (!home) return;
  const wsRepos = s.workspaces.find((w) => w.id === card.workspaceId)?.repos.length ?? 0;
  if (card.workspaceId && (wsRepos > 1 || s.recipes[wsRecipeKey(card.workspaceId)]?.stack)) { set({ modal: { kind: 'stackSetup', workspaceId: card.workspaceId } }); return; }
  set({ modal: { kind: 'runSetup', repo: home } });
}

export function openCard(id: string): void {
  set({ line: { ...get().line, focus: id, drawer: id } });
}

/** A dock key on the open card (§81): opens that panel beside the chat, or closes it when it is the one open. */
export function togglePanel(panel: CardPanel): void {
  const s = get();
  set({ line: { ...s.line, panel: s.line.panel === panel ? null : panel, at: 0 } });
}

/** j / k in the Changes panel: the next or previous file across every repo. */
export function stepChange(delta: number, count: number): void {
  const s = get();
  set({ line: { ...s.line, at: Math.max(0, Math.min(Math.max(0, count - 1), s.line.at + delta)) } });
}

/**
 * Claude's question form on the open card (§91): while it is up, digits pick, Tab / Shift+Tab move
 * between its questions, y submits. The form sets these while it is on screen.
 */
export const questionHooks = { on: false, digit: (_d: number): void => {}, next: (): void => {}, prev: (): void => {}, submit: (): void => {}, otherDone: (): void => {} };

/** How many files the Changes panel shows right now (it keeps the count here for j / k). */
export let changeCount = 0;
/** The panel's shown files, each as its index in the full list (a folded repo's files are left out, §90): f pops the sheet out on the right one. */
export let changeIndex: number[] = [];
/** What Space, z and Z do in the Changes panel: the panel sets these while it is up (§90). */
export const changeHooks = { toggleDiff: (): void => {}, foldRepo: (): void => {}, foldAll: (): void => {} };
export function setChangeCount(shown: number[]): void { changeCount = shown.length; changeIndex = shown; }

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
  if (simpleLook()) return simpleKeys(e, typing);
  if (typing) return composerTyping(e, c);
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { startWork(); return true; }
  if (e.key === 'L' && e.shiftKey && !e.ctrlKey && !e.altKey && !c.addTo) { switchLook(); return true; }
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
  flash(`Kept for ${ws?.name ?? 'the lane'}: every card there gets it`);
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
  // Claude's question form (§91) takes digits, Tab and y first while it is up.
  if (questionHooks.on) {
    if (e.key === 'Tab') { if (e.shiftKey) questionHooks.prev(); else questionHooks.next(); return true; }
    if (e.key === 'y') { questionHooks.submit(); return true; }
    if (/^[1-9]$/.test(e.key)) { questionHooks.digit(Number(e.key)); return true; }
  }
  switch (e.key) {
    case 'Escape': if (!(s.line.drawer && stopCard(s.line.drawer))) set({ line: { ...s.line, drawer: null } }); return true;
    case 'ArrowLeft': case 'ArrowRight': if (s.line.drawer) openNeighbour(s.line.drawer, e.key === 'ArrowRight' ? 1 : -1); return true;
    // The dock (§81): each panel's key opens it beside the chat, or closes it.
    case 'D': togglePanel('changes'); return true;
    case 'T': togglePanel('try'); return true;
    case 'v': togglePanel('verify'); return true;
    case 'C': togglePanel('context'); return true;
    case 'm': togglePanel('more'); return true;
    case '[': case ']': if (s.line.panel) { setPanelW(s.line.panelW + (e.key === ']' ? 40 : -40)); return true; } return false;
    case 'j': case 'k':
      if (s.line.panel === 'changes') { stepChange(e.key === 'j' ? 1 : -1, changeCount); return true; }
      if (s.line.panel === 'try') { stepTry(e.key === 'j' ? 1 : -1); return true; }
      return false;
    // The Try it panel with a stack (§82): Space ticks, r starts one service (again), q stops one.
    case ' ':
      if (s.line.panel === 'try' && s.line.drawer && tryRows.services.length) { toggleTryRow(s.line.drawer); return true; }
      // The Changes panel (§90): Space folds or unfolds the chosen file's diff, z its repo's files, Z every repo's.
      if (s.line.panel === 'changes' && changeCount) { changeHooks.toggleDiff(); return true; }
      return false;
    case 'z': if (s.line.panel === 'changes' && changeCount) { changeHooks.foldRepo(); return true; } return false;
    case 'Z': if (s.line.panel === 'changes') { changeHooks.foldAll(); return true; } return false;
    case 'r': { const sv = s.line.panel === 'try' ? tryRowService() : undefined; if (sv && s.line.drawer) { tryService(s.line.drawer, sv); return true; } return false; }
    case 'q': { const sv = s.line.panel === 'try' ? tryRowService() : undefined; if (sv && s.line.drawer) { stopService(s.line.drawer, sv); return true; } return false; }
    case 'f':
      if (s.line.panel === 'changes' && s.line.drawer) { openChanges(s.line.drawer, changeIndex[Math.min(s.line.at, changeIndex.length - 1)] ?? s.line.at); return true; }
      if (s.line.panel === 'try' && s.line.drawer) { openOutput(s.line.drawer, tryRowService()); return true; }
      return false;
    case 'Delete': if (s.line.drawer) set({ modal: { kind: 'deleteCard', id: s.line.drawer } }); return true;
    case 'X': if (s.line.drawer) openWorktrees(s.line.drawer); return true;
    case 'Enter': if (s.line.drawer) focusSay(s.line.drawer); return true;
    case 'y': case 'n': if (s.line.drawer) answerAsk(s.line.drawer, e.key === 'y' ? 'allow' : 'deny'); return true;
    case 'g': if (s.line.drawer) goToTab(s.line.drawer); return true;
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
    if (n && !ws) { flash(s.workspaces.length ? `There is no lane ${n}` : 'No lanes yet. W makes one.'); return true; }
    const filter = n === 0 ? 'all' : ws.id;
    setFilter(filter);
    set({ line: { ...get().line, focus: moveFocus(boardOf(get()), null, 1, 0) } });
    flash(n === 0 ? 'Every lane' : ws.name);
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

/** Enter on an open card: the message box to its session. */
function focusSay(id: string): void {
  const card = get().cards.find((c) => c.id === id);
  if (!card?.sessionId) { flash(`${card?.key ?? 'It'} hasn’t started yet`); return; }
  focusField('card-say');
}

/** Send what's in the message box to the card's session (§93); one that isn't running is resumed by the send. */
export function saySubmit(id: string): void {
  const el = document.getElementById('card-say') as HTMLTextAreaElement | null;
  const text = el?.value.trim();
  if (!el || !text) return;
  const card = get().cards.find((c) => c.id === id);
  if (card && !reachable(card)) flash(card.runner === 'app' ? `Resuming ${card.key}’s session; your message goes in with it` : `Moving ${card.key}’s session into the app; your message goes in with it`);
  // The box empties at once (the message shows in the chat); the text comes back if the send fails.
  el.value = '';
  sayToCard(id, text).catch((e: Error) => { if (!el.value) el.value = text; flash(e.message); });
}

/** The card's session is running a turn in the app right now (§93): live, and not between turns. */
export function cardTurnRunning(s: ReturnType<typeof get>, card: { runner?: string; sessionId?: string } | undefined): boolean {
  if (card?.runner !== 'app' || !card.sessionId) return false;
  const live = s.sessions.find((x) => x.id === card.sessionId);
  return Boolean(live?.live && live.status && live.status !== 'idle' && live.status !== 'stopped');
}

/** Esc on an open card whose session the app runs, while Claude works: stop the turn, as Esc does in Claude Code. */
export function stopCard(id: string): boolean {
  const card = get().cards.find((c) => c.id === id);
  if (!card?.sessionId || !cardTurnRunning(get(), card)) return false;
  send({ type: 'session.interrupt', id: card.sessionId });
  flash(`Stopped ${card.key}: Esc again goes back to the board`);
  return true;
}

/** Shift+X: the card's worktrees, to remove them (with their branch) once the card is done. */
export function openWorktrees(id: string, thenDelete = false): void {
  const card = get().cards.find((c) => c.id === id);
  if (!card) return;
  if (!ownFolders(card).length) { flash(`${card.key} has no worktrees: it works in ${card.cwd ? repoName(card.cwd) : 'its repo'}’s own folder`); return; }
  set({ modal: { kind: 'worktrees', id, ...(thenDelete ? { thenDelete } : {}) } });
}

/** D: what the card changed, file by file with the diffs, without leaving for an editor. */
export function openChanges(id: string, at?: number): void {
  const card = get().cards.find((c) => c.id === id);
  if (!card) return;
  if (!card.cwd) { flash(`${card.key} hasn’t started yet: nothing changed`); return; }
  set({ modal: { kind: 'changes', id, ...(at !== undefined ? { at } : {}) } });
}

/** f in the Try it panel (§84): a service's output full width, as it prints; `service` is the row highlighted (none: the card's own run). */
export function openOutput(id: string, service?: string): void {
  const s = get();
  if (!runsOf(s.runs, id).length) { flash('Nothing has run for this card yet: t starts it'); return; }
  set({ modal: { kind: 'output', id, ...(service ? { service } : {}) } });
}

/** g: the card in a terminal. A session the app runs moves to a new Windows Terminal tab (§93); a terminal card's tab comes to the front. */
export function goToTab(id: string): void {
  const card = get().cards.find((c) => c.id === id);
  if (!card) return;
  if (!card.cwd || !card.sessionId) { flash(`${card.key} hasn’t started a session yet`); return; }
  const fromApp = card.runner === 'app';
  focusCardTab(id).then((reopened) => flash(fromApp ? `Opened ${card.key} in a terminal tab: the card follows it there` : reopened ? `${card.key}’s tab was gone: opened a new one on its session` : `Brought the tab ${card.key} forward`), (e: Error) => flash(e.message));
}

export function answerAsk(id: string, behavior: 'allow' | 'deny'): void {
  const card = get().cards.find((c) => c.id === id);
  const ask = card && askOf(card);
  if (!ask) { flash(`${card?.key ?? 'It'} isn’t asking anything`); return; }
  if (ask.kind === 'question') { flash('Answer in the message box (Enter)'); return; }
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
  // The question form's "Type something" box (§91): Enter is done with it, Esc leaves it; the rest types.
  if (el.id.startsWith('q-other-')) {
    if (e.key === 'Escape') { el.blur(); return true; }
    if (e.key === 'Enter') { el.blur(); questionHooks.otherDone(); return true; }
    return false;
  }
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
  const cols = lanes(s.cards.filter((c) => c.id !== id), s.line.filter, s.line.q, inboxOf(s), doneTicketsOf(s));
  set({ line: { ...s.line, drawer: s.line.drawer === id ? null : s.line.drawer, focus: s.line.focus === id ? moveFocus(cols, null, 1, 0) : s.line.focus } });
}
