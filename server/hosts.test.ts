import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { Card } from '../shared/cards.ts';
import { CardService } from './cards.ts';
import { adoRepo, AzureDevOpsHost, findPrIn, GitHubHost, hostFor, namesTicket, pickPr, policiesOf, reviewOf } from './hosts.ts';
import { RunService } from './recipes.ts';
import { ShipService } from './ship.ts';
import { Store } from './store.ts';

test('Azure DevOps remotes: cloud, visualstudio.com, on-prem TFS, short forms and SSH', () => {
  assert.deepEqual(adoRepo('https://tfs.p.vu.local/tfs/DefaultCollection/ss/_git/Workspaces-UI'),
    { collection: 'https://tfs.p.vu.local/tfs/DefaultCollection', project: 'ss', repo: 'Workspaces-UI' });
  assert.deepEqual(adoRepo('https://rstephens@tfs.p.vu.local:8080/tfs/DefaultCollection/ss/_git/Workspaces-UI.git'),
    { collection: 'https://tfs.p.vu.local:8080/tfs/DefaultCollection', project: 'ss', repo: 'Workspaces-UI' }, 'a user and a port');
  assert.deepEqual(adoRepo('https://tfs.p.vu.local/tfs/DefaultCollection/_git/Workspaces-UI'),
    { collection: 'https://tfs.p.vu.local/tfs/DefaultCollection', project: 'Workspaces-UI', repo: 'Workspaces-UI' }, 'short form: the project is named like the repo');
  assert.deepEqual(adoRepo('https://devops.company.com/Main/My%20Project/_git/api'),
    { collection: 'https://devops.company.com/Main', project: 'My Project', repo: 'api' }, 'Azure DevOps Server without /tfs, a space in the project');
  assert.deepEqual(adoRepo('https://acme@dev.azure.com/acme/Shop/_git/web'), { collection: 'https://dev.azure.com/acme', project: 'Shop', repo: 'web' });
  assert.deepEqual(adoRepo('https://acme.visualstudio.com/DefaultCollection/Shop/_git/web'), { collection: 'https://acme.visualstudio.com/DefaultCollection', project: 'Shop', repo: 'web' });
  assert.deepEqual(adoRepo('git@ssh.dev.azure.com:v3/acme/Shop/web'), { collection: 'https://dev.azure.com/acme', project: 'Shop', repo: 'web' });
  assert.deepEqual(adoRepo('ssh://tfs.p.vu.local:22/tfs/DefaultCollection/ss/_git/Workspaces-UI', 'https://tfs.p.vu.local/tfs/DefaultCollection/'),
    { collection: 'https://tfs.p.vu.local/tfs/DefaultCollection', project: 'ss', repo: 'Workspaces-UI' }, 'SSH on-prem, with CC_CONTROL_ADO_URL');
  assert.equal(adoRepo('ssh://tfs.p.vu.local:22/tfs/DefaultCollection/ss/_git/Workspaces-UI')!.collection, '', 'SSH on-prem without it: unknown, said up front');
  assert.equal(adoRepo('https://github.com/acme/web.git'), undefined);
});

test('which host: Azure DevOps from /_git/, GitHub from github.com, otherwise it says so', () => {
  assert.ok(hostFor('https://tfs.p.vu.local/tfs/DefaultCollection/ss/_git/Workspaces-UI', {}) instanceof AzureDevOpsHost);
  assert.ok(hostFor('git@github.com:acme/web.git', {}) instanceof GitHubHost);
  assert.match(hostFor('https://gitlab.com/acme/web.git', {}) as string, /doesn’t know how to open a pull request on https:\/\/gitlab\.com\/acme\/web\.git yet/);
  assert.match(hostFor('https://user:secret@gitlab.com/acme/web.git', {}) as string, /on https:\/\/gitlab\.com/, 'credentials in a URL are never repeated');
});

