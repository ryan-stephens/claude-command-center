import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packetText, type Card } from '../shared/cards.ts';
import type { Workspace } from '../shared/protocol.ts';
import type { Ticket } from '../shared/tickets.ts';
import {
  addComposer, additionOf, cardActivity, composerKey, ticketSources, cycleModel, draftOf, dropTicket, pickTicket, elapsed, goRows, keepForWorkspace, lineSessions, needsYou, progress, shortPath, newComposer, packetRows, pickOption, repoOrigin,
  setWorkspace, sources, stepOption, togglePacketRow, toggleSource,
  hasWork, asDraft, titleFromMessage, type Composer,
  addSource, cardFolders, looksLikePath, matches, removeSource, sourceOf, sourceRows, type RepoSource, editingKey,
} from './line-model.ts';

const W1: Workspace = { id: 'w1', name: 'Storefront', color: 'blue', repos: ['D:\\r\\web-app', 'D:\\r\\tokens'], home: 'D:\\r\\tokens' };
const W2: Workspace = { id: 'w2', name: 'Payments', color: 'green', repos: ['D:\\r\\pay'] };

const card = (id: string, stage: Card['stage'], workspaceId: string | null = 'w1'): Card => ({
  id, key: id, title: id, workspaceId, stage, createdAt: 0, boot: [],
  packet: { workspace: [], ticket: [], card: [], note: '' }, launch: { home: '', branch: 'new', mode: 'plan', message: '' },
});

test('a new-card screen is worth keeping once it has a title, a ticket, a note or context of its own', () => {
  const blank = newComposer(null, 'CARD-9');
  assert.equal(hasWork(blank), false);
  assert.equal(hasWork({ ...blank, title: '  ' }), false);
  assert.equal(hasWork({ ...blank, title: 'Size guide' }), true);
  assert.equal(hasWork({ ...blank, packet: { ...blank.packet, note: 'behind a flag' } }), true);
  assert.equal(hasWork({ ...blank, packet: { ...blank.packet, card: [{ kind: 'repo', id: 'D:/x', label: 'x', text: '', on: true }] } }), true);
  assert.equal(hasWork({ ...blank, title: 'Add to it', addTo: { id: '1', key: 'CARD-1' } as unknown as Composer['addTo'] }), false, 'adding to a card is one keystroke to redo');
  const back = asDraft({ ...blank, title: 'Size guide', starting: true, error: 'x', preview: true, q: 'shop' });
  assert.deepEqual([back.starting, back.error, back.preview, back.q, back.title], [false, null, false, '', 'Size guide']);
});


test('a new card starts with its workspace’s repos, from the workspace’s home', () => {
  const c = newComposer(W1, 'CARD-3');
  assert.deepEqual(c.packet.workspace.map((i) => i.label), ['web-app', 'tokens']);
  assert.equal(c.launch.home, 'D:\\r\\tokens');
  assert.equal(c.launch.message, '', 'no ticket: nothing to say yet ("Plan CARD-3." told Claude nothing, §131)');
  assert.deepEqual([c.launch.mode, c.launch.branch], ['default', 'current'], 'no ticket: a plain session, the repo as it is, asking first (§131)');
  const none = newComposer(null, 'CARD-3');
  assert.deepEqual(none.packet.workspace, []);
});

test('Space on a library repo adds it to the card, again takes it out; a workspace repo is switched off instead', () => {
  let c = newComposer(W1, 'CARD-3');
  c = toggleSource(c, 'D:\\r\\pay');
  assert.equal(repoOrigin(c, 'd:/r/pay'), 'card');
  c = toggleSource(c, 'D:\\r\\pay');
  assert.equal(repoOrigin(c, 'D:\\r\\pay'), null);
  c = toggleSource(c, 'D:\\r\\tokens');
  assert.equal(c.packet.workspace[1].on, false);
  assert.equal(c.launch.home, 'D:\\r\\web-app', 'the home moves off a repo that was left out');
});

