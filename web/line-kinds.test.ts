import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrTarget } from '../shared/cards.ts';
import type { Workspace } from '../shared/protocol.ts';
import type { Ticket } from '../shared/tickets.ts';
import { lanes, stepCard } from './line-model.ts';
import { addFolder, branchOpts, cardFolders, cycleKind, draftOf, goRows, gotPr, newComposer, nextTab, pickOption, pickTicket, setKind, ticketSources, wantsPr } from './line-model.ts';

const W: Workspace = { id: 'w1', name: 'Workspaces', color: 'blue', repos: ['D:/r/ui', 'D:/r/api'], home: 'D:/r/ui', notes: 'Proxy to Okteto.', testing: 'Scenarios come from the scenario tool.' };
const ticket = (key: string, over: Partial<Ticket> = {}): Ticket => ({
  key, source: 'jira', project: 'WSS', projectName: 'Workspaces', title: `${key} title`, description: 'd', acceptance: ['It works'],
  comments: [], attachments: [], links: [], status: 'In Progress', done: false, updatedAt: 1, workspaceId: 'w1', ...over,
});
const PR: PrTarget = { number: 318, title: 'Proxy', url: 'https://tfs/pr/318', host: 'azure', source: 'feature/WSS-2-proxy', target: 'develop', repo: 'D:/r/api' };

test('a ticket ready for QA opens as a QA card: plan mode, the current branch, the team’s testing notes', () => {
  const c = newComposer(W, 'CARD-1', ticket('WSS-2', { status: 'Ready for QA', views: ['qa'] }));
  assert.equal(c.kind, 'qa');
  assert.equal(c.launch.branch, 'current');
  assert.equal(c.launch.message, 'QA WSS-2: start with the test plan.');
  assert.deepEqual(c.packet.workspace.filter((i) => i.kind === 'note').map((i) => i.id), ['ws:notes', 'ws:testing']);
  const dev = newComposer(W, 'CARD-1', ticket('WSS-3'));
  assert.equal(dev.kind, 'build');
  assert.deepEqual(dev.packet.workspace.filter((i) => i.kind === 'note').map((i) => i.id), ['ws:notes'], 'development cards don’t get the testing notes');
});

test('k cycles the kind; the mode, branch, message and notes follow, and what you switched off stays off', () => {
  let c = newComposer(W, 'CARD-1', ticket('WSS-3'));
  c = { ...c, packet: { ...c.packet, workspace: c.packet.workspace.map((i) => (i.id === 'ws:notes' ? { ...i, on: false } : i)) } };
  c = cycleKind(c, 'WSS-3', [W]);
  assert.equal(c.kind, 'qa');
  assert.equal(c.kindTouched, true);
  assert.equal(c.packet.workspace.find((i) => i.id === 'ws:notes')!.on, false);
  assert.ok(c.packet.workspace.some((i) => i.id === 'ws:testing'));
  c = cycleKind(c, 'WSS-3', [W]);
  assert.equal(c.kind, 'review');
  assert.equal(c.launch.message, 'Review WSS-3.');
  assert.equal(goRows(c, [W], 'WSS-3')[0].opts[goRows(c, [W], 'WSS-3')[0].at], 'Code review');
  c = pickOption(c, 'kind', 0, [W], 'WSS-3');
  assert.equal(c.kind, 'build');
  assert.equal(c.launch.branch, 'new');
});

test('a chosen kind sticks when a ticket is picked; otherwise the ticket decides', () => {
  const blank = newComposer(W, 'CARD-1');
  const qa = ticket('WSS-2', { status: 'Ready for QA' });
  assert.equal((pickTicket(blank, qa, [W], new Set()) as ReturnType<typeof newComposer>).kind, 'qa');
  const chosen = setKind(blank, 'review', 'CARD-1', [W]);
  assert.equal((pickTicket(chosen, qa, [W], new Set()) as ReturnType<typeof newComposer>).kind, 'review');
});

