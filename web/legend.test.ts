import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legendFor, lineLegendFor, type LegendInput } from './legend.ts';

const base: LegendInput = { zone: 'composer', pending: false, busy: false, drafting: false, bindings: {} };
const labels = (x: Partial<LegendInput>) => legendFor({ ...base, ...x }).map((i) => `${i.keys.join('+')} ${i.label}`);

test('session: Esc means stop while busy, and typing hides the numpad and talk keys', () => {
  assert.ok(labels({ busy: true }).includes('Esc Stop Claude'));
  assert.ok(!labels({ busy: false }).includes('Esc Stop Claude'));
  assert.ok(labels({}).includes('Hold ` Talk'));
  assert.ok(!labels({ drafting: true }).some((x) => x.includes('Talk')));
  assert.ok(labels({ pending: true }).includes('Tab Answer Claude'));
  assert.deepEqual(labels({ zone: 'board', pending: true }).slice(0, 4), ['← →+Enter Choose', 'Y Allow', 'A Always', 'N Don’t allow']);
  assert.ok(labels({ zone: 'board' }).includes('Esc Ticket Line'));
  assert.ok(labels({}).includes('Ctrl+Enter Back to the line'), 'the expand key goes back where the session was opened from');
});

test('g goes to the card’s tab, and says so louder when the tab is waiting on you', () => {
  const line = (x: Partial<Parameters<typeof lineLegendFor>[0]>) => lineLegendFor({ view: 'drawer', bindings: {}, ...x }).map((i) => `${i.keys.join('+')} ${i.label}${i.tone ? ` (${i.tone})` : ''}`);
  assert.ok(!line({}).some((x) => x.startsWith('g ')), 'no tab yet, no g');
  assert.ok(line({ hasTab: true }).includes('g Its tab'));
  assert.ok(line({ hasTab: true, needsTab: true }).includes('g Answer in its tab (attn)'));
  assert.ok(line({ hasTab: true, needsTab: true, inApp: true }).includes('g In a terminal'), 'a session the app runs is answered on the card; g opens it in a terminal (§93)');
  assert.ok(line({ working: true }).includes('Esc Stop Claude'), 'while its turn runs, Esc stops it');
  assert.ok(line({}).includes('Esc Back to the board'));
  assert.ok(lineLegendFor({ view: 'board', hasFocus: true, hasTab: true, bindings: {} }).some((i) => i.keys[0] === 'g'));
});

test('rebound keys show their current binding', () => {
  assert.ok(labels({ bindings: { pushToTalk: ['F9'] } }).includes('Hold F9 Talk'));
  assert.ok(labels({ bindings: { expand: ['Alt+Enter'] } }).includes('Alt+Enter Back to the line'));
});

test('a question or a plan changes the answer keys', () => {
  const q = labels({ zone: 'board', pending: true, pendingKind: 'question' });
  assert.ok(q.includes('↑+↓ Choose') && q.includes('Enter Pick') && q.includes('N Skip'));
  assert.ok(!q.includes('Y Allow'), 'a question is answered, not allowed');
  const p = labels({ zone: 'board', pending: true, pendingKind: 'plan' });
  assert.ok(p.includes('Y Start the plan') && p.includes('N Keep planning'));
  assert.ok(labels({ zone: 'composer' }).includes('⇧Tab Mode'));
});