test('the search filters the library', () => {
  const repos = [{ path: 'D:\\r\\web-app', name: 'web-app' }, { path: 'D:\\r\\pay', name: 'pay' }];
  assert.deepEqual(sources({ ...newComposer(W1, 'K'), q: 'PAY' }, repos).map((r) => r.name), ['pay']);
});

test('a folder of repos for one card: listed under its heading after the library, taken off again with what was picked kept', () => {
  const library = [{ path: 'D:\\r\\web-app', name: 'web-app' }, { path: 'D:\\r\\pay', name: 'pay' }];
  const side: RepoSource = { path: 'E:\\side', repos: [{ path: 'E:\\side\\api', name: 'api' }, { path: 'E:\\side\\web', name: 'web' }, { path: 'd:/r/pay', name: 'pay' }] };
  const kinds = (c: Composer) => sourceRows(c, library).map((r) => (r.kind === 'repo' ? `${r.from ? 'src:' : ''}${r.repo.name}` : r.kind));
  let c = newComposer(W1, 'K');
  assert.deepEqual(kinds(c), ['web-app', 'pay', 'more'], 'the library, then the row that adds a folder');
  const added = addSource(c, side);
  assert.ok(typeof added !== 'string');
  c = added;
  assert.deepEqual(kinds(c), ['web-app', 'pay', 'source', 'src:api', 'src:web', 'more'], 'a repo the library has is left to the library');
  assert.match(String(addSource(c, side)), /listed already/);
  assert.match(String(addSource(c, { path: 'D:\\r', repos: library }, ['d:/r/'])), /in the repo library already/);
  assert.match(String(addSource(c, { path: 'E:\\docs', repos: [] })), /No git repos in E:\\docs/);
  assert.deepEqual(kinds({ ...c, q: 'we' }), ['web-app', 'source', 'src:web', 'more'], 'the search filters every group');
  assert.deepEqual(kinds({ ...c, q: 'zzz' }), ['more'], 'a heading goes when nothing under it matches');
  assert.deepEqual(kinds({ ...c, q: 'E:\\other' }), ['web-app', 'pay', 'source', 'src:api', 'src:web', 'more'], 'a path in the box filters nothing out');
  assert.ok(looksLikePath('D:\\repos') && looksLikePath(' "C:/x"') && looksLikePath('\\\\nas\\repos') && looksLikePath('~/src') && !looksLikePath('web') && !looksLikePath('D:repos'));
  // A repo picked from the extra source is a card repo like any other, and the source knows it.
  c = toggleSource(c, 'E:\\side\\api');
  assert.equal(repoOrigin(c, 'e:/side/api'), 'card');
  assert.equal(sourceOf(c, 'E:\\side\\api')?.path, 'E:\\side');
  assert.deepEqual(cardFolders(c, library), [], 'a repo from a source is not a folder from disk');
  assert.deepEqual(sources(c, library).map((r) => r.name), ['web-app', 'pay', 'api', 'web'], 'the full look sees one flat list');
  // x on the heading: the folder and its unpicked repos go; api stays on the card, and still knows its folder.
  c = removeSource(c, 'e:/side');
  assert.deepEqual(kinds(c), ['web-app', 'pay', 'more']);
  assert.equal(repoOrigin(c, 'E:\\side\\api'), 'card');
  assert.equal(sourceOf(c, 'E:\\side\\api')?.path, 'E:\\side', 'the chip still says where it came from');
  assert.equal(sourceOf(c, 'E:\\side\\web'), null);
  assert.deepEqual(cardFolders(c, library), [], 'and it is still not a folder from disk');
  // The folder again: back in full, in the hidden one's place.
  c = addSource(c, side) as Composer;
  assert.deepEqual(kinds(c), ['web-app', 'pay', 'source', 'src:api', 'src:web', 'more']);
  assert.equal(c.sources?.length, 1);
  // Nothing picked from it: taking it off leaves nothing behind.
  assert.equal(removeSource(toggleSource(c, 'E:\\side\\api'), 'E:\\side').sources, undefined);
});

