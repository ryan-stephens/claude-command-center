// Ship on the server: work out what shipping a card will do (branch, changed files, the words),
// then do it in the card's folder: a branch when it is on the default one, stage the files you
// ticked by name, commit, push, and open the pull request on the repo's host (server/hosts.ts:
// GitHub through gh, Azure DevOps / TFS through its REST API). Later, follow the PR and squash-merge
// it. Every step lands on the card, so the sheet and the drawer show where it got to and what failed.

import { normalize } from 'node:path';
import { branchFor, cardRepos, type BootStep, type Card } from '../shared/cards.ts';
import { parsePatch, type Changes } from '../shared/changes.ts';
import { commitMessage, prBody, prTitle, type PullRequest, type ShipFile, type ShipPlan, type ShipRequest } from '../shared/ship.ts';

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

  async plan(card: Card): Promise<ShipPlan> {
    const cwd = this.folder(card);
    const top = await run('git', ['rev-parse', '--show-toplevel'], cwd);
    if (top.code !== 0) throw new Error(`${cwd} isn’t a git repo.`);
    const root = normalize(top.out);
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
    const elsewhere = (card.files ?? []).length - relativeTo(root, card.files ?? []).length;
    if (elsewhere) notes.push(`${elsewhere} file${elsewhere === 1 ? '' : 's'} it changed in other repos ${elsewhere === 1 ? 'isn’t' : 'aren’t'} part of this PR.`);

    let ahead = 0;
    if (branch && branch !== base) {
      const ref = remote && (await run('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${base}`], root)).code === 0 ? `${remote}/${base}` : base;
      const n = await run('git', ['rev-list', '--count', `${ref}..HEAD`], root);
      ahead = n.code === 0 ? Number(n.out) || 0 : 0;
    }
    if (!files.some((f) => f.mine) && !ahead) notes.push('Claude hasn’t changed any files here that git can see. Tick the ones to ship.');

    const run0 = this.runs.get(card.id);
    const tried = run0 && (run0.state === 'up' || run0.state === 'done' || run0.steps.some((s) => s.state === 'up')) ? run0.steps.map((s) => s.cmd).join(' && ') : undefined;
    const shipping = files.filter((f) => f.mine).map((f) => f.path);
    return {
      cardId: card.id, root, branch, ...(newBranch ? { newBranch } : {}), base, files, ahead,
      host: typeof host === 'string' ? '' : host.name,
      commit: commitMessage(card), title: prTitle(card), body: prBody(card, shipping, tried), blockers, notes,
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

  /** Commit, push and open the PR (none when the host is one cc-control doesn't know). Throws with what went wrong; the card keeps the steps. */
  async ship(id: string, req: ShipRequest): Promise<PullRequest | undefined> {
    if (this.busy.has(id)) throw new Error('It is already shipping.');
    const card = this.cards.get(id);
    if (!card) throw new Error('That card is no longer on the line.');
    if (card.ship?.pr && card.ship.pr.state !== 'CLOSED') throw new Error(`${card.key} already has PR #${card.ship.pr.number}. s merges it.`);
    const plan = await this.plan(card);
    if (plan.blockers.length) throw new Error(plan.blockers[0]);
    const known = new Map(plan.files.map((f) => [f.path, f]));
    const paths = [...new Set(req.paths)].filter((p) => known.has(p));
    if (!paths.length && !plan.ahead) throw new Error('Nothing to ship: tick the files to commit.');
    const commit = req.commit.trim();
    const title = req.title.replace(/[\r\n]+/g, ' ').trim();
    if (paths.length && !commit) throw new Error('Write a commit message.');
    if (!title) throw new Error('Give the pull request a title.');

    this.busy.add(id);
    this.cards.update(id, (c) => ({ ...c, ship: { steps: [] } }));
    const root = plan.root;
    const fail = (what: string, o: Out): never => {
      this.step(id, `${what}: ${why(o)}`, 'bad');
      throw new Error(`${what}: ${why(o)}`);
    };
    try {
      let branch = plan.branch;
      if (plan.newBranch) {
        this.step(id, `Making branch ${plan.newBranch}`, 'go');
        const o = await run('git', ['switch', '-c', plan.newBranch], root);
        if (o.code !== 0) fail(`Couldn’t make ${plan.newBranch}`, o);
        branch = plan.newBranch;
        this.cards.update(id, (c) => ({ ...c, branchName: branch }));
        this.step(id, `Made branch ${branch}`, 'ok');
      }
      if (paths.length) {
        this.step(id, `Committing ${paths.length} file${paths.length === 1 ? '' : 's'}`, 'go');
        const add = await run('git', ['add', '--', ...paths], root);
        if (add.code !== 0) fail('git add failed', add);
        const c = await run('git', ['commit', '-F', '-'], root, `${commit}\n`);
        if (c.code !== 0) fail('The commit failed', c);
        const sha = (await run('git', ['rev-parse', '--short', 'HEAD'], root)).out;
        this.step(id, `Committed ${sha}: ${commit.split('\n')[0]}`, 'ok');
      }
      const remote = (await this.remote(root))!;
      this.step(id, `Pushing ${branch} to ${remote}`, 'go');
      const push = await run('git', ['push', '-u', remote, branch], root, undefined, 120_000);
      if (push.code !== 0) fail('The push failed', push);
      this.step(id, `Pushed ${branch} to ${remote}`, 'ok');

      const host = await this.host(root, remote);
      if (typeof host === 'string') {
        this.step(id, `Open the pull request for ${branch} in the browser: cc-control can’t open one on this host yet`, 'ok');
        this.cards.update(id, (c) => ({ ...c, stage: 'ship' }));
        return undefined;
      }
      this.step(id, `Opening the pull request on ${host.name}`, 'go');
      let opened: PullRequest;
      try {
        opened = await host.create(root, { title, body: req.body, head: branch, base: plan.base });
      } catch (e) {
        this.step(id, (e as Error).message, 'bad');
        throw e;
      }
      this.step(id, `Opened PR #${opened.number} on ${host.name}`, 'ok');
      this.cards.update(id, (c) => ({ ...c, stage: 'ship', ship: { ...c.ship, steps: c.ship?.steps ?? [], pr: opened } }));
      return opened;
    } finally {
      this.busy.delete(id);
    }
  }

  /** Look at the card's PR again; a merged one moves the card to Done. */
  async refresh(id: string): Promise<PullRequest | undefined> {
    const card = this.cards.get(id);
    const pr = card?.ship?.pr;
    if (!card || !pr) return undefined;
    const root = this.folder(card);
    const host = await this.host(root, await this.remote(root));
    if (typeof host === 'string') throw new Error(host);
    const seen = await host.view(root, pr);
    const next: PullRequest = { ...pr, ...seen, checkedAt: Date.now() };
    this.cards.update(id, (c) => ({ ...c, ...(next.state === 'MERGED' ? { stage: 'done' as const } : {}), ship: { ...c.ship, steps: c.ship?.steps ?? [], pr: next } }));
    return next;
  }

  private async refreshAll(): Promise<void> {
    for (const c of this.cards.list()) {
      if (c.stage === 'ship' && c.ship?.pr?.state === 'OPEN') await this.refresh(c.id).catch(() => undefined);
    }
  }

  /** Squash-merge the card's PR, delete its branch on the remote (the local one stays), and move it to Done. */
  async merge(id: string): Promise<void> {
    if (this.busy.has(id)) throw new Error('It is busy.');
    const card = this.cards.get(id);
    const pr = card?.ship?.pr;
    if (!card || !pr) throw new Error('It has no pull request yet. s ships it first.');
    if (pr.state === 'MERGED') throw new Error(`PR #${pr.number} is already merged.`);
    const root = this.folder(card);
    const remote = await this.remote(root);
    const host = await this.host(root, remote);
    if (typeof host === 'string') throw new Error(host);
    this.busy.add(id);
    try {
      this.step(id, `Merging PR #${pr.number}`, 'go');
      let merged: { deletesBranch: boolean };
      try {
        merged = await host.merge(root, pr);
      } catch (e) {
        this.step(id, (e as Error).message, 'bad');
        throw e;
      }
      if (!merged.deletesBranch && card.branchName && remote) await run('git', ['push', remote, '--delete', card.branchName], root);
      this.step(id, `Merged PR #${pr.number}`, 'ok');
      this.cards.update(id, (c) => ({ ...c, stage: 'done', ship: { ...c.ship, steps: c.ship?.steps ?? [], pr: { ...pr, state: 'MERGED', checkedAt: Date.now() } } }));
    } finally {
      this.busy.delete(id);
    }
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
