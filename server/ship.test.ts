import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { Card } from '../shared/cards.ts';
import { commitMessage, prBody, prLine, prTitle, shipMode } from '../shared/ship.ts';
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
else if (a[0] === 'pr' && a[1] === 'create') { const i = a.indexOf('--body-file'); const n = 12 + readFileSync(${JSON.stringify(log)}, 'utf8').split('\\n').filter((l) => l.includes('"body"')).length; appendFileSync(${JSON.stringify(log)}, JSON.stringify({ body: readFileSync(a[i + 1], 'utf8') }) + '\\n'); console.log('https://github.com/acme/web/pull/' + n); }
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
    assert.equal(plan.repos.length, 1, 'one repo: one block');
    const [r] = plan.repos;
    assert.equal(r.branch, 'main');
    assert.equal(r.newBranch, 'shop-155-save-cart-signed-out');
    assert.equal(r.base, 'main');
    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(r.files.map((f) => [f.path, f.mine]), [['cart.js', true], ['notes.txt', false]]);
    assert.match(plan.notes[0], /^1 changed file not written by this card is left out/);
    assert.match(plan.body, /- `cart\.js`/);

    const [pr] = await ship.ship(card.id, { commit: plan.commit, title: plan.title, body: plan.body, repos: [{ root: r.root, paths: ['cart.js', 'not-a-change.js'] }] });
    assert.deepEqual(pr, { number: 12, url: 'https://github.com/acme/web/pull/12', host: 'github', state: 'OPEN', checks: 'none', checkedAt: pr!.checkedAt, repo: pr.repo, root: r.root });
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
    assert.equal(saved.ship!.prs!.length, 1);
    assert.equal(saved.ship!.pr, undefined, 'the list is the record now');
    await assert.rejects(ship.ship(card.id, { commit: 'x', title: 'x', body: '', repos: [{ root: r.root, paths: ['notes.txt'] }] }), /already has PR #12/);

    const [seen] = await ship.refresh(card.id);
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
    assert.deepEqual(plan.repos[0].files, [{ path: 'README.md', status: ' M', mine: true }, { path: 'zeta.txt', status: '??', mine: false }]);
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
    await assert.rejects(ship.ship(card.id, { commit: 'x', title: 'x', body: '', repos: [] }), /no remote/);
    const { work: w2 } = repo();
    const c2 = seed(w2);
    await assert.rejects(ship.ship(c2.id, { commit: 'x', title: 'x', body: '', repos: [{ root: w2, paths: [] }] }), /Nothing to ship/);
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
    assert.equal(plan.repos[0].host, '');
    assert.match(plan.notes.join(' '), /doesn’t know how to open a pull request on .*remote-.*\.git yet/);
    const prs = await ship.ship(card.id, { commit: plan.commit, title: plan.title, body: plan.body, repos: [{ root: plan.repos[0].root, paths: ['cart.js'] }] });
    assert.deepEqual(prs, []);
    assert.match(git(remote, 'branch', '--list'), /shop-155-save-cart-signed-out/, 'pushed');
    const saved = cards.get(card.id)!;
    assert.equal(saved.stage, 'ship');
    assert.match(saved.ship!.steps.at(-1)!.text, /Open the pull request for shop-155-save-cart-signed-out in the browser/);
  } finally {
    ship.stop();
  }
});