test('packet rows: include, leave out, remove only what the card added, never the last repo', () => {
  let c: Composer = toggleSource(newComposer(W2, 'CARD-1'), 'D:\\r\\extra');
  const rows = packetRows(c);
  assert.deepEqual(rows.map((r) => r.layer), ['workspace', 'card', 'note']);
  assert.match(String(togglePacketRow(c, 0, true)), /Only what you added/);
  c = togglePacketRow(c, 0) as Composer;
  assert.equal(c.packet.workspace[0].on, false);
  assert.equal(togglePacketRow(c, 1), 'A card needs at least one repo.');
  c = togglePacketRow(c, 0) as Composer;
  c = togglePacketRow(c, 1, true) as Composer;
  assert.deepEqual(c.packet.card, []);
});

test('launch options: arrows skip what is not offered yet, the mode rewrites an untouched message', () => {
  const c = newComposer(W1, 'CARD-3');
  const rows = goRows(c, [W1, W2], 'CARD-3');
  const where = rows.find((r) => r.id === 'where')!;
  assert.equal(stepOption(c, where, 1, [W1, W2], 'CARD-3'), c, 'only the terminal tab is offered');
  const auto = pickOption(c, 'mode', 2, [W1, W2], 'CARD-3');
  assert.equal(auto.launch.mode, 'auto');
  assert.equal(auto.launch.message, '', 'no ticket: the mode has no message to rewrite');
  const fromTicket = newComposer(W2, 'CARD-3', ticket('PAY-9'));
  assert.equal(pickOption(fromTicket, 'mode', 2, [W1, W2], 'CARD-3').launch.message, 'Work on PAY-9.', 'a ticket card: the mode rewrites its untouched message');
  const typed = pickOption({ ...c, msgTouched: true, launch: { ...c.launch, message: 'Mine' } }, 'mode', 1, [W1, W2], 'CARD-3');
  assert.equal(typed.launch.message, 'Mine');
  const moved = stepOption(c, rows.find((r) => r.id === 'ws')!, 1, [W1, W2], 'CARD-3');
  assert.equal(moved.workspaceId, 'w2');
  assert.deepEqual(moved.packet.workspace.map((i) => i.label), ['pay']);
  assert.equal(moved.launch.home, 'D:\\r\\pay');
  assert.equal(setWorkspace(c, null).workspaceId, null);
});

test('start work needs a title and a repo', () => {
  const c = newComposer(W1, 'CARD-3');
  assert.match(String(draftOf(c)), /Say what Claude should do/);
  // §131: no ticket and no title: what you asked names the card.
  const asked = draftOf({ ...c, msgTouched: true, launch: { ...c.launch, message: '\n  Fix the flaky login test\nand explain what was wrong' } }) as { title: string; launch: { message: string } };
  assert.equal(asked.title, 'Fix the flaky login test');
  assert.match(asked.launch.message, /explain what was wrong/);
  assert.ok(titleFromMessage('word '.repeat(30)).endsWith('…'), 'a long first line is cut at a word');
  assert.ok(titleFromMessage('word '.repeat(30)).length <= 81);
  // A title and no message: the title is what Claude is asked.
  const titled = draftOf({ ...c, title: 'Add a size guide' }) as { launch: { message: string } };
  assert.equal(titled.launch.message, 'Add a size guide');
  assert.match(String(draftOf({ ...newComposer(null, 'K'), title: 'x' })), /at least one repo/);
  const d = draftOf({ ...c, title: ' Size guide ' });
  assert.equal(typeof d, 'object');
  assert.equal((d as { title: string }).title, 'Size guide');
});

test('the tile line follows the session once linked; needs-you covers asks and stuck starts', () => {
  const c = card('a', 'build');
  assert.deepEqual(cardActivity({ ...c, boot: [{ at: 0, text: 'Waiting for the session to start', state: 'go' }] }), { text: 'Waiting for the session to start', state: 'go' });
  const linked = { ...c, sessionId: 's', live: { phase: 'needs' as const, text: 'Plan ready', at: 0 } };
  assert.deepEqual(cardActivity(linked), { text: 'Plan ready', state: 'bad' });
  assert.ok(needsYou(linked));
  assert.ok(needsYou({ ...c, boot: [{ at: 0, text: 'No word', state: 'bad' }] }));
  assert.ok(!needsYou({ ...linked, live: { ...linked.live, phase: 'working' } }));
});