test('a review looks up the PR once; found, it starts on the PR’s branch in its repo; not found, it stays on the current branch', () => {
  let c = setKind(newComposer(W, 'CARD-1', ticket('WSS-2')), 'review', 'WSS-2', [W]);
  assert.equal(wantsPr(c), 'WSS-2');
  assert.equal(branchOpts(c, 'WSS-2')[1].off, true, 'the PR branch waits for the lookup');
  c = gotPr({ ...c, prLooking: true }, 'WSS-2', PR, []);
  assert.equal(wantsPr(c), null, 'asked once per ticket');
  assert.equal(c.launch.branch, 'pr');
  assert.equal(c.launch.home, 'D:/r/api');
  const d = draftOf(c);
  assert.ok(typeof d !== 'string');
  assert.equal(d.kind, 'review');
  assert.equal(d.pr!.number, 318);
  const none = gotPr(setKind(newComposer(W, 'CARD-1', ticket('WSS-5')), 'review', 'WSS-5', [W]), 'WSS-5', undefined, ['ui: no open pull request']);
  assert.equal(none.launch.branch, 'current');
  assert.deepEqual(none.prNotes, ['ui: no open pull request']);
  assert.equal(gotPr(c, 'WSS-OTHER', undefined, []), c, 'an answer for another ticket is ignored');
  assert.equal(wantsPr(newComposer(W, 'CARD-1', ticket('WSS-3'))), null, 'development cards don’t look');
});

test('the search’s finds come after your own tickets, only while searching', () => {
  const c = { ...newComposer(W, 'CARD-1'), q: 'wss' };
  const found = [ticket('WSS-9', { found: true }), ticket('WSS-1')];
  assert.deepEqual(ticketSources(c, [ticket('WSS-1')], new Set(), found).map((t) => t.key), ['WSS-1', 'WSS-9']);
  assert.deepEqual(ticketSources({ ...c, q: '' }, [ticket('WSS-1')], new Set(), found).map((t) => t.key), ['WSS-1']);
});

test('Folders: any folder goes in like an extra repo, once; the tab lists the ones the library doesn’t', () => {
  assert.equal(nextTab('repos', 1), 'folders');
  assert.equal(nextTab('tickets', -1), 'folders');
  let c = newComposer(W, 'CARD-1');
  c = addFolder(c, 'D:/specs/loans') as typeof c;
  assert.deepEqual(cardFolders(c, []).map((i) => i.id), ['D:/specs/loans']);
  assert.match(addFolder(c, 'D:/specs/loans') as string, /already/);
  assert.match(addFolder(c, 'D:/r/ui') as string, /already/, 'a workspace repo is there already');
  assert.deepEqual(cardFolders(c, [{ path: 'D:/specs/loans', name: 'loans' }]), [], 'a library repo shows under Repos instead');
});

test('← → with a card open step through the cards the board shows, column by column, and stop at the ends', () => {
  const card = (id: string, stage: 'plan' | 'build' | 'ship', workspaceId = 'w1') => ({
    id, key: id, title: id, workspaceId, stage, createdAt: 0, boot: [],
    packet: { workspace: [], ticket: [], card: [], note: '' }, launch: { home: '', branch: 'new' as const, mode: 'plan' as const, message: '' },
  });
  const cols = lanes([card('s1', 'ship'), card('p1', 'plan'), card('b1', 'build'), card('p2', 'plan'), card('x', 'plan', 'w2')], 'w1');
  assert.deepEqual(stepCard(cols, 'p1', 1), { id: 'p2', at: 0, total: 4 });
  assert.equal(stepCard(cols, 'p2', 1).id, 'b1', 'on to the next column');
  assert.equal(stepCard(cols, 'b1', 1).id, 's1');
  assert.equal(stepCard(cols, 's1', 1).id, null, 'the last card');
  assert.equal(stepCard(cols, 'p1', -1).id, null, 'the first card');
  assert.equal(stepCard(cols, 'x', 1).at, -1, 'a card the board doesn’t show');
});
