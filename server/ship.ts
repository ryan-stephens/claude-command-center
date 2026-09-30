// Ship on the server: work out what shipping a card will do (branch, changed files, the words),
// then do it in the card's folder: a branch when it is on the default one, stage the files you
// ticked by name, commit, push, and `gh pr create`. Later, follow the PR through `gh pr view` and
// merge it with `gh pr merge --squash`. Every step lands on the card, so the sheet and the drawer
// show where it got to and what failed.

import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { branchFor, cardRepos, type BootStep, type Card } from '../shared/cards.ts';
import { commitMessage, prBody, prTitle, type PullRequest, type ShipFile, type ShipPlan, type ShipRequest } from '../shared/ship.ts';
import type { CardService } from './cards.ts';
import type { RunService } from './recipes.ts';

interface Out { code: number; out: string; err: string }

/** Run a program without a shell (arguments go through as they are), optionally feeding stdin. */
function run(cmd: string, args: string[], cwd: string, input?: string, timeout = 60_000): Promise<Out> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { err += d.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out: out.trim(), err: err.trim() }); });
    child.stdin.end(input ?? '');
  });
}

/** The first line of what a failed command said. */
const why = (o: Out) => (o.err || o.out).split(/\r?\n/).find((l) => l.trim())?.trim() ?? `exit ${o.code}`;

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

/** gh's statusCheckRollup, summed up. */
export function checksOf(rollup: unknown): PullRequest['checks'] {
  const items = Array.isArray(rollup) ? (rollup as Record<string, string>[]) : [];
  if (!items.length) return 'none';
  const bad = ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'];
  if (items.some((c) => bad.includes(c.conclusion) || bad.includes(c.state))) return 'fail';
  if (items.some((c) => (c.status && c.status !== 'COMPLETED') || c.state === 'PENDING' || c.state === 'EXPECTED')) return 'pending';
  return 'pass';
}

interface ShipOpts {
  /** CC_CONTROL_GH: another gh (a .js/.mjs file runs with node), for tests. */
  gh?: string;
}

/** How often PRs of cards in Ship are looked at again. */
const PR_POLL_MS = 3 * 60_000;

export class ShipService {
  private cards: CardService;
  private runs: RunService;
  private gh: string;
  private busy = new Set<string>();
  private timer: NodeJS.Timeout;

  constructor(cards: CardService, runs: RunService, opts: ShipOpts = {}) {
    this.cards = cards;
    this.runs = runs;
    this.gh = opts.gh || 'gh';
    this.timer = setInterval(() => { void this.refreshAll(); }, PR_POLL_MS);
    this.timer.unref();
  }

  private ghRun(args: string[], cwd: string, input?: string): Promise<Out> {
    return /\.m?js$/i.test(this.gh) ? run(process.execPath, [this.gh, ...args], cwd, input) : run(this.gh, args, cwd, input);
  }

  private folder(card: Card): string {
    const cwd = card.cwd ?? cardRepos(card)[0];
    if (!cwd) throw new Error(`${card.key} has no folder.`);
    return cwd;
  }

  /** The branch PRs go into: what origin says is its default, else main or master. */
  private async base(root: string, remote: string | null): Promise<string> {
    if (remote) {
      const head = await run('git', ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], root);
      if (head.code === 0 && head.out.includes('/')) return head.out.slice(head.out.indexOf('/') + 1);
    }
    for (const b of ['main', 'master']) {
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
    const remotes = (await run('git', ['remote'], root)).out.split(/\s+/).filter(Boolean);
    const remote = remotes.includes('origin') ? 'origin' : remotes[0] ?? null;
    const base = await this.base(root, remote);
    const blockers: string[] = [];
    const notes: string[] = [];
    if (!branch) blockers.push('The repo isn’t on a branch (a detached HEAD). Switch to one in its tab first.');
    const newBranch = branch && branch === base ? branchFor(card.key, card.title) : undefined;
    if (newBranch && (await run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${newBranch}`], root)).code === 0) {
      blockers.push(`It is on ${base}, and the branch ${newBranch} it would make already exists.`);
    }
    if (!remote) blockers.push('The repo has no remote to push to.');
    const gh = await this.ghRun(['--version'], root);
    if (gh.code !== 0) blockers.push('The GitHub CLI (gh) isn’t installed or doesn’t run. Install it and run gh auth login.');

    const mine = new Set(relativeTo(root, card.files ?? []).map((p) => p.toLowerCase()));
    const files: ShipFile[] = parseStatus((await run('git', ['status', '--porcelain=v1', '-z', '-uall'], root)).out)
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
      commit: commitMessage(card), title: prTitle(card), body: prBody(card, shipping, tried), blockers, notes,
    };
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

  /** Commit, push and open the PR. Throws with what went wrong; the card keeps the steps. */
  async ship(id: string, req: ShipRequest): Promise<PullRequest> {
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
      const remote = (await run('git', ['remote'], root)).out.split(/\s+/).includes('origin') ? 'origin' : (await run('git', ['remote'], root)).out.split(/\s+/)[0];
      this.step(id, `Pushing ${branch} to ${remote}`, 'go');
      const push = await run('git', ['push', '-u', remote, branch], root, undefined, 120_000);
      if (push.code !== 0) fail('The push failed', push);
      this.step(id, `Pushed ${branch} to ${remote}`, 'ok');

      this.step(id, 'Opening the pull request', 'go');
      const bodyFile = join(tmpdir(), `cc-control-pr-${id}.md`);
      writeFileSync(bodyFile, req.body);
      const pr = await this.ghRun(['pr', 'create', '--title', title, '--body-file', bodyFile, '--head', branch, '--base', plan.base], root);
      rmSync(bodyFile, { force: true });
      if (pr.code !== 0) fail('gh pr create failed', pr);
      const url = pr.out.split(/\s+/).find((w) => /^https?:\/\/\S+\/pull\/\d+/.test(w)) ?? '';
      const number = Number(/\/pull\/(\d+)/.exec(url)?.[1] ?? 0);
      if (!number) fail('gh pr create said something unexpected', pr);
      const opened: PullRequest = { number, url, state: 'OPEN', checks: 'none', checkedAt: Date.now() };
      this.step(id, `Opened PR #${number}`, 'ok');
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
    const o = await this.ghRun(['pr', 'view', pr.url, '--json', 'number,url,state,reviewDecision,statusCheckRollup'], this.folder(card));
    if (o.code !== 0) throw new Error(`gh pr view failed: ${why(o)}`);
    const j = JSON.parse(o.out) as { state?: PullRequest['state']; reviewDecision?: string; statusCheckRollup?: unknown };
    const next: PullRequest = { ...pr, state: j.state ?? pr.state, review: j.reviewDecision ?? '', checks: checksOf(j.statusCheckRollup), checkedAt: Date.now() };
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
    this.busy.add(id);
    try {
      this.step(id, `Merging PR #${pr.number}`, 'go');
      const o = await this.ghRun(['pr', 'merge', pr.url, '--squash'], root);
      if (o.code !== 0) { this.step(id, `The merge failed: ${why(o)}`, 'bad'); throw new Error(`The merge failed: ${why(o)}`); }
      if (card.branchName) {
        const remote = (await run('git', ['remote'], root)).out.split(/\s+/).includes('origin') ? 'origin' : undefined;
        if (remote) await run('git', ['push', remote, '--delete', card.branchName], root);
      }
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