test('progress, elapsed time and short paths', () => {
  assert.equal(progress(card('a', 'build')), null);
  assert.deepEqual(progress({ ...card('a', 'build'), todos: [{ id: '1', content: 'x', status: 'completed' }, { id: '2', content: 'y', status: 'in_progress' }] }), { done: 1, total: 2 });
  assert.equal(elapsed(0, 30_000), 'just now');
  assert.equal(elapsed(0, 42 * 60_000), '42m');
  assert.equal(elapsed(0, 65 * 60_000), '1h 05m');
  assert.equal(shortPath('C:\\Repos\\web-app\\src\\a.ts', 'c:/repos/web-app'), 'src/a.ts');
  assert.equal(shortPath('D:\\other\\b.ts', 'C:\\repos\\web-app'), 'D:\\other\\b.ts');
  // A file in another repo of the card (its worktree) is named after the repo, not the worktree's folder.
  const folders = [{ repo: 'C:\\repos\\web-app', dir: 'C:\\repos\\web-app-card-1' }, { repo: 'C:\\repos\\loans-api', dir: 'C:\\repos\\loans-api-card-1' }];
  assert.equal(shortPath('C:\\repos\\web-app-card-1\\src\\a.ts', 'C:\\repos\\web-app-card-1', folders), 'src/a.ts');
  assert.equal(shortPath('C:\\repos\\loans-api-card-1\\Fees.cs', 'C:\\repos\\web-app-card-1', folders), 'loans-api/Fees.cs');
  assert.equal(shortPath('D:\\other\\b.ts', 'C:\\repos\\web-app-card-1', folders), 'D:\\other\\b.ts');
});

test('the / filter matches every word, anywhere in the text', () => {
  assert.equal(matches('gift', 'CARD-1 Gift card field'), true);
  assert.equal(matches('card-2', 'CARD-2 Footer links'), true);
  assert.equal(matches('links gift', 'CARD-2 Footer links'), false);
  assert.equal(matches('  ', 'anything'), true);
});

test('Alt+arrows walk the cards’ sessions, once each', () => {
  const cols = [{ cards: [{ ...card('a', 'plan'), sessionId: 's1' }, card('b', 'plan'), { ...card('c', 'try'), sessionId: 's2' }, { ...card('d', 'try'), sessionId: 's1' }] }];
  assert.deepEqual(lineSessions(cols), ['s1', 's2']);
});

test('w keeps a repo the card added for the whole workspace', () => {
  const c = toggleSource(newComposer(W1, 'CARD-3'), 'D:\\r\\pay');
  const at = packetRows(c).findIndex((r) => r.layer === 'card');
  const r = keepForWorkspace(c, at);
  assert.equal(typeof r, 'object');
  const { composer, repo } = r as { composer: Composer; repo: string };
  assert.equal(repo, 'D:\\r\\pay');
  assert.deepEqual(composer.packet.workspace.map((i) => i.label), ['web-app', 'tokens', 'pay']);
  assert.equal(composer.packet.card.length, 0);
  assert.match(String(keepForWorkspace(c, 0)), /Only a repo you added/);
  assert.match(String(keepForWorkspace({ ...c, workspaceId: null }, at)), /no workspace/);
});

