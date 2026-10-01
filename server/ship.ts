// Ship on the server: work out what shipping a card will do (branch, changed files, the words),
// then do it in the card's folder: a branch when it is on the default one, stage the files you
// ticked by name, commit, push, and open the pull request on the repo's host (server/hosts.ts:
// GitHub through gh, Azure DevOps / TFS through its REST API). Later, follow the PR and squash-merge
// it. Every step lands on the card, so the sheet and the drawer show where it got to and what failed.

import { normalize } from 'node:path';
import { branchFor, cardRepos, ownFolders, type BootStep, type Card } from '../shared/cards.ts';
import { parsePatch, type Changes } from '../shared/changes.ts';
import { allMerged, commitMessage, openPrs, partOf, prBody, prsOf, prTitle, type PullRequest, type RepoShipPlan, type ShipFile, type ShipPlan, type ShipRequest } from '../shared/ship.ts';
import { repoName, samePath } from '../shared/workspaces.ts';

/** A diff bigger than this is cut: the sheet says so. */
const MAX_PATCH = 2 * 1024 * 1024;
import type { CardService } from './cards.ts';
import { hostFor, run, why, type CodeHost, type Out } from './hosts.ts';
import type { RunService } from './recipes.ts';

export { checksOf } from './hosts.ts';

/** git status --porcelain=v1 -z: two-letter status and path; a rename's old path follows it. */
export function parseStatus(z: string): { path: string; status: string }[] {
  const parts = z.split('\0');
  const out: { path: string; status: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const status = e.slice(0, 2);
    out.push({ path: e.slice(3), status });
    if (status[0] === 'R' || status[0] === 'C') i++;
  }
  return out;
}

/** The card's files that sit in this repo, relative to its root with forward slashes, as git names them. */
export function relativeTo(root: string, files: string[]): string[] {
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return files.map((f) => f.replace(/\\/g, '/')).filter((f) => f.toLowerCase().startsWith(`${r}/`)).map((f) => f.slice(r.length + 1));
}

interface ShipOpts {
  /** Where host settings come from: CC_CONTROL_ADO_TOKEN, CC_CONTROL_ADO_URL, CC_CONTROL_GH (a stand-in gh for tests). */
  env?: NodeJS.ProcessEnv;
}

/** How often PRs of cards in Ship are looked at again. */
const PR_POLL_MS = 3 * 60_000;

export class ShipService {
  private cards: CardService;
  private runs: RunService;
  private env: NodeJS.ProcessEnv;
  private busy = new Set<string>();
  private timer: NodeJS.Timeout;

  constructor(cards: CardService, runs: RunService, opts: ShipOpts = {}) {
    this.cards = cards;
    this.runs = runs;
    this.env = opts.env ?? process.env;
    this.timer = setInterval(() => { void this.refreshAll(); }, PR_POLL_MS);
    this.timer.unref();
  }

  private folder(card: Card): string {
    const cwd = card.cwd ?? cardRepos(card)[0];
    if (!cwd) throw new Error(`${card.key} has no folder.`);
    return cwd;
  }

  /** The remote to push to: origin, else the first one. */
  private async remote(root: string): Promise<string | null> {
    const remotes = (await run('git', ['remote'], root)).out.split(/\s+/).filter(Boolean);
    return remotes.includes('origin') ? 'origin' : remotes[0] ?? null;
  }

  /** The host the remote's PRs go to, or why there isn't one. */
  private async host(root: string, remote: string | null): Promise<CodeHost | string> {
    if (!remote) return 'The repo has no remote to push to.';
    const url = (await run('git', ['remote', 'get-url', remote], root)).out;
    return hostFor(url, this.env);
  }