test('votes and policies, summed up; what Azure DevOps needs is said up front', async () => {
  assert.equal(reviewOf([{ vote: 10 }, { vote: 0 }]), 'APPROVED');
  assert.equal(reviewOf([{ vote: 10 }, { vote: 0, isRequired: true }]), 'REVIEW_REQUIRED', 'a required reviewer hasn’t voted');
  assert.equal(reviewOf([{ vote: 10 }, { vote: -5 }]), 'CHANGES_REQUESTED');
  assert.equal(reviewOf([]), 'REVIEW_REQUIRED');
  assert.equal(policiesOf([{ status: 'approved' }, { status: 'running' }]), 'pending');
  assert.equal(policiesOf([{ status: 'rejected' }]), 'fail');
  assert.equal(policiesOf([{ status: 'approved' }, { status: 'notApplicable' }]), 'pass');
  assert.equal(policiesOf(undefined), 'none');
  assert.match((await new AzureDevOpsHost({ collection: 'https://x/tfs/C', project: 'p', repo: 'r' }, {}).check())[0], /Set CC_CONTROL_ADO_TOKEN/);
  assert.match((await new AzureDevOpsHost({ collection: '', project: 'p', repo: 'r' }, { CC_CONTROL_ADO_TOKEN: 't' }).check())[0], /set CC_CONTROL_ADO_URL/);
  assert.deepEqual(await new AzureDevOpsHost({ collection: 'https://x/tfs/C', project: 'p', repo: 'r' }, { CC_CONTROL_ADO_TOKEN: 't' }).check(), []);
});

// ---- A stand-in Azure DevOps Server (TFS) that speaks API 5.0 only ----------------------------------

interface Seen { method: string; url: string; auth?: string; body?: unknown }

function fakeTfs() {
  const seen: Seen[] = [];
  let pr: { status: string; votes: number[] } = { status: 'active', votes: [] };
  const server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const url = req.url ?? '';
      seen.push({ method: req.method ?? '', url, auth: req.headers.authorization, ...(raw ? { body: JSON.parse(raw) } : {}) });
      const json = (code: number, body: unknown) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
      if (req.headers.authorization !== `Basic ${Buffer.from(':pat-123').toString('base64')}`) { json(401, { message: 'TF400813: not authorized' }); return; }
      const v = /api-version=([\d.]+)/.exec(url)?.[1];
      if (v !== '5.0') { json(400, { message: `VssVersionOutOfRangeException: The version of the REST API resource (${v}) is not supported.` }); return; }
      const path = url.split('?')[0];
      if (req.method === 'POST' && path === '/tfs/DefaultCollection/ss/_apis/git/repositories/Workspaces-UI/pullrequests') { json(201, { pullRequestId: 314, status: 'active' }); return; }
      if (req.method === 'GET' && path === '/tfs/DefaultCollection/ss/_apis/git/repositories/Workspaces-UI/pullrequests/314') {
        json(200, { pullRequestId: 314, status: pr.status, reviewers: pr.votes.map((vote) => ({ vote })), lastMergeSourceCommit: { commitId: 'abc123' }, repository: { project: { id: 'proj-guid' } } });
        return;
      }
      if (req.method === 'GET' && path === '/tfs/DefaultCollection/ss/_apis/git/repositories/Workspaces-UI/pullrequests') {
        json(200, { value: [
          { pullRequestId: 300, title: 'WSS-1234: older work', sourceRefName: 'refs/heads/wss-1234-old', targetRefName: 'refs/heads/develop' },
          { pullRequestId: 318, title: 'Point the proxy at Okteto', sourceRefName: 'refs/heads/feature/WSS-123-proxy', targetRefName: 'refs/heads/develop' },
        ] });
        return;
      }
      if (req.method === 'GET' && path === '/tfs/DefaultCollection/ss/_apis/policy/evaluations') { json(200, { value: [{ status: 'approved' }] }); return; }
      if (req.method === 'PATCH' && path === '/tfs/DefaultCollection/ss/_apis/git/repositories/Workspaces-UI/pullrequests/314') { pr = { ...pr, status: 'completed' }; json(200, { status: 'completed' }); return; }
      json(404, { message: 'not here' });
    });
  });
  return { server, seen, approve: () => { pr = { ...pr, votes: [10] }; } };
}

const dir = mkdtempSync(join(tmpdir(), 'cc-hosts-'));
const store = new Store(join(dir, 'h.db'));
after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();

