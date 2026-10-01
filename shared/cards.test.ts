import assert from 'node:assert/strict';
import { test } from 'node:test';
import { branchFor, fmtK, folderFor, homeOf, includedRepos, isClean, kindDefaults, laterText, launchLines, memoryPct, modelFor, modelName, ownFolders, packetText, worktreeFor, wtArg, type CardDraft, type Packet } from './cards.ts';

const repo = (id: string, on = true) => ({ kind: 'repo' as const, id, label: id.split('\\').pop()!, on });
const packet = (over: Partial<Packet> = {}): Packet => ({
  workspace: [repo('D:\\repos\\web-app'), repo('D:\\repos\\design-tokens')],
  ticket: [],
  card: [repo('D:\\repos\\cdn-worker')],
  note: '',
  ...over,
});
const draft = (over: Partial<CardDraft> = {}): CardDraft => ({
  title: 'Add a size guide to product pages',
  workspaceId: 'w1',
  packet: packet(),
  launch: { home: 'D:\\repos\\web-app', branch: 'new', mode: 'plan', message: 'Plan CARD-3.' },
  ...over,
});

test('development starts in worktrees; QA and review on what is there', () => {
  assert.deepEqual(kindDefaults('build'), { mode: 'plan', branch: 'worktree' });
  assert.deepEqual(kindDefaults('qa'), { mode: 'plan', branch: 'current' });
  assert.equal(kindDefaults('review', { number: 1, title: '', url: 'http://x', host: 'github', source: 'a', target: 'b', repo: 'r' }).branch, 'pr');
});

test('a repo added later is handed over as its worktree, with the /add-dir to ask for', () => {
  const folders = [{ repo: 'D:\\repos\\loans-api', dir: 'D:\\repos\\loans-api-card-4' }, { repo: 'D:\\repos\\shop-ui', dir: 'D:\\repos\\shop-ui' }];
  const items = [repo('D:\\repos\\loans-api'), repo('D:\\repos\\notes')];
  const text = laterText('CARD-4', items, { folders });
  assert.match(text, /- loans-api: D:\\repos\\loans-api-card-4 \(a worktree of D:\\repos\\loans-api on this card’s branch; change it there, not in the usual folder\)/);
  assert.match(text, /- notes: D:\\repos\\notes\n/);
  assert.match(text, /until you run \/add-dir D:\\repos\\loans-api-card-4 in the tab/);
  assert.ok(!laterText('CARD-4', items).includes('/add-dir'), 'no worktrees, no ask');
  assert.deepEqual(ownFolders({ folders }).map((f) => f.dir), ['D:\\repos\\loans-api-card-4'], 'a folder that is the repo itself isn’t a worktree');
  assert.equal(isClean({ changed: false, unpushed: 0, missing: false }), true);
  assert.equal(isClean({ changed: true, unpushed: 0, missing: false }), false);
  assert.equal(isClean({ changed: false, unpushed: 2, missing: false }), false);
  assert.equal(isClean({ changed: true, unpushed: 2, missing: true }), true, 'gone already: nothing to lose');
});

test('included repos: workspace then card layer, skipping ones left out and duplicates', () => {
  const p = packet({ card: [repo('D:\\repos\\cdn-worker'), repo('d:/repos/web-app'), repo('D:\\repos\\old', false)] });
  assert.deepEqual(includedRepos(p), ['D:\\repos\\web-app', 'D:\\repos\\design-tokens', 'D:\\repos\\cdn-worker']);
});

test('the home repo falls back to the first included one when it was left out', () => {
  const p = packet({ workspace: [repo('D:\\repos\\web-app', false), repo('D:\\repos\\design-tokens')] });
  assert.equal(homeOf(p, { home: 'D:\\repos\\web-app' }), 'D:\\repos\\design-tokens');
  assert.equal(homeOf(packet(), { home: 'd:/repos/cdn-worker' }), 'D:\\repos\\cdn-worker');
});

test('branch names are short, lower case and git-safe', () => {
  assert.equal(branchFor('CARD-3', 'Add a size guide to product pages'), 'card-3-add-size-guide-product');
  assert.equal(branchFor('CARD-4', 'Fix: “weird” chars!! & stuff'), 'card-4-fix-weird-chars-stuff');
  assert.equal(branchFor('CARD-5', ''), 'card-5');
  assert.equal(worktreeFor('D:\\repos\\web-app\\', 'CARD-3'), 'D:\\repos\\web-app-card-3');
});