test('the Ticket Line bar follows the view and the new-card panel', () => {
  const labels = (x: Parameters<typeof lineLegendFor>[0]) => lineLegendFor(x).map((i) => i.label);
  assert.deepEqual(labels({ view: 'board', bindings: {} }), ['Move', 'New card', 'Tickets', 'Inbox: mine / QA', 'Lane / all', 'Filter', 'Repos', 'Lane', 'Share / import', 'Folders']);
  const focused = labels({ view: 'board', hasFocus: true, hasSession: true, filtered: true, bindings: {} });
  assert.ok(focused.includes('Open the card') && focused.includes('Its session') && focused.includes('Clear filter') && focused.includes('Remove') && focused.includes('How it runs'));
  assert.ok(!labels({ view: 'board', hasFocus: true, bindings: {} }).includes('Its session'), 'no session linked yet: nothing to open');
  assert.ok(labels({ view: 'composer', pane: 'src', bindings: {} }).includes('Add or remove'));
  assert.ok(labels({ view: 'composer', pane: 'src', bindings: {} }).includes('Tickets / Repos / Folders'));
  assert.equal(labels({ view: 'board', onTicket: true, bindings: {} })[1], 'Start work', 'a ticket in the Inbox: n starts work');
  assert.equal(labels({ view: 'board', onTicket: true, bindings: {} })[2], 'Hide', 'and Delete hides it');
  assert.ok(labels({ view: 'composer', pane: 'pkt', bindings: {} }).includes('Include or leave out'));
  assert.ok(!labels({ view: 'composer', pane: 'pkt', bindings: {} }).includes('Keep for the lane'));
  assert.ok(labels({ view: 'composer', pane: 'pkt', cardRepo: true, bindings: {} }).includes('Keep for the lane'));
  assert.ok(!labels({ view: 'composer', pane: 'pkt', preview: true, bindings: {} }).includes('Remove'), 'the preview has nothing to toggle');
  assert.ok(labels({ view: 'composer', pane: 'go', bindings: {} }).includes('Change'));
  assert.deepEqual(labels({ view: 'drawer', bindings: {} }), ['Back to the board', 'Previous / next card', 'Changes', 'Try it', 'Verify', 'Context', 'More', 'How it runs', 'Remove card']);
  assert.ok(labels({ view: 'drawer', hasSession: true, bindings: {} }).includes('Its session'));
  assert.deepEqual(labels({ view: 'drawer', canSay: true, asking: true, bindings: {} }).slice(0, 3), ['Back to the board', 'Allow / deny', 'Type to it'], 'a channel: y / n first while it asks, then Enter');
  assert.ok(!labels({ view: 'drawer', bindings: {} }).includes('Type to it'), 'no session yet: no message box (a card with one can always be typed to, §85)');
  assert.deepEqual(labels({ view: 'drawer', ship: 'merge', canDone: true, hasPr: true, bindings: {} }).slice(7, 10), ['Open the PR', 'Merge', 'Done'], 'a card in Ship: o opens the PR, d is done by hand (after the five dock keys)');
  assert.deepEqual(labels({ view: 'drawer', question: true, asking: false, canSay: true, bindings: {} }).slice(1, 4), ['Pick', 'Next question', 'Submit answers'], 'Claude’s question form up (§91): digits, Tab, y');
  assert.deepEqual(labels({ view: 'drawer', panel: 'changes', bindings: {} }).slice(2, 7), ['File', 'Fold diff', 'Fold repo', 'Pop out', 'Close Changes'], 'the Changes panel open: j k walk files, Space and z fold (§90), f is the full sheet, its key closes it');
  assert.deepEqual(labels({ view: 'drawer', panel: 'try', hasStack: true, canTry: true, bindings: {} }).slice(2, 8), ['Service', 'Tick / environment', 'Start this one', 'Stop this one', 'Output', 'Changes'], 'the Try it panel with a stack: the service keys, then f for the output');
  assert.ok(!labels({ view: 'drawer', panel: 'try', bindings: {} }).includes('Output'), 'nothing to run: no output key');
  assert.deepEqual(labels({ view: 'drawer', canAdd: true, hasWaiting: true, bindings: {} }).slice(7, 10), ['How it runs', 'Add context', 'Take back']);
  assert.deepEqual(labels({ view: 'drawer', hasWorktrees: true, bindings: {} }).slice(-2), ['Worktrees', 'Remove card'], 'a worktree card: Shift+X before Delete');
  assert.ok(!labels({ view: 'drawer', bindings: {} }).includes('Worktrees'));
  assert.ok(labels({ view: 'board', hasFocus: true, hasWorktrees: true, bindings: {} }).includes('Worktrees'));
  assert.deepEqual(labels({ view: 'drawer', canTry: true, bindings: {} }).slice(7, 9), ['Start the app', 'How it runs'], 'open card: t starts the app (Try it is the dock panel)');
  assert.deepEqual(labels({ view: 'drawer', canTry: true, appRunning: true, appUp: true, bindings: {} }).slice(7, 9), ['Stop the app', 'Open the app']);
  assert.ok(labels({ view: 'board', hasFocus: true, canTry: true, bindings: {} }).includes('Try it'));
  assert.ok(labels({ view: 'board', hasFocus: true, ship: 'ship', bindings: {} }).includes('Ship'));
  assert.ok(labels({ view: 'drawer', ship: 'merge', bindings: {} }).includes('Merge'));
  assert.ok(labels({ view: 'drawer', ship: 'rest', bindings: {} }).includes('Ship the rest'), 'a ship that stopped part-way');
  const adding = labels({ view: 'composer', pane: 'pkt', addingTo: 'SHOP-155', cardRepo: true, bindings: {} });
  assert.ok(adding.includes('Add to SHOP-155') && !adding.includes('Model') && !adding.includes('Keep for the lane'), 'adding to a running card');
  assert.deepEqual(lineLegendFor({ view: 'board', hasSession: true, hasFocus: true, bindings: { expand: ['Alt+Enter'] } }).find((i) => i.label === 'Its session')!.keys, ['Alt+Enter']);
  // The simple look's Add context popup on Repos: b adds a folder of repos for this card; x only on a folder's heading (§65).
  const base = { block: 'context' as const, adding: true, context: true, more: false, hasTicket: true, ownChip: false };
  assert.deepEqual(labels({ view: 'composer', addingTo: 'SHOP-160', simple: { ...base, repos: true }, bindings: {} }).slice(-2), ['Add to SHOP-160', 'Cancel'], '+ Context on an open card (§88): Ctrl+Enter adds, Esc cancels');
  const onRepos = labels({ view: 'composer', simple: { ...base, repos: true }, bindings: {} });
  assert.ok(onRepos.includes('A folder of repos') && !onRepos.includes('Take the folder off'), onRepos.join(','));
  assert.ok(labels({ view: 'composer', simple: { ...base, repos: true, onSource: true }, bindings: {} }).includes('Take the folder off'));
  assert.ok(!labels({ view: 'composer', simple: { ...base, folders: true }, bindings: {} }).includes('A folder of repos'));
  // The ticket block (§70): Space for the details, o only when the ticket has a link.
  const ticket = { block: 'ticket' as const, adding: false, more: false, hasTicket: true, ownChip: false };
  const onTicket = labels({ view: 'composer', simple: ticket, bindings: {} });
  assert.ok(onTicket.includes('Details') && !onTicket.includes('Open in the tracker'), onTicket.join(','));
  const linked = labels({ view: 'composer', simple: { ...ticket, details: true, ticketLink: true }, bindings: {} });
  assert.ok(linked.includes('Hide details') && linked.includes('Open in the tracker'), linked.join(','));
});