test('changes cover every repo the card works in: its home, each worktree, and a repo of the card edited in place; a folder that isn’t git is skipped', async () => {
  const web = repo();
  const api = repo();
  const docs = repo();
  const plain = join(dir, `plain-${Math.random().toString(36).slice(2)}`);
  mkdirSync(plain);
  // The home: a commit on the card's branch plus an edit not yet committed. The API worktree: a new file. docs: untouched.
  git(web.work, 'checkout', '-q', '-b', 'shop-155-save-cart');
  writeFileSync(join(web.work, 'cart.js'), 'export const cart = [];\n');
  git(web.work, 'add', 'cart.js');
  git(web.work, 'commit', '-qm', 'cart');
  writeFileSync(join(web.work, 'README.md'), '# web\n\nMore.\n');
  writeFileSync(join(api.work, 'Fees.cs'), 'class Fees {}\n');
  const card: Card = {
    ...seed(web.work), launch: { home: join(dir, 'web'), branch: 'worktree', mode: 'default', message: '' }, branchName: 'shop-155-save-cart',
    folders: [{ repo: join(dir, 'web'), dir: web.work }, { repo: join(dir, 'api'), dir: api.work }, { repo: join(dir, 'docs'), dir: docs.work }, { repo: join(dir, 'notes'), dir: plain }],
    files: [join(web.work, 'cart.js'), join(api.work, 'Fees.cs'), join(plain, 'todo.txt')],
  };
  const cards = new CardService(store, { port: 7788, changed: () => {} });
  const ship = new ShipService(cards, new RunService(() => {}, process.env), { env: { ...process.env, CC_CONTROL_GH: stub } });
  try {
    const c = await ship.changes(card);
    assert.deepEqual(c.repos.map((r) => [r.repo, r.branch, r.base, r.committed, r.files.map((f) => `${f.kind} ${f.path}${f.mine ? '*' : ''}`)]), [
      ['web', 'shop-155-save-cart', 'main', 1, ['added cart.js*', 'modified README.md']],
      ['api', 'main', 'main', 0, ['new Fees.cs*']],
      ['docs', 'main', 'main', 0, []],
    ], 'home first, then the worktrees in the card’s order; the plain folder skipped');
    assert.match(c.repos[0].files[0].patch, /\+export const cart/);
    // A Current-branch card with two repos edits the second in place: it is read too, once.
    const inPlace: Card = { ...seed(web.work), packet: { ...card.packet, workspace: [{ kind: 'repo', id: web.work, label: 'web', on: true }, { kind: 'repo', id: api.work, label: 'api', on: true }] }, files: [join(api.work, 'Fees.cs')] };
    const c2 = await ship.changes(inPlace);
    assert.deepEqual(c2.repos.map((r) => r.files.map((f) => f.path).sort()), [['README.md', 'cart.js'], ['Fees.cs']]);
    // A repo of the card the hooks saw nothing written in is read all the same (§90): edits made by hand or by another tool show too.
    const untouched: Card = { ...inPlace, files: [] };
    const c3 = await ship.changes(untouched);
    assert.deepEqual(c3.repos.map((r) => r.files.map((f) => `${f.path}${f.mine ? '*' : ''}`).sort()), [['README.md', 'cart.js'], ['Fees.cs']], 'both repos read; nothing marked as the card’s');
  } finally {
    ship.stop();
  }
});

test('a card that changed two repos ships each from its worktree: two commits, two pushes, two PRs linking each other; both followed and merged', async () => {
  const web = repo();
  const api = repo();
  writeFileSync(join(web.work, 'cart.js'), 'export const cart = [];\n');
  writeFileSync(join(api.work, 'Fees.cs'), 'class Fees {}\n');
  writeFileSync(join(api.work, 'scratch.txt'), 'not the card’s\n');
  // A worktree card: each work folder stands in for the card's worktree of a repo (named after the repo).
  const card: Card = {
    ...seed(web.work), launch: { home: join(dir, 'web'), branch: 'worktree', mode: 'default', message: '' }, branchName: 'shop-155-save-cart-signed-out',
    folders: [{ repo: join(dir, 'web'), dir: web.work }, { repo: join(dir, 'api'), dir: api.work }],
    files: [join(web.work, 'cart.js'), join(api.work, 'Fees.cs')],
  };
  store.saveCard(card, 'tok');
  const cards = new CardService(store, { port: 7788, changed: () => {} });
  const ship = new ShipService(cards, new RunService(() => {}, process.env), { env: { ...process.env, CC_CONTROL_GH: stub } });
  try {
    const plan = await ship.plan(card);
    assert.deepEqual(plan.repos.map((r) => [r.repo, r.newBranch, r.files.map((f) => `${f.path}${f.mine ? '*' : ''}`)]), [['web', 'shop-155-save-cart-signed-out', ['cart.js*']], ['api', 'shop-155-save-cart-signed-out', ['Fees.cs*', 'scratch.txt']]]);
    assert.deepEqual(plan.notes, ['api: 1 changed file not written by this card is left out. Tick it to include.'], 'named by repo');
    assert.match(plan.body, /- `web\/cart\.js`\n- `api\/Fees\.cs`/, 'the files by repo');
    // The stub numbers PRs by how many it has opened so far in this file.
    const n = 12 + calls().filter((a) => a.body).length;
    const prs = await ship.ship(card.id, { commit: plan.commit, title: plan.title, body: plan.body, repos: plan.repos.map((r) => ({ root: r.root, paths: r.files.filter((f) => f.mine).map((f) => f.path) })) });
    assert.deepEqual(prs.map((p) => [p.repo, p.number, p.root]), [['web', n, web.work], ['api', n + 1, api.work]]);
    assert.equal(git(web.work, 'show', '--name-only', '--format=', 'HEAD'), 'cart.js');
    assert.equal(git(api.work, 'show', '--name-only', '--format=', 'HEAD'), 'Fees.cs', 'only the ticked file in each');
    assert.match(git(web.remote, 'branch', '--list'), /shop-155/, 'pushed');
    assert.match(git(api.remote, 'branch', '--list'), /shop-155/, 'pushed too');
    const bodies = calls().filter((a) => a.body).map((a) => a.body as string);
    assert.match(bodies.at(-2)!, /Part of SHOP-155 with api \(its PR opens with this one\)\./, 'the first PR names the second');
    assert.ok(bodies.at(-1)!.includes(`Part of SHOP-155 with [web](https://github.com/acme/web/pull/${n}).`), 'the second links the first');
    const saved = cards.get(card.id)!;
    assert.equal(saved.stage, 'ship');
    assert.deepEqual(saved.ship!.prs!.map((p) => p.number), [n, n + 1]);
    assert.ok(saved.ship!.steps.every((s) => /^(web|api): /.test(s.text)), 'every step says which repo');
    await assert.rejects(ship.ship(card.id, { commit: 'x', title: 'x', body: '', repos: [] }), /already has 2 open PRs/);
    const seen = await ship.refresh(card.id);
    assert.deepEqual(seen.map((p) => prLine(p)), [`PR #${n} · approved · checks passing`, `PR #${n + 1} · approved · checks passing`]);
    assert.equal(cards.get(card.id)!.stage, 'ship', 'not done until both are merged');
    await ship.merge(card.id);
    assert.doesNotMatch(git(web.remote, 'branch', '--list'), /shop-155/);
    assert.doesNotMatch(git(api.remote, 'branch', '--list'), /shop-155/);
    assert.ok(cards.get(card.id)!.ship!.prs!.every((p) => p.state === 'MERGED'));
    assert.equal(cards.get(card.id)!.stage, 'done');
  } finally {
    ship.stop();
  }
});

