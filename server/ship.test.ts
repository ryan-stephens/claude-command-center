import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { Card } from '../shared/cards.ts';
import { commitMessage, prBody, prLine, prTitle } from '../shared/ship.ts';
import { CardService } from './cards.ts';
import { RunService } from './recipes.ts';
import { checksOf, parseStatus, relativeTo, ShipService } from './ship.ts';
import { Store } from './store.ts';

const dir = mkdtempSync(join(tmpdir(), 'cc-ship-'));
const store = new Store(join(dir, 'ship.db'));
after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

// A stand-in for gh: records its arguments, answers like gh does.
const log = join(dir, 'gh.log');
const stub = join(dir, 'gh-stub.mjs');
writeFileSync(stub, `import { appendFileSync, readFileSync } from 'node:fs';
const a = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
if (a[0] === '--version') console.log('gh version 2.0.0 (stub)');
else if (a[0] === 'pr' && a[1] === 'create') { const i = a.indexOf('--body-file'); appendFileSync(${JSON.stringify(log)}, JSON.stringify({ body: readFileSync(a[i + 1], 'utf8') }) + '\\n'); console.log('https://github.com/acme/web/pull/12'); }
else if (a[0] === 'pr' && a[1] === 'view') console.log(JSON.stringify({ state: 'OPEN', reviewDecision: 'APPROVED', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] }));
else if (a[0] === 'pr' && a[1] === 'merge') console.log('Merged');
else process.exit(1);
`);
const calls = () => readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();

function repo(): { work: string; remote: string } {
  const remote = join(dir, `remote-${Math.random().toString(36).slice(2)}.git`);
  const work = join(dir, `work-${Math.random().toString(36).slice(2)}`);
  mkdirSync(work);
  git(dir, 'init', '--bare', '-b', 'main', remote);
  git(work, 'init', '-b', 'main');
  writeFileSync(join(work, 'README.md'), '# web\n');
  git(work, 'add', 'README.md');
  git(work, 'commit', '-m', 'init');
  git(work, 'remote', 'add', 'origin', remote);
  git(work, 'push', '-u', 'origin', 'main');
  git(work, 'remote', 'set-head', 'origin', 'main');
  // Commits made by the service use the repo's identity.
  git(work, 'config', 'user.name', 't');
  git(work, 'config', 'user.email', 't@t');
  return { work, remote };
}

function seed(work: string): Card {
  const card: Card = {
    id: crypto.randomUUID(), key: 'SHOP-155', title: 'Save cart for signed-out users', workspaceId: null, stage: 'try', createdAt: Date.now(),
    packet: { workspace: [], ticket: [{ kind: 'ac', id: 'ac:0', label: 'The cart survives closing the tab', on: true }], card: [], note: '' },
    launch: { home: work, branch: 'current', mode: 'default', message: 'Work on SHOP-155.' },
    boot: [], cwd: work, files: [join(work, 'cart.js')], sessionId: 'abcdef12-0000',
    ticket: { key: 'SHOP-155', source: 'jira', title: 'Save cart for signed-out users', description: 'Guests lose their cart.\n\nMore detail.', status: 'In Progress', done: false, project: 'SHOP', updatedAt: 0, comments: [], attachments: [], links: [], acceptance: [], url: 'https://acme.atlassian.net/browse/SHOP-155' } as unknown as Card['ticket'],
    live: { phase: 'waiting', text: 'Done', at: 0, lastMessage: 'Saved the cart to localStorage and restore it on load.\n\nAnything else?' },
  };
  store.saveCard(card, 'tok');
  return card;
}