test('shipping to Azure DevOps Server: push over git, the PR through the REST API (finding the version it speaks), follow it, merge it', async () => {
  const tfs = fakeTfs();
  await new Promise<void>((r) => tfs.server.listen(0, '127.0.0.1', r));
  const port = (tfs.server.address() as { port: number }).port;
  // The fetch URL is the TFS address (that picks the host); pushes go to a local bare repo.
  const remote = join(dir, 'ws-ui.git');
  const work = join(dir, 'Workspaces-UI');
  mkdirSync(work);
  git(dir, 'init', '--bare', '-b', 'develop', remote);
  git(work, 'init', '-b', 'develop');
  git(work, 'config', 'user.name', 't');
  git(work, 'config', 'user.email', 't@t');
  writeFileSync(join(work, 'README.md'), '# ui\n');
  git(work, 'add', 'README.md');
  git(work, 'commit', '-m', 'init');
  git(work, 'remote', 'add', 'origin', `http://127.0.0.1:${port}/tfs/DefaultCollection/ss/_git/Workspaces-UI`);
  git(work, 'remote', 'set-url', '--push', 'origin', remote);
  git(work, 'push', 'origin', 'develop');
  git(work, 'checkout', '-b', 'ws-12-proxy');
  writeFileSync(join(work, 'proxy.conf.json'), '{ "/api": { "target": "https://api-rs.okteto.vu" } }\n');

  const card: Card = {
    id: crypto.randomUUID(), key: 'WS-12', title: 'Proxy the UI to Okteto', workspaceId: null, stage: 'try', createdAt: Date.now(),
    packet: { workspace: [], ticket: [], card: [], note: '' }, launch: { home: work, branch: 'current', mode: 'default', message: '' },
    boot: [], cwd: work, files: [join(work, 'proxy.conf.json')], sessionId: 'abcdef12-ado',
  };
  store.saveCard(card, 'tok');
  const cards = new CardService(store, { port: 7788, changed: () => {} });
  const env = { CC_CONTROL_ADO_TOKEN: 'pat-123' };
  const ship = new ShipService(cards, new RunService(() => {}, process.env), { env });
  try {
    const noToken = await new ShipService(cards, new RunService(() => {}, process.env), { env: {} }).plan(card);
    assert.match(noToken.blockers[0], /Set CC_CONTROL_ADO_TOKEN/);
    const plan = await ship.plan(card);
    assert.equal(plan.host, 'Azure DevOps');
    assert.equal(plan.base, 'develop', 'no origin/HEAD: develop is found locally');
    assert.deepEqual(plan.blockers, []);

    const pr = (await ship.ship(card.id, { commit: plan.commit, title: plan.title, body: 'x'.repeat(5000), paths: ['proxy.conf.json'] }))!;
    assert.equal(pr.number, 314);
    assert.equal(pr.host, 'azure');
    assert.equal(pr.url, `http://127.0.0.1:${port}/tfs/DefaultCollection/ss/_git/Workspaces-UI/pullrequest/314`);
    assert.match(git(remote, 'branch', '--list'), /ws-12-proxy/, 'pushed with git');
    const posts = tfs.seen.filter((s) => s.method === 'POST');
    assert.deepEqual(posts.map((s) => /api-version=([\d.]+)/.exec(s.url)?.[1]), ['7.0', '6.0', '5.0'], 'newest first, down to what the server speaks');
    const body = posts.at(-1)!.body as { sourceRefName: string; targetRefName: string; title: string; description: string };
    assert.deepEqual([body.sourceRefName, body.targetRefName, body.title], ['refs/heads/ws-12-proxy', 'refs/heads/develop', 'Proxy the UI to Okteto']);
    assert.ok(body.description.length <= 4000 && body.description.endsWith('(cut to fit Azure DevOps)'), 'descriptions are capped at 4000');
    assert.deepEqual(cards.get(card.id)!.ship!.steps.map((s) => s.text.replace(/[0-9a-f]{7,}/, 'SHA')), [
      'Committed SHA: feat: proxy the UI to Okteto (WS-12)', 'Pushed ws-12-proxy to origin', 'Opened PR #314 on Azure DevOps',
    ]);

    tfs.approve();
    const seen = await ship.refresh(card.id);
    assert.deepEqual([seen!.state, seen!.review, seen!.checks], ['OPEN', 'APPROVED', 'pass']);
    assert.ok(tfs.seen.filter((s) => s.method === 'GET').every((s) => /api-version=5\.0/.test(s.url)), 'the version it found is remembered');

    await ship.merge(card.id);
    const patch = tfs.seen.find((s) => s.method === 'PATCH')!.body as { status: string; lastMergeSourceCommit: { commitId: string }; completionOptions: Record<string, unknown> };
    assert.equal(patch.status, 'completed');
    assert.equal(patch.lastMergeSourceCommit.commitId, 'abc123');
    assert.deepEqual(patch.completionOptions, { mergeStrategy: 'squash', squashMerge: true, deleteSourceBranch: true });
    assert.equal(cards.get(card.id)!.stage, 'done');
    assert.match(git(remote, 'branch', '--list'), /ws-12-proxy/, 'Azure DevOps deletes the branch itself; cc-control doesn’t push a delete');

    const wrong = new AzureDevOpsHost({ collection: `http://127.0.0.1:${port}/tfs/DefaultCollection`, project: 'ss', repo: 'Workspaces-UI' }, { CC_CONTROL_ADO_TOKEN: 'nope' });
    await assert.rejects(wrong.view(work, pr!), /401: check CC_CONTROL_ADO_TOKEN/);
  } finally {
    ship.stop();
    tfs.server.close();
  }
});