test('the model: the default is named, ← → or m pick Opus, Sonnet, Haiku and back', () => {
  const c = newComposer(W1, 'CARD-3');
  const row = (x: Composer, d = {}) => goRows(x, [W1], 'CARD-3', d).find((r) => r.id === 'model')!;
  assert.deepEqual(row(c).opts, ['Default', 'Opus', 'Sonnet', 'Haiku']);
  assert.equal(row(c, { user: 'opus' }).opts[0], 'Default · Opus');
  assert.equal(row(c, { pinned: 'claude-haiku-4-5-20251001', user: 'opus' }).opts[0], 'Default · claude-haiku-4-5-20251001', 'the server’s pin is the default');
  const sonnet = stepOption(stepOption(c, row(c), 1, [W1], 'CARD-3'), row(c), 2, [W1], 'CARD-3');
  assert.equal(sonnet.launch.model, 'sonnet');
  assert.equal(row(sonnet).at, 2);
  let m = c;
  const seen = [];
  for (let i = 0; i < 4; i++) { m = cycleModel(m); seen.push(m.launch.model ?? 'default'); }
  assert.deepEqual(seen, ['opus', 'sonnet', 'haiku', 'default']);
  assert.ok(!('model' in m.launch), 'back to the default drops the flag');
  assert.equal((draftOf({ ...cycleModel(c), title: 'x' }) as { launch: { model?: string } }).launch.model, 'opus');
});

const ticket = (key: string, over: Partial<Ticket> = {}): Ticket => ({
  key, source: 'jira', project: key.split('-')[0], projectName: 'Storefront', title: `Title of ${key}`, description: 'Desc', acceptance: ['Works'],
  comments: [], attachments: [], links: [], status: 'To Do', done: false, updatedAt: 0, workspaceId: 'w2', ...over,
});


test('picking tickets: the first is the card’s (its title, parts and mapped workspace), later ones related', () => {
  const c = newComposer(W1, 'CARD-3');
  assert.equal(c.tab, 'tickets');
  const r = pickTicket(c, ticket('PAY-9'), [W1, W2], new Set()) as Composer;
  assert.equal(r.ticket!.key, 'PAY-9');
  assert.equal(r.title, 'Title of PAY-9');
  assert.equal(r.workspaceId, 'w2', 'the project maps to Payments');
  assert.deepEqual(r.packet.workspace.map((i) => i.label), ['pay']);
  assert.deepEqual(r.packet.ticket.map((i) => i.kind), ['desc', 'ac']);
  assert.equal(r.launch.message, 'Plan PAY-9.');
  assert.deepEqual([r.launch.mode, r.launch.branch], ['plan', 'worktree'], 'a ticket card starts as one does (§131)');
  assert.equal(composerKey(r, 'CARD-3'), 'PAY-9');
  assert.match(String(pickTicket(r, ticket('PAY-9'), [W1, W2], new Set())), /this card’s ticket/);
  const rel = pickTicket(r, ticket('SHOP-4'), [W1, W2], new Set()) as Composer;
  assert.deepEqual(rel.packet.card.map((i) => i.label), ['Related ticket: SHOP-4 Title of SHOP-4']);
  assert.equal((pickTicket(rel, ticket('SHOP-4'), [W1, W2], new Set()) as Composer).packet.card.length, 0, 'Space again takes it out');
  assert.match(String(pickTicket(c, ticket('PAY-9'), [W1, W2], new Set(['PAY-9']))), /already has a card/);
  const d = draftOf(r) as { title: string; ticketKey?: string };
  assert.equal(d.ticketKey, 'PAY-9');
  assert.equal(d.title, 'Title of PAY-9');
  const back = dropTicket(r, 'CARD-3');
  assert.equal(back.ticket, null);
  assert.equal(back.packet.ticket.length, 0);
  assert.equal(back.launch.message, '');
  assert.deepEqual([back.launch.mode, back.launch.branch], ['default', 'current'], 'the ticket off: a plain session again');
  const order = ticketSources(c, [ticket('A-1', { done: true, updatedAt: 9 }), ticket('A-2', { updatedAt: 1 }), ticket('A-3', { updatedAt: 5 }), ticket('A-4', { updatedAt: 8 })], new Set(['A-4']));
  assert.deepEqual(order.map((t) => t.key), ['A-3', 'A-2', 'A-4', 'A-1'], 'open first, then on the line, then done');
  const fromTicket = newComposer(W2, 'CARD-3', ticket('PAY-9'));
  assert.equal(fromTicket.tab, 'repos', 'from a ticket, panel 1 opens on the repos');
  assert.equal(fromTicket.title, 'Title of PAY-9');
});