test('the words: a conventional commit, the PR title and a body from the ticket', () => {
  const c = seed(dir);
  assert.equal(commitMessage(c), 'feat: save cart for signed-out users (SHOP-155)');
  assert.equal(prTitle(c), 'SHOP-155: Save cart for signed-out users');
  assert.equal(prTitle({ ...c, key: 'CARD-3', ticket: undefined }), 'Save cart for signed-out users');
  const body = prBody(c, ['cart.js'], 'npm run dev');
  assert.match(body, /^Guests lose their cart\.\n\n\*\*What changed\*\* \(from Claude\): Saved the cart to localStorage and restore it on load\.\n\n## Done when\n- \[ \] The cart survives closing the tab\n\n## Files\n- `cart.js`\n\nTried locally: `npm run dev`\.\n\nTicket: \[SHOP-155\]\(https:\/\/acme\.atlassian\.net\/browse\/SHOP-155\)/);
  assert.match(prBody(c, [], undefined), /Not tried locally yet\./);
  assert.equal(prLine({ number: 12, url: '', state: 'OPEN', review: 'APPROVED', checks: 'pass' }), 'PR #12 · approved · checks passing');
});

test('git status, paths and checks, read', () => {
  assert.deepEqual(parseStatus(' M a.js\0R  new.js\0old.js\0?? dir/b.txt\0'), [{ path: 'a.js', status: ' M' }, { path: 'new.js', status: 'R ' }, { path: 'dir/b.txt', status: '??' }]);
  assert.deepEqual(relativeTo('C:\\r\\web', ['C:\\r\\web\\src\\a.js', 'C:\\r\\api\\b.js', 'c:/R/Web/c.js']), ['src/a.js', 'c.js']);
  assert.equal(checksOf([]), 'none');
  assert.equal(checksOf([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }]), 'pending');
  assert.equal(checksOf([{ status: 'COMPLETED', conclusion: 'FAILURE' }]), 'fail');
});