test('a ship that stops part-way: the first PR stays, the card says what is left, and s again ships only that', async () => {
  const web = repo();
  const api = repo();
  writeFileSync(join(web.work, 'cart.js'), 'export const cart = [];\n');
  writeFileSync(join(api.work, 'Fees.cs'), 'class Fees {}\n');
  const card: Card = {
    ...seed(web.work), launch: { home: join(dir, 'web'), branch: 'worktree', mode: 'default', message: '' }, branchName: 'shop-155-save-cart-signed-out',
    folders: [{ repo: join(dir, 'web'), dir: web.work }, { repo: join(dir, 'api'), dir: api.work }],
    files: [join(web.work, 'cart.js'), join(api.work, 'Fees.cs')],
  };
  store.saveCard(card, 'tok');
  const cards = new CardService(store, { port: 7788, changed: () => {} });
  const ship = new ShipService(cards, new RunService(() => {}, process.env), { env: { ...process.env, CC_CONTROL_GH: stub } });
  try {
    const plan = await ship.plan(card);
    const n = 12 + calls().filter((a) => a.body).length;
    const req = (p: typeof plan) => ({ commit: p.commit, title: p.title, body: p.body, repos: p.repos.map((r) => ({ root: r.root, paths: r.files.filter((f) => f.mine).map((f) => f.path) })) });
    // The API's remote goes away after the plan: its push fails.
    git(api.work, 'remote', 'set-url', 'origin', join(dir, 'gone.git'));
    await assert.rejects(ship.ship(card.id, req(plan)), /^Error: api: The push failed/);
    let saved = cards.get(card.id)!;
    assert.equal(saved.stage, 'ship', 'in Ship from the first push');
    assert.deepEqual(saved.ship!.prs!.map((p) => [p.repo, p.number]), [['web', n]], 'the first PR stays on the card');
    assert.deepEqual(saved.ship!.left, ['api'], 'what is left is said');
    assert.equal(shipMode(saved.ship), 'rest');
    assert.equal(saved.ship!.steps.at(-1)!.state, 'bad');
    assert.match(saved.ship!.steps.at(-1)!.text, /^api: The push failed/);
    assert.equal(git(api.work, 'show', '--name-only', '--format=', 'HEAD'), 'Fees.cs', 'the API commit was made');

    // s again: the plan shows web shipped and api with its commit to push.
    git(api.work, 'remote', 'set-url', 'origin', api.remote);
    const again = await ship.plan(cards.get(card.id)!);
    assert.deepEqual(again.repos.map((r) => [r.repo, r.pr?.number, r.files.length, r.ahead]), [['web', n, 0, 1], ['api', undefined, 0, 1]]);
    assert.doesNotMatch(again.body, /## Files/, 'nothing new to commit: no file list');
    const prs = await ship.ship(card.id, req(again));
    assert.deepEqual(prs.map((p) => [p.repo, p.number]), [['api', n + 1]], 'only the API shipped this time');
    assert.ok(calls().filter((a) => a.body).at(-1)!.body.includes(`Part of SHOP-155 with [web](https://github.com/acme/web/pull/${n}).`), 'linking the PR from before');
    assert.match(git(api.remote, 'branch', '--list'), /shop-155/, 'pushed now');
    saved = cards.get(card.id)!;
    assert.deepEqual(saved.ship!.prs!.map((p) => p.number), [n, n + 1]);
    assert.equal(saved.ship!.left, undefined, 'nothing left');
    assert.equal(shipMode(saved.ship), 'merge');
    assert.ok(saved.ship!.steps.every((s) => /^api: /.test(s.text)), 'this run touched only the API');
    await assert.rejects(ship.ship(card.id, req(again)), /already has 2 open PRs/);
  } finally {
    ship.stop();
  }
});