test('c in a card’s drawer adds to it: only new things, and never a second own ticket', () => {
  const running: Card = {
    ...card('SHOP-155', 'build'), ticket: ticket('SHOP-155'),
    packet: { workspace: [{ kind: 'repo', id: 'D:\r\web-app', label: 'web-app', on: true }], ticket: [], card: [], note: '' },
    later: [{ kind: 'ticket', id: 'ticket:SHOP-98', label: 'Related ticket: SHOP-98', on: true, at: 1, sent: 2 }],
  };
  let c = addComposer(running, [ticket('SHOP-160')]);
  assert.equal(composerKey(c, 'CARD-7'), 'SHOP-155');
  assert.equal(c.tab, 'tickets');
  assert.match(additionOf(c) as string, /Add something first/);
  assert.equal(toggleSource(c, 'D:\r\web-app'), c, 'a repo it has is not added again');
  c = toggleSource(c, 'D:\r\tokens');
  assert.match(pickTicket(c, ticket('SHOP-155'), [W1], new Set()) as string, /own ticket/);
  assert.match(pickTicket(c, ticket('SHOP-98'), [W1], new Set()) as string, /already has SHOP-98/);
  c = pickTicket(c, ticket('SHOP-160'), [W1], new Set(['SHOP-155'])) as Composer;
  assert.equal(c.ticket, null, 'a ticket picked here is related, never the card’s own');
  assert.deepEqual(c.packet.card.map((i) => i.id), ['D:\r\tokens', 'ticket:SHOP-160']);
  assert.equal(typeof togglePacketRow(c, 0), 'object', 'the only repo here can be left out: the card has others');
  assert.match(keepForWorkspace(c, 0) as string, /running card/);
  assert.deepEqual(goRows(c, [W1], 'SHOP-155').map((r) => r.id), ['deliver']);
  const add = additionOf({ ...c, packet: { ...c.packet, note: ' Round down. ' } });
  assert.ok(typeof add === 'object');
  assert.equal(add.items.length, 2);
  assert.equal(add.note, 'Round down.');
});

test('the workspace layer carries the home repo’s run recipe, and Claude is told how to run the app', () => {
  const recipes = { 'D:\\r\\tokens': { repo: 'D:\\r\\tokens', steps: ['pnpm install', 'pnpm dev'], url: 'http://localhost:5173', source: 'detected from package.json' } };
  const c = newComposer(W1, 'CARD-3', null, recipes);
  const recipe = c.packet.workspace.find((i) => i.kind === 'recipe')!;
  assert.equal(recipe.label, 'How it runs: pnpm install, pnpm dev');
  assert.match(packetText({ ...c, title: 'x' }, 'CARD-3'), /## Running the app\nIn tokens: pnpm install && pnpm dev, then open http:\/\/localhost:5173\./);
  const off = togglePacketRow(c, c.packet.workspace.indexOf(recipe)) as Composer;
  assert.doesNotMatch(packetText({ ...off, title: 'x' }, 'CARD-3'), /Running the app/, 'Space leaves it out');
  assert.equal(setWorkspace(c, W2, recipes).packet.workspace.some((i) => i.kind === 'recipe'), false, 'Payments has no recipe');
});

test('editingKey: the box keeps paste, copy, undo and word delete; the app keeps Ctrl+Enter, Ctrl+arrows and Alt', () => {
  const k = (key: string, m: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => editingKey({ key, ctrlKey: false, altKey: false, metaKey: false, ...m });
  for (const key of ['v', 'c', 'x', 'a', 'z', 'y', 'V', 'Backspace', 'Delete']) assert.ok(k(key, { ctrlKey: true }), key);
  assert.ok(k('v', { metaKey: true }));
  for (const key of ['Enter', 'ArrowLeft', 'ArrowUp', 'k']) assert.ok(!k(key, { ctrlKey: true }), key);
  assert.ok(!k('v'), 'no modifier: typing');
  assert.ok(!k('v', { ctrlKey: true, altKey: true }), 'Ctrl+Alt is AltGr on some layouts, or the app');
});