  /** The branch PRs go into: what the remote says is its default, else main or master. */
  private async base(root: string, remote: string | null): Promise<string> {
    if (remote) {
      const head = await run('git', ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], root);
      if (head.code === 0 && head.out.includes('/')) return head.out.slice(head.out.indexOf('/') + 1);
    }
    for (const b of ['main', 'master', 'develop']) {
      if ((await run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], root)).code === 0) return b;
    }
    return 'main';
  }

  /** What shipping one folder of the card will do: its branch, remote and host, the files, what is in the way. */
  private async planRepo(card: Card, cwd: string, home: boolean): Promise<RepoShipPlan> {
    const top = await run('git', ['rev-parse', '--show-toplevel'], cwd);
    if (top.code !== 0) throw new Error(`${cwd} isn’t a git repo.`);
    const root = normalize(top.out);
    // A worktree is named after the repo it is of; the repo's own folder after itself.
    const repo = repoName((card.folders ?? []).find((f) => samePath(f.dir, root))?.repo ?? root);
    const branch = (await run('git', ['branch', '--show-current'], root)).out;
    const remote = await this.remote(root);
    const base = await this.base(root, remote);
    const blockers: string[] = [];
    const notes: string[] = [];
    if (!branch) blockers.push('The repo isn’t on a branch (a detached HEAD). Switch to one in its tab first.');
    const newBranch = branch && branch === base ? branchFor(card.key, card.title) : undefined;
    if (newBranch && (await run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${newBranch}`], root)).code === 0) {
      blockers.push(`It is on ${base}, and the branch ${newBranch} it would make already exists.`);
    }
    if (!remote) blockers.push('The repo has no remote to push to.');
    const host = await this.host(root, remote);
    // A host cc-control doesn't know still gets the branch pushed; the PR is opened by hand.
    if (typeof host === 'string') { if (remote) notes.push(host); }
    else blockers.push(...await host.check(root));

    const mine = new Set(relativeTo(root, card.files ?? []).map((p) => p.toLowerCase()));
    // raw, not trimmed: " M file" starts with a space, and trimming it would shift the path.
    const files: ShipFile[] = parseStatus((await run('git', ['status', '--porcelain=v1', '-z', '-uall'], root)).raw)
      .map((f) => ({ ...f, mine: mine.has(f.path.toLowerCase()) }));
    const others = files.filter((f) => !f.mine).length;
    if (others) notes.push(`${others} changed file${others === 1 ? '' : 's'} not written by this card ${others === 1 ? 'is' : 'are'} left out. Tick ${others === 1 ? 'it' : 'them'} to include.`);

    let ahead = 0;
    if (branch && branch !== base) {
      const ref = remote && (await run('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${base}`], root)).code === 0 ? `${remote}/${base}` : base;
      const n = await run('git', ['rev-list', '--count', `${ref}..HEAD`], root);
      ahead = n.code === 0 ? Number(n.out) || 0 : 0;
    }
    if (home && !files.some((f) => f.mine) && !ahead) notes.push('Claude hasn’t changed any files here that git can see. Tick the ones to ship.');
    return { repo, root, branch, ...(newBranch ? { newBranch } : {}), base, host: typeof host === 'string' ? '' : host.name, files, ahead, blockers, notes };
  }

  /**
   * One block per repo the card ships: its home folder always, and each other worktree of its with
   * work in it (files the card wrote, or commits the base doesn't have). One commit message, title
   * and body for all of them; a repo's blockers and notes are named by repo when there are several.
   */
  async plan(card: Card): Promise<ShipPlan> {
    const home = this.folder(card);
    // A repo with a PR from an earlier ship (one that stopped part-way) is shown shipped and left alone.
    const prs = prsOf(card.ship);
    const shipped = (r: RepoShipPlan): RepoShipPlan => {
      const pr = prs.find((p) => p.root && samePath(p.root, r.root));
      return pr ? { ...r, pr, blockers: [], notes: r.notes.filter((n) => !/Tick/.test(n)) } : r;
    };
    const first = shipped(await this.planRepo(card, home, true));
    const repos: RepoShipPlan[] = [first];
    for (const f of ownFolders(card)) {
      if (samePath(f.dir, home) || samePath(f.dir, first.root)) continue;
      const r = await this.planRepo(card, f.dir, false).then(shipped, () => undefined);
      if (r && (r.files.some((x) => x.mine) || r.ahead || r.pr)) repos.push(r);
    }
    const run0 = this.runs.get(card.id);
    const tried = run0 && (run0.state === 'up' || run0.state === 'done' || run0.steps.some((s) => s.state === 'up')) ? run0.steps.map((s) => s.cmd).join(' && ') : undefined;
    const several = repos.length > 1;
    const shipping = repos.filter((r) => !r.pr).flatMap((r) => r.files.filter((f) => f.mine).map((f) => (several ? `${r.repo}/${f.path}` : f.path)));
    const tag = (r: RepoShipPlan, s: string) => (several ? `${r.repo}: ${s}` : s);
    return {
      cardId: card.id, repos,
      commit: commitMessage(card), title: prTitle(card), body: prBody(card, shipping, tried),
      blockers: repos.flatMap((r) => r.blockers.map((b) => tag(r, b))),
      notes: repos.flatMap((r) => r.notes.map((n) => tag(r, n))),
    };
  }

  /**
   * What the card changed, with each file's patch: the working tree against where the branch left
   * the base (so commits already made and edits not yet committed both show), plus untracked files.
   */
  async changes(card: Card): Promise<Changes> {
    const cwd = this.folder(card);
    const top = await run('git', ['rev-parse', '--show-toplevel'], cwd);
    if (top.code !== 0) throw new Error(`${cwd} isn’t a git repo.`);
    const root = normalize(top.out);
    const branch = (await run('git', ['branch', '--show-current'], root)).out;
    const remote = await this.remote(root);
    const base = await this.base(root, remote);
    let against = 'HEAD';
    let committed = 0;
    if (branch && branch !== base) {
      const ref = remote && (await run('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${base}`], root)).code === 0 ? `${remote}/${base}` : base;
      const mb = await run('git', ['merge-base', ref, 'HEAD'], root);
      if (mb.code === 0 && mb.out) against = mb.out;
      const n = await run('git', ['rev-list', '--count', `${ref}..HEAD`], root);
      committed = n.code === 0 ? Number(n.out) || 0 : 0;
    }
    const tracked = await run('git', ['diff', '--no-color', '--no-ext-diff', '--find-renames', against, '--'], root, undefined, 60_000);
    let text = tracked.raw.slice(0, MAX_PATCH);
    let truncated = tracked.raw.length > MAX_PATCH;
    const untracked = parseStatus((await run('git', ['status', '--porcelain=v1', '-z', '-uall'], root)).raw).filter((f) => f.status === '??');
    for (const f of untracked) {
      if (text.length >= MAX_PATCH) { truncated = true; break; }
      // --no-index exits 1 when there is a difference, which there always is against nothing.
      const d = await run('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', f.path], root, undefined, 20_000);
      text += d.raw.slice(0, MAX_PATCH - text.length);
    }
    const mine = new Set(relativeTo(root, card.files ?? []).map((p) => p.toLowerCase()));
    const files = parsePatch(text).map((f) => ({ ...f, kind: untracked.some((u) => u.path === f.path) ? 'new' as const : f.kind, mine: mine.has(f.path.toLowerCase()) }));
    // The card's own files first, then the rest, each in path order.
    files.sort((a, b) => Number(b.mine) - Number(a.mine) || a.path.localeCompare(b.path));
    return { root, branch, base: against === 'HEAD' ? branch || 'HEAD' : base, committed, files, ...(truncated ? { truncated: true } : {}) };
  }

  private step(id: string, text: string, state: BootStep['state']): void {
    this.cards.update(id, (c) => {
      // A step in progress is replaced by how it ended.
      const steps = [...(c.ship?.steps ?? [])];
      if (steps.at(-1)?.state === 'go' && state !== 'go') steps.pop();
      steps.push({ at: Date.now(), text, state });
      return { ...c, ship: { ...c.ship, steps } };
    });
  }

  /** Put a PR on the card: replacing the one for the same repo, or added. */
  private savePr(id: string, pr: PullRequest): void {
    this.cards.update(id, (c) => {
      const prs = prsOf(c.ship);
      const i = prs.findIndex((p) => (p.root && pr.root ? samePath(p.root, pr.root) : p.number === pr.number && p.host === pr.host));
      const next = i >= 0 ? prs.map((p, k) => (k === i ? pr : p)) : [...prs, pr];
      const { pr: _old, ...ship } = c.ship ?? { steps: [] };
      return { ...c, ship: { ...ship, steps: ship.steps ?? [], prs: next } };
    });
  }

  /**
   * Commit, push and open a PR in each repo the request names, in the plan's order; a failure
   * stops there, with the repos before it shipped and the rest untouched, and the card says which
   * repos are left so s again ships only those (a repo with a PR already is skipped). A host
   * cc-control doesn't know gets the push and a note to open the PR by hand. Throws with what went
   * wrong; the card keeps the steps and the PRs opened so far.
   */
  async ship(id: string, req: ShipRequest): Promise<PullRequest[]> {
    if (this.busy.has(id)) throw new Error('It is already shipping.');
    const card = this.cards.get(id);
    if (!card) throw new Error('That card is no longer on the line.');
    const plan = await this.plan(card);
    if (plan.blockers.length) throw new Error(plan.blockers[0]);
    // What to ship where: each requested repo without a PR yet, matched to its block, with only files that are really changed.
    const jobs = plan.repos.flatMap((r) => {
      const want = req.repos.find((x) => samePath(x.root, r.root));
      if (!want || r.pr) return [];
      const known = new Set(r.files.map((f) => f.path));
      const paths = [...new Set(want.paths)].filter((p) => known.has(p));
      return paths.length || r.ahead ? [{ r, paths }] : [];
    });
    if (!jobs.length) {
      const open = openPrs(prsOf(card.ship));
      if (open.length) throw new Error(`${card.key} already has ${open.length === 1 ? `PR #${open[0].number}` : `${open.length} open PRs`}. s merges ${open.length === 1 ? 'it' : 'them'}.`);
      throw new Error('Nothing to ship: tick the files to commit.');
    }
    const commit = req.commit.trim();
    const title = req.title.replace(/[\r\n]+/g, ' ').trim();
    if (jobs.some((j) => j.paths.length) && !commit) throw new Error('Write a commit message.');
    if (!title) throw new Error('Give the pull request a title.');

    this.busy.add(id);
    // The steps start over; the PRs an earlier ship opened stay (and the single `pr` of old cards becomes the list).
    this.cards.update(id, (c) => ({ ...c, ship: { steps: [], prs: prsOf(c.ship) } }));
    const several = plan.repos.length > 1;
    const opened: PullRequest[] = [];
    // A PR of another block of the card: opened earlier (a ship that stopped), or in this run so far.
    const prOf = (x: RepoShipPlan) => x.pr ?? opened.find((p) => p.root && samePath(p.root, x.root));
    try {
      for (const { r, paths } of jobs) {
        const root = r.root;
        const tag = several ? `${r.repo}: ` : '';
        const fail = (what: string, o: Out): never => {
          this.step(id, `${tag}${what}: ${why(o)}`, 'bad');
          throw new Error(`${tag}${what}: ${why(o)}`);
        };
        // Stopping here leaves this repo and the ones after it: s again ships them.
        this.cards.update(id, (c) => ({ ...c, ship: { ...c.ship!, left: jobs.slice(jobs.findIndex((j) => j.r === r)).map((j) => j.r.repo) } }));
        let branch = r.branch;
        if (r.newBranch) {
          this.step(id, `${tag}Making branch ${r.newBranch}`, 'go');
          const o = await run('git', ['switch', '-c', r.newBranch], root);
          if (o.code !== 0) fail(`Couldn’t make ${r.newBranch}`, o);
          branch = r.newBranch;
          this.cards.update(id, (c) => ({ ...c, branchName: branch }));
          this.step(id, `${tag}Made branch ${branch}`, 'ok');
        }
        if (paths.length) {
          this.step(id, `${tag}Committing ${paths.length} file${paths.length === 1 ? '' : 's'}`, 'go');
          const add = await run('git', ['add', '--', ...paths], root);
          if (add.code !== 0) fail('git add failed', add);
          const c = await run('git', ['commit', '-F', '-'], root, `${commit}\n`);
          if (c.code !== 0) fail('The commit failed', c);
          const sha = (await run('git', ['rev-parse', '--short', 'HEAD'], root)).out;
          this.step(id, `${tag}Committed ${sha}: ${commit.split('\n')[0]}`, 'ok');
        }
        const remote = (await this.remote(root))!;
        this.step(id, `${tag}Pushing ${branch} to ${remote}`, 'go');
        const push = await run('git', ['push', '-u', remote, branch], root, undefined, 120_000);
        if (push.code !== 0) fail('The push failed', push);
        this.step(id, `${tag}Pushed ${branch} to ${remote}`, 'ok');
        this.cards.update(id, (c) => ({ ...c, stage: 'ship' }));

        const host = await this.host(root, remote);
        if (typeof host === 'string') {
          this.step(id, `${tag}Open the pull request for ${branch} in the browser: cc-control can’t open one on this host yet`, 'ok');
          continue;
        }
        this.step(id, `${tag}Opening the pull request on ${host.name}`, 'go');
        // The body the sheet showed, plus the change's other repos: the PRs that exist linked, the ones still to open named.
        const others = several ? plan.repos.filter((x) => x !== r && (x.pr || jobs.some((j) => j.r === x))).map((x) => ({ repo: x.repo, url: prOf(x)?.url })) : [];
        const body = [req.body.trimEnd(), partOf(card.key, others)].filter(Boolean).join('\n\n');
        let pr: PullRequest;
        try {
          pr = { ...await host.create(root, { title, body, head: branch, base: r.base }), repo: r.repo, root };
        } catch (e) {
          this.step(id, `${tag}${(e as Error).message}`, 'bad');
          throw e;
        }
        this.step(id, `${tag}Opened PR #${pr.number} on ${host.name}`, 'ok');
        opened.push(pr);
        this.savePr(id, pr);
      }
      this.cards.update(id, (c) => { const { left: _done, ...ship } = c.ship ?? { steps: [] }; return { ...c, ship: { ...ship, steps: ship.steps ?? [] } }; });
      return opened;
    } finally {
      this.busy.delete(id);
    }
  }

  /** Look at each of the card's PRs again; all merged moves the card to Done. */
  async refresh(id: string): Promise<PullRequest[]> {
    const card = this.cards.get(id);
    const prs = card ? prsOf(card.ship) : [];
    if (!card || !prs.length) return [];
    const out: PullRequest[] = [];
    for (const pr of prs) {
      const root = pr.root ?? this.folder(card);
      const host = await this.host(root, await this.remote(root));
      if (typeof host === 'string') throw new Error(host);
      const seen = await host.view(root, pr);
      const next: PullRequest = { ...pr, ...seen, checkedAt: Date.now(), ...(pr.root ? {} : { root }) };
      this.savePr(id, next);
      out.push(next);
    }
    if (allMerged(out)) this.cards.update(id, (c) => ({ ...c, stage: 'done' }));
    return out;
  }

  private async refreshAll(): Promise<void> {
    for (const c of this.cards.list()) {
      if (c.stage === 'ship' && openPrs(prsOf(c.ship)).length) await this.refresh(c.id).catch(() => undefined);
    }
  }

  /** Squash-merge each open PR of the card, delete its branch on the remote (the local one stays), and move the card to Done once all are merged. */
  async merge(id: string): Promise<void> {
    if (this.busy.has(id)) throw new Error('It is busy.');
    const card = this.cards.get(id);
    const prs = card ? prsOf(card.ship) : [];
    if (!card || !prs.length) throw new Error('It has no pull request yet. s ships it first.');
    const todo = openPrs(prs);
    if (!todo.length) throw new Error(prs.length === 1 ? `PR #${prs[0].number} is already merged.` : 'Every PR is already merged.');
    this.busy.add(id);
    try {
      for (const pr of todo) {
        const root = pr.root ?? this.folder(card);
        const tag = prs.length > 1 && pr.repo ? `${pr.repo}: ` : '';
        const remote = await this.remote(root);
        const host = await this.host(root, remote);
        if (typeof host === 'string') throw new Error(host);
        this.step(id, `${tag}Merging PR #${pr.number}`, 'go');
        let merged: { deletesBranch: boolean };
        try {
          merged = await host.merge(root, pr);
        } catch (e) {
          this.step(id, `${tag}${(e as Error).message}`, 'bad');
          throw e;
        }
        if (!merged.deletesBranch && card.branchName && remote) await run('git', ['push', remote, '--delete', card.branchName], root);
        this.step(id, `${tag}Merged PR #${pr.number}`, 'ok');
        this.savePr(id, { ...pr, state: 'MERGED', checkedAt: Date.now() });
      }
      if (allMerged(prsOf(this.cards.get(id)?.ship))) this.cards.update(id, (c) => ({ ...c, stage: 'done' }));
    } finally {
      this.busy.delete(id);
    }
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