test('ships only the files it ticked: branch off main, commit, push, PR; then follow it and merge', async () => {
  const { work, remote } = repo();
  writeFileSync(join(work, 'cart.js'), 'export const cart = [];\n');
  writeFileSync(join(work, 'notes.txt'), 'mine, not the card’s\n');
  const card = seed(work);
  const cards = new CardService(store, { port: 7788, changed: () => {} });
  const ship = new ShipService(cards, new RunService(() => {}, process.env), { env: { ...process.env, CC_CONTROL_GH: stub } });
  try {
    const plan = await ship.plan(card);
    assert.equal(plan.branch, 'main');
    assert.equal(plan.newBranch, 'shop-155-save-cart-signed-out');
    assert.equal(plan.base, 'main');
    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(plan.files.map((f) => [f.path, f.mine]), [['cart.js', true], ['notes.txt', false]]);
    assert.match(plan.notes[0], /1 changed file not written by this card is left out/);
    assert.match(plan.body, /- `cart\.js`/);

    const pr = await ship.ship(card.id, { commit: plan.commit, title: plan.title, body: plan.body, paths: ['cart.js', 'not-a-change.js'] });
    assert.deepEqual(pr, { number: 12, url: 'https://github.com/acme/web/pull/12', host: 'github', state: 'OPEN', checks: 'none', checkedAt: pr!.checkedAt });
    assert.equal(git(work, 'branch', '--show-current'), 'shop-155-save-cart-signed-out');
    assert.equal(git(work, 'log', '-1', '--format=%s'), 'feat: save cart for signed-out users (SHOP-155)');
    assert.equal(git(work, 'show', '--name-only', '--format=', 'HEAD'), 'cart.js', 'only the ticked file');
    assert.equal(git(work, 'status', '--porcelain'), '?? notes.txt', 'the other change is left alone');
    assert.match(git(remote, 'branch', '--list'), /shop-155-save-cart-signed-out/, 'pushed');
    const create = calls().find((a) => Array.isArray(a) && a[1] === 'create');
    assert.deepEqual(create.slice(0, 4), ['pr', 'create', '--title', 'SHOP-155: Save cart for signed-out users']);
    assert.deepEqual(create.slice(-4), ['--head', 'shop-155-save-cart-signed-out', '--base', 'main']);
    assert.match(calls().find((a) => a.body).body, /## Done when/);
    const saved = cards.get(card.id)!;
    assert.equal(saved.stage, 'ship');
    assert.equal(saved.branchName, 'shop-155-save-cart-signed-out');
    assert.deepEqual(saved.ship!.steps.map((s) => s.state), ['ok', 'ok', 'ok', 'ok']);
    assert.match(saved.ship!.steps[1].text, /^Committed [0-9a-f]+: feat: save cart/);
    await assert.rejects(ship.ship(card.id, { commit: 'x', title: 'x', body: '', paths: ['notes.txt'] }), /already has PR #12/);

    const seen = await ship.refresh(card.id);
    assert.equal(prLine(seen!), 'PR #12 · approved · checks passing');
    await ship.merge(card.id);
    assert.ok(calls().some((a) => Array.isArray(a) && a[1] === 'merge' && a.includes('--squash')));
    assert.doesNotMatch(git(remote, 'branch', '--list'), /shop-155/, 'the branch is gone from the remote');
    assert.equal(git(work, 'branch', '--show-current'), 'shop-155-save-cart-signed-out', 'the local checkout is left as it is');
    assert.equal(cards.get(card.id)!.stage, 'done');
  } finally {
    ship.stop();
  }
});

test('a changed tracked file listed first keeps its whole name (git status starts it with a space)', async () => {
  const { work } = repo();
  writeFileSync(join(work, 'README.md'), '# web, changed\n');
  writeFileSync(join(work, 'zeta.txt'), 'new\n');
  const card = { ...seed(work), files: [join(work, 'README.md')] };
  store.saveCard(card, 'tok');
  const cards = new CardService(store, { port: 7788, changed: () => {} });
  const ship = new ShipService(cards, new RunService(() => {}, process.env), { env: { ...process.env, CC_CONTROL_GH: stub } });
  try {
    const plan = await ship.plan(card);
    assert.deepEqual(plan.files, [{ path: 'README.md', status: ' M', mine: true }, { path: 'zeta.txt', status: '??', mine: false }]);
  } finally {
    ship.stop();
  }
});

test('what stops it is said up front: no remote, nothing ticked', async () => {
  const work = join(dir, 'lonely');
  mkdirSync(work);
  git(work, 'init', '-b', 'main');
  writeFileSync(join(work, 'a.txt'), 'a');
  git(work, 'add', 'a.txt');
  git(work, 'commit', '-m', 'init');
  const card = seed(work);
  const cards = new CardService(store, { port: 7788, changed: () => {} });
  const ship = new ShipService(cards, new RunService(() => {}, process.env), { env: { ...process.env, CC_CONTROL_GH: stub } });
  try {
    const plan = await ship.plan(card);
    assert.deepEqual(plan.blockers, ['The repo has no remote to push to.']);
    assert.equal(plan.notes.some((n) => /doesn’t know/.test(n)), false, 'no remote: nothing about hosts');
    await assert.rejects(ship.ship(card.id, { commit: 'x', title: 'x', body: '', paths: [] }), /no remote/);
    const { work: w2 } = repo();
    const c2 = seed(w2);
    await assert.rejects(ship.ship(c2.id, { commit: 'x', title: 'x', body: '', paths: [] }), /Nothing to ship/);
  } finally {
    ship.stop();
  }
});

test('a host cc-control doesn’t know: it still commits and pushes, and says to open the PR by hand', async () => {
  const { work, remote } = repo();
  writeFileSync(join(work, 'cart.js'), 'x\n');
  const card = seed(work);
  const cards = new CardService(store, { port: 7788, changed: () => {} });
  const ship = new ShipService(cards, new RunService(() => {}, process.env), { env: {} });
  try {
    const plan = await ship.plan(card);
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.host, '');
    assert.match(plan.notes.join(' '), /doesn’t know how to open a pull request on .*remote-.*\.git yet/);
    const pr = await ship.ship(card.id, { commit: plan.commit, title: plan.title, body: plan.body, paths: ['cart.js'] });
    assert.equal(pr, undefined);
    assert.match(git(remote, 'branch', '--list'), /shop-155-save-cart-signed-out/, 'pushed');
    const saved = cards.get(card.id)!;
    assert.equal(saved.stage, 'ship');
    assert.match(saved.ship!.steps.at(-1)!.text, /Open the pull request for shop-155-save-cart-signed-out in the browser/);
  } finally {
    ship.stop();
  }
});