test('the packet text says the task, the repos (home first), your note and the plan rule', () => {
  const text = packetText(draft({ packet: packet({ note: '  Keep it behind the size_guide flag. ' }) }), 'CARD-3', 'card-3-add-size-guide-product');
  assert.match(text, /^# Context from cc-control · CARD-3 Add a size guide to product pages/);
  assert.match(text, /- web-app \(you start here\): D:\\repos\\web-app/);
  assert.match(text, /- cdn-worker \(also yours to read and edit\): D:\\repos\\cdn-worker/);
  assert.match(text, /Work on the branch card-3-add-size-guide-product\./);
  assert.match(text, /## From you\nKeep it behind the size_guide flag\.$/m);
  assert.match(text, /Start with a plan\./);
  const noPlan = packetText(draft({ launch: { ...draft().launch, mode: 'default' } }), 'CARD-3');
  assert.doesNotMatch(noPlan, /Start with a plan/);
  assert.doesNotMatch(noPlan, /## From you/);
});

test('sizes read like the mock: tenths of a thousand tokens, and at least 1% of memory', () => {
  assert.equal(fmtK(1234), '1.2k');
  assert.equal(fmtK(40), '0.1k', 'small but not nothing');
  assert.equal(fmtK(0), '0.0k');
  assert.equal(memoryPct(300), 1);
  assert.equal(memoryPct(20_000), 10);
});

test('a worktree card tells Claude its worktrees, not the repos’ usual folders', () => {
  const folders = [{ repo: 'D:\\repos\\web-app', dir: 'D:\\repos\\web-app-card-3' }, { repo: 'D:\\repos\\design-tokens', dir: 'D:\\repos\\design-tokens-card-3' }];
  assert.equal(folderFor({ folders }, 'd:/repos/design-tokens/'), 'D:\\repos\\design-tokens-card-3', 'paths compared as Windows does');
  assert.equal(folderFor({ folders }, 'D:\\repos\\cdn-worker'), 'D:\\repos\\cdn-worker', 'no worktree: its own folder');
  assert.equal(folderFor({}, 'D:\\repos\\web-app'), 'D:\\repos\\web-app');
  const text = packetText({ ...draft({ launch: { ...draft().launch, branch: 'worktree' } }), folders }, 'CARD-3', 'card-3-x');
  assert.match(text, /- web-app \(you start here\): D:\\repos\\web-app-card-3\n/);
  assert.match(text, /- design-tokens \(also yours to read and edit\): D:\\repos\\design-tokens-card-3\n/);
  assert.match(text, /- cdn-worker \(also yours to read and edit\): D:\\repos\\cdn-worker\n/);
  assert.match(text, /Work on the branch card-3-x\. Each repo above is a worktree of its own/);
  assert.doesNotMatch(packetText(draft(), 'CARD-3', 'card-3-x'), /worktree of its own/);
});

test('wt arguments survive Windows Terminal re-quoting them', () => {
  assert.equal(wtArg('reply "ok"'), 'reply \\"ok\\"');
  assert.equal(wtArg('a; b'), 'a\\; b');
  assert.equal(wtArg('path C:\\x\\'), 'path C:\\x\\\\', 'a trailing backslash would escape the closing quote');
  assert.equal(wtArg('a\\"b'), 'a\\\\\\"b', 'backslashes before a quote double, then the quote is escaped');
  assert.equal(wtArg('two\nlines'), 'two lines');
});

test('the model: the card’s choice, else the server’s, else the user’s setting', () => {
  assert.equal(modelFor({ model: 'sonnet' }, 'haiku', 'opus'), 'sonnet');
  assert.equal(modelFor({}, 'claude-haiku-4-5-20251001', 'opus'), 'claude-haiku-4-5-20251001');
  assert.equal(modelFor({}, undefined, 'opus'), 'opus');
  assert.equal(modelFor({}), undefined);
  assert.equal(modelName('opus'), 'Opus');
  assert.equal(modelName('claude-haiku-4-5-20251001'), 'claude-haiku-4-5-20251001');
  assert.equal(modelName(undefined), 'Claude Code’s default');
});

test('what happens: branch, then the terminal tab with the extra repos and the message', () => {
  const lines = launchLines(draft(), 'CARD-3', 'haiku');
  assert.equal(lines[0], 'git -C D:\\repos\\web-app switch -c card-3-add-size-guide-product');
  assert.match(lines[2], /--permission-mode plan --model haiku --add-dir D:\\repos\\design-tokens --add-dir D:\\repos\\cdn-worker -- "Plan CARD-3\."$/);
  const wt = launchLines(draft({ launch: { ...draft().launch, branch: 'worktree' } }), 'CARD-3');
  assert.match(wt[0], /worktree add D:\\repos\\web-app-card-3 -b card-3/);
  assert.match(wt[1], /git -C D:\\repos\\design-tokens worktree add D:\\repos\\design-tokens-card-3 -b card-3/, 'every repo gets a worktree on the same branch');
  assert.match(wt[2], /git -C D:\\repos\\cdn-worker worktree add D:\\repos\\cdn-worker-card-3 -b card-3/);
  assert.match(wt[4], /-d D:\\repos\\web-app-card-3 .*--add-dir D:\\repos\\design-tokens-card-3 --add-dir D:\\repos\\cdn-worker-card-3 /, 'Claude gets the worktrees, not the usual folders');
  assert.equal(launchLines(draft({ launch: { ...draft().launch, branch: 'current' } }), 'CARD-3').length, 2);
  assert.match(launchLines(draft({ launch: { ...draft().launch, model: 'opus' } }), 'CARD-3', 'haiku')[2], /--model opus /, 'the card’s choice wins over the server’s');
  assert.doesNotMatch(launchLines(draft(), 'CARD-3')[2], /--model/, 'no choice, no pin: Claude Code decides');
});