test('a ticket’s PR: its key in the title or the branch, whole (WSS-12 is not WSS-123), the newest first', () => {
  assert.equal(namesTicket('WSS-12', 'feature/wss-12-proxy'), true);
  assert.equal(namesTicket('WSS-12', 'WSS-12: fix it'), true);
  assert.equal(namesTicket('WSS-12', 'feature/WSS-123-proxy'), false);
  assert.equal(namesTicket('WSS-12', 'AWSS-12'), false);
  const prs = [{ number: 1, title: 'WSS-12 first', source: 'a' }, { number: 7, title: 'other', source: 'wss-12-again' }, { number: 9, title: 'WSS-120', source: 'b' }];
  assert.equal(pickPr('WSS-12', prs)?.number, 7);
  assert.equal(pickPr('WSS-99', prs), undefined);
});

test('finding a ticket’s PR on Azure DevOps Server, read-only, from the repo’s remote', async () => {
  const tfs = fakeTfs();
  await new Promise<void>((r) => tfs.server.listen(0, '127.0.0.1', r));
  const port = (tfs.server.address() as { port: number }).port;
  const work = join(dir, 'find-pr');
  mkdirSync(work);
  git(work, 'init', '-b', 'develop');
  git(work, 'remote', 'add', 'origin', `http://127.0.0.1:${port}/tfs/DefaultCollection/ss/_git/Workspaces-UI`);
  const bare = join(dir, 'find-pr-none');
  mkdirSync(bare);
  git(bare, 'init');
  try {
    const env = { ...process.env, CC_CONTROL_ADO_TOKEN: 'pat-123' };
    const r = await findPrIn([bare, work], 'WSS-123', env);
    assert.deepEqual(r.pr, {
      number: 318, title: 'Point the proxy at Okteto', host: 'azure', source: 'feature/WSS-123-proxy', target: 'develop', repo: work,
      url: `http://127.0.0.1:${port}/tfs/DefaultCollection/ss/_git/Workspaces-UI/pullrequest/318`,
    });
    assert.deepEqual(r.notes, ['find-pr-none: no remote']);
    assert.ok(tfs.seen.every((s) => s.method === 'GET'), 'only reads');
    const none = await findPrIn([work], 'WSS-77', env);
    assert.equal(none.pr, undefined);
    assert.match(none.notes[0], /no open pull request on Azure DevOps names WSS-77/);
    const noToken = await findPrIn([work], 'WSS-123', { ...process.env, CC_CONTROL_ADO_TOKEN: '' });
    assert.match(noToken.notes[0], /CC_CONTROL_ADO_TOKEN/);
  } finally {
    tfs.server.close();
  }
});
