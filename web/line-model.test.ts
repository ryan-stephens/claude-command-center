import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Card } from '../shared/cards.ts';
import type { Workspace } from '../shared/protocol.ts';
import {
  cardActivity, cycleModel, draftOf, elapsed, goRows, keepForWorkspace, lanes, lineSessions, moveFocus, needsYou, progress, shortPath, newComposer, packetRows, pickOption, repoOrigin,
  setWorkspace, sources, stepOption, togglePacketRow, toggleSource,
  type Composer,
} from './line-model.ts';

const W1: Workspace = { id: 'w1', name: 'Storefront', color: 'blue', repos: ['D:\\r\\web-app', 'D:\\r\\tokens'], home: 'D:\\r\\tokens' };
const W2: Workspace = { id: 'w2', name: 'Payments', color: 'green', repos: ['D:\\r\\pay'] };

const card = (id: string, stage: Card['stage'], workspaceId: string | null = 'w1'): Card => ({
  id, key: id, title: id, workspaceId, stage, createdAt: 0, boot: [],
  packet: { workspace: [], ticket: [], card: [], note: '' }, launch: { home: '', branch: 'new', mode: 'plan', message: '' },
});

test('lanes put cards in their stage, and the filter keeps one workspace', () => {
  const cs = [card('a', 'plan'), card('b', 'build', 'w2'), card('c', 'plan')];
  const all = lanes(cs, 'all');
  assert.equal(all.length, 7);
  assert.deepEqual(all.find((l) => l.stage === 'plan')!.cards.map((c) => c.id), ['a', 'c']);
  assert.deepEqual(lanes(cs, 'w2').flatMap((l) => l.cards.map((c) => c.id)), ['b']);
});

test('arrows walk the board and skip empty columns, keeping the row where they can', () => {
  const cols = lanes([card('a', 'plan'), card('c', 'plan'), card('b', 'try')], 'all');
  assert.equal(moveFocus(cols, null, 1, 0), 'a', 'no focus: the first card');
  assert.equal(moveFocus(cols, 'a', 0, 1), 'c');
  assert.equal(moveFocus(cols, 'c', 0, 1), 'c', 'stops at the bottom');
  assert.equal(moveFocus(cols, 'c', 1, 0), 'b', 'jumps over the empty Build and Needs you');
  assert.equal(moveFocus(cols, 'b', 1, 0), 'b', 'nothing further right');
  assert.equal(moveFocus(cols, 'b', -1, 0), 'a');
});

test('a new card starts with its workspace’s repos, from the workspace’s home', () => {
  const c = newComposer(W1, 'CARD-3');
  assert.deepEqual(c.packet.workspace.map((i) => i.label), ['web-app', 'tokens']);
  assert.equal(c.launch.home, 'D:\\r\\tokens');
  assert.equal(c.launch.message, 'Plan CARD-3.');
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
  assert.equal(stepOption(c, where, 1, [W1, W2], 'CARD-3'), c, 'In the app is not offered yet');
  const auto = pickOption(c, 'mode', 2, [W1, W2], 'CARD-3');
  assert.equal(auto.launch.mode, 'auto');
  assert.equal(auto.launch.message, 'Work on CARD-3.');
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
  assert.match(String(draftOf(c)), /title/);
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
});

test('the / filter narrows the board by key, title or branch, every word', () => {
  const cs = [{ ...card('CARD-1', 'plan'), title: 'Gift card field' }, { ...card('CARD-2', 'build'), title: 'Footer links' }];
  assert.deepEqual(lanes(cs, 'all', 'gift').flatMap((l) => l.cards.map((c) => c.id)), ['CARD-1']);
  assert.deepEqual(lanes(cs, 'all', 'card-2').flatMap((l) => l.cards.map((c) => c.id)), ['CARD-2']);
  assert.deepEqual(lanes(cs, 'all', 'links gift').flatMap((l) => l.cards.map((c) => c.id)), []);
});

test('Alt+arrows walk the cards’ sessions, once each', () => {
  const cols = lanes([{ ...card('a', 'plan'), sessionId: 's1' }, card('b', 'plan'), { ...card('c', 'try'), sessionId: 's2' }], 'all');
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
