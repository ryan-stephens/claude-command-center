// Where a card's pull request goes, picked from the repo's remote URL. Branch, commit and push are
// plain git and the same everywhere (server/ship.ts); only opening, following and merging the PR
// differ, so each host is one class behind CodeHost:
//
// - GitHub (github.com): the gh CLI, with its own login.
// - Azure DevOps (dev.azure.com, *.visualstudio.com, or Azure DevOps Server / TFS on-prem, any URL
//   with /_git/): its REST API with a personal access token, CC_CONTROL_ADO_TOKEN (scope: Code, read
//   & write). The server's API version isn't known in advance (TFS 2018 speaks 4.1, Azure DevOps
//   Server 2022 speaks 7.0), so requests try the newest first and remember what the server accepts;
//   CC_CONTROL_ADO_API_VERSION pins one. An SSH remote on-prem doesn't say its web address:
//   CC_CONTROL_ADO_URL gives the collection URL (https://tfs.company.local/tfs/DefaultCollection).
//
// Another host (GitLab, Bitbucket…) is another class here. PLAN §35.

import { spawn } from 'node:child_process';
import type { PullRequest } from '../shared/ship.ts';

/** What a command printed: `out` trimmed for reading, `raw` as it came (git status's leading spaces matter). */
export interface Out { code: number; out: string; err: string; raw: string }

/** Run a program without a shell (arguments go through as they are), optionally feeding stdin. */
export function run(cmd: string, args: string[], cwd: string, input?: string, timeout = 60_000): Promise<Out> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { err += d.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: e.message, raw: out }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out: out.trim(), err: err.trim(), raw: out }); });
    child.stdin.end(input ?? '');
  });
}

/** The first line of what a failed command said. */
export const why = (o: Out) => (o.err || o.out).split(/\r?\n/).find((l) => l.trim())?.trim() ?? `exit ${o.code}`;

export interface NewPr { title: string; body: string; head: string; base: string }

export interface CodeHost {
  /** "GitHub", "Azure DevOps": for the sheet ("opens the PR on Azure DevOps"). */
  name: string;
  /** What will stop it, said before anything runs (a missing token, gh not installed). */
  check(root: string): Promise<string[]>;
  create(root: string, pr: NewPr): Promise<PullRequest>;
  view(root: string, pr: PullRequest): Promise<Pick<PullRequest, 'state' | 'review' | 'checks'>>;
  /** Squash-merge. `deletesBranch`: the host removes the source branch itself. */
  merge(root: string, pr: PullRequest): Promise<{ deletesBranch: boolean }>;
}

// ---- GitHub ---------------------------------------------------------------------------------------

/** gh's statusCheckRollup, summed up. */
export function checksOf(rollup: unknown): PullRequest['checks'] {
  const items = Array.isArray(rollup) ? (rollup as Record<string, string>[]) : [];
  if (!items.length) return 'none';
  const bad = ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'];
  if (items.some((c) => bad.includes(c.conclusion) || bad.includes(c.state))) return 'fail';
  if (items.some((c) => (c.status && c.status !== 'COMPLETED') || c.state === 'PENDING' || c.state === 'EXPECTED')) return 'pending';
  return 'pass';
}

export class GitHubHost implements CodeHost {
  name = 'GitHub';
  private gh: string;

  /** `gh`: the CLI, or a .js/.mjs file run with node (CC_CONTROL_GH, for tests). */
  constructor(gh = 'gh') {
    this.gh = gh;
  }

  private ghRun(args: string[], cwd: string): Promise<Out> {
    return /\.m?js$/i.test(this.gh) ? run(process.execPath, [this.gh, ...args], cwd) : run(this.gh, args, cwd);
  }

  async check(root: string): Promise<string[]> {
    const v = await this.ghRun(['--version'], root);
    return v.code === 0 ? [] : ['The GitHub CLI (gh) isn’t installed or doesn’t run. Install it and run gh auth login.'];
  }

  async create(root: string, pr: NewPr): Promise<PullRequest> {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'cc-control-pr-'));
    const bodyFile = join(dir, 'body.md');
    writeFileSync(bodyFile, pr.body);
    const o = await this.ghRun(['pr', 'create', '--title', pr.title, '--body-file', bodyFile, '--head', pr.head, '--base', pr.base], root);
    rmSync(dir, { recursive: true, force: true });
    if (o.code !== 0) throw new Error(`gh pr create failed: ${why(o)}`);
    const url = o.out.split(/\s+/).find((w) => /^https?:\/\/\S+\/pull\/\d+/.test(w)) ?? '';
    const number = Number(/\/pull\/(\d+)/.exec(url)?.[1] ?? 0);
    if (!number) throw new Error(`gh pr create said something unexpected: ${why(o)}`);
    return { number, url, host: 'github', state: 'OPEN', checks: 'none', checkedAt: Date.now() };
  }

  async view(root: string, pr: PullRequest): Promise<Pick<PullRequest, 'state' | 'review' | 'checks'>> {
    const o = await this.ghRun(['pr', 'view', pr.url, '--json', 'number,url,state,reviewDecision,statusCheckRollup'], root);
    if (o.code !== 0) throw new Error(`gh pr view failed: ${why(o)}`);
    const j = JSON.parse(o.out) as { state?: PullRequest['state']; reviewDecision?: string; statusCheckRollup?: unknown };
    return { state: j.state ?? pr.state, review: j.reviewDecision ?? '', checks: checksOf(j.statusCheckRollup) };
  }

  async merge(root: string, pr: PullRequest): Promise<{ deletesBranch: boolean }> {
    // No --delete-branch: it would also switch the card's folder, maybe under a running session.
    const o = await this.ghRun(['pr', 'merge', pr.url, '--squash'], root);
    if (o.code !== 0) throw new Error(`The merge failed: ${why(o)}`);
    return { deletesBranch: false };
  }
}

// ---- Azure DevOps ---------------------------------------------------------------------------------

/** Where an Azure DevOps repo lives: its collection (or organization) URL, project and repo name. */
export interface AdoRepo { collection: string; project: string; repo: string }

/**
 * The repo behind an Azure DevOps remote, or undefined when it isn't one:
 * https://dev.azure.com/org/Project/_git/Repo, https://org.visualstudio.com/[DefaultCollection/]Project/_git/Repo,
 * https://tfs.company.local/tfs/DefaultCollection/Project/_git/Repo (on-prem), the short form without
 * the project (…/Collection/_git/Repo, where the project is named like the repo), and SSH:
 * git@ssh.dev.azure.com:v3/org/Project/Repo, or on-prem ssh://host:22/tfs/Collection/Project/_git/Repo
 * (whose https address comes from `collectionUrl`, CC_CONTROL_ADO_URL).
 */
export function adoRepo(remote: string, collectionUrl?: string): AdoRepo | undefined {
  const url = remote.trim();
  const v3 = /^(?:ssh:\/\/)?[^@]+@(?:ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com):(?:\d+\/)?v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  if (v3) return { collection: `https://dev.azure.com/${v3[1]}`, project: decodeURIComponent(v3[2]), repo: decodeURIComponent(v3[3]) };
  const m = /^(https?|ssh):\/\/(?:[^@/]+@)?([^/]+)(\/.*)?\/_git\/([^/?#]+?)(?:\.git)?\/?$/.exec(url);
  if (!m) return undefined;
  const [, scheme, host, prefix = '', repo] = m;
  const parts = prefix.split('/').filter(Boolean).map(decodeURIComponent);
  // The last segment before /_git/ is the project, unless that leaves no collection (dev.azure.com/org/_git/Repo, …/Collection/_git/Repo).
  const bareCollection = /^dev\.azure\.com$/i.test(host) ? parts.length === 1 : /\.visualstudio\.com$/i.test(host) ? parts.length === 0 || (parts.length === 1 && /^DefaultCollection$/i.test(parts[0])) : parts.length <= (parts[0]?.toLowerCase() === 'tfs' ? 2 : 1);
  const project = bareCollection ? decodeURIComponent(repo) : parts.pop()!;
  const hostOnly = host.replace(/:\d+$/, '');
  let base: string;
  if (scheme === 'ssh') {
    if (!collectionUrl) return { collection: '', project, repo: decodeURIComponent(repo) };
    base = collectionUrl.replace(/\/+$/, '');
  } else {
    base = `${scheme}://${/\.visualstudio\.com$|dev\.azure\.com$/i.test(hostOnly) ? hostOnly : host}${parts.length ? `/${parts.map(encodeURIComponent).join('/')}` : ''}`;
  }
  return { collection: base, project, repo: decodeURIComponent(repo) };
}

/** Reviewers' votes, summed up: 10 approved, 5 approved with suggestions, 0 none, -5 waiting for the author, -10 rejected. */
export function reviewOf(reviewers: { vote?: number; isRequired?: boolean }[] | undefined): string {
  const votes = (reviewers ?? []).map((r) => r.vote ?? 0);
  if (votes.some((v) => v <= -5)) return 'CHANGES_REQUESTED';
  if (votes.some((v) => v >= 5) && !(reviewers ?? []).some((r) => r.isRequired && (r.vote ?? 0) < 5)) return 'APPROVED';
  return 'REVIEW_REQUIRED';
}

/** Branch policy evaluations (builds, required reviewers…), summed up like GitHub's checks. */
export function policiesOf(evals: { status?: string }[] | undefined): PullRequest['checks'] {
  const s = (evals ?? []).map((e) => e.status ?? '').filter((x) => x && x !== 'notApplicable');
  if (!s.length) return 'none';
  if (s.some((x) => x === 'rejected' || x === 'broken')) return 'fail';
  if (s.some((x) => x === 'running' || x === 'queued')) return 'pending';
  return 'pass';
}

const API_VERSIONS = ['7.0', '6.0', '5.0', '4.1'];
/** The API version each collection accepted, so later requests go straight to it. */
const accepted = new Map<string, string>();

export class AzureDevOpsHost implements CodeHost {
  name = 'Azure DevOps';
  private repo: AdoRepo;
  private token: string | undefined;
  private pinned: string | undefined;

  constructor(repo: AdoRepo, env: NodeJS.ProcessEnv = process.env) {
    this.repo = repo;
    this.token = env.CC_CONTROL_ADO_TOKEN?.trim() || undefined;
    this.pinned = env.CC_CONTROL_ADO_API_VERSION?.trim() || undefined;
  }

  private base(): string {
    const { collection, project, repo } = this.repo;
    return `${collection}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}`;
  }

  /** The PR's page, as people open it. */
  webUrl(id: number): string {
    const { collection, project, repo } = this.repo;
    return `${collection}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${id}`;
  }

  /** One request, trying API versions newest first until the server accepts one. `preview`: the policy API is still a preview. */
  private async api<T>(method: string, path: string, body?: unknown, preview = false): Promise<T> {
    const versions = this.pinned ? [this.pinned] : accepted.has(this.repo.collection) ? [accepted.get(this.repo.collection)!] : API_VERSIONS;
    let last = '';
    for (const v of versions) {
      const sep = path.includes('?') ? '&' : '?';
      let res: Response;
      try {
        res = await fetch(`${path}${sep}api-version=${v}${preview ? '-preview.1' : ''}`, {
          method,
          headers: { Authorization: `Basic ${Buffer.from(`:${this.token}`).toString('base64')}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message;
        throw new Error(`Couldn't reach ${this.repo.collection} (${code})${/CERT|ISSUER|SELF_SIGNED/.test(code) ? ': its certificate isn’t trusted; see CC_CONTROL_CA_FILE' : ''}`);
      }
      const text = await res.text();
      if (res.ok) {
        if (!this.pinned) accepted.set(this.repo.collection, v);
        return (text ? JSON.parse(text) : {}) as T;
      }
      last = `${res.status} ${(() => { try { return (JSON.parse(text) as { message?: string }).message ?? res.statusText; } catch { return res.statusText; } })()}`;
      // An older server says the version is out of range; try the next one. Anything else is the answer.
      if (!(res.status === 400 && /VssVersionOutOfRange|api-version|not supported/i.test(text))) break;
    }
    if (/^401/.test(last)) throw new Error('Azure DevOps said 401: check CC_CONTROL_ADO_TOKEN (a personal access token with Code: read & write).');
    if (/^404/.test(last)) throw new Error(`Azure DevOps said ${last}: check that ${this.repo.project}/${this.repo.repo} is right and the token can see it.`);
    throw new Error(`Azure DevOps said ${last}`);
  }

  /** Reach the repo through the API (pnpm doctor): which API version answered. */
  async ping(): Promise<string> {
    const r = await this.api<{ name?: string }>('GET', this.base());
    return `reached ${this.repo.project}/${r.name ?? this.repo.repo} (API ${accepted.get(this.repo.collection) ?? this.pinned ?? '?'})`;
  }

  async check(): Promise<string[]> {
    const out: string[] = [];
    if (!this.repo.collection) out.push('The remote is SSH, which doesn’t say the server’s web address: set CC_CONTROL_ADO_URL to the collection URL (https://tfs.company.local/tfs/DefaultCollection).');
    if (!this.token) out.push('Set CC_CONTROL_ADO_TOKEN in ~/.cc-control/config.env to a personal access token with Code: read & write, then restart the server.');
    return out;
  }

  async create(_root: string, pr: NewPr): Promise<PullRequest> {
    // Descriptions are capped at 4000 characters.
    const description = pr.body.length > 4000 ? `${pr.body.slice(0, 3960)}\n\n…(cut to fit Azure DevOps)` : pr.body;
    const r = await this.api<{ pullRequestId?: number }>('POST', `${this.base()}/pullrequests`, {
      sourceRefName: `refs/heads/${pr.head}`, targetRefName: `refs/heads/${pr.base}`, title: pr.title, description,
    });
    if (!r.pullRequestId) throw new Error('Azure DevOps didn’t say which pull request it opened.');
    return { number: r.pullRequestId, url: this.webUrl(r.pullRequestId), host: 'azure', state: 'OPEN', checks: 'none', checkedAt: Date.now() };
  }

  async view(_root: string, pr: PullRequest): Promise<Pick<PullRequest, 'state' | 'review' | 'checks'>> {
    const r = await this.api<{ status?: string; reviewers?: { vote?: number; isRequired?: boolean }[]; repository?: { project?: { id?: string } } }>('GET', `${this.base()}/pullrequests/${pr.number}`);
    const state: PullRequest['state'] = r.status === 'completed' ? 'MERGED' : r.status === 'abandoned' ? 'CLOSED' : 'OPEN';
    let checks: PullRequest['checks'] = 'none';
    const projectId = r.repository?.project?.id;
    if (projectId && state === 'OPEN') {
      const artifact = encodeURIComponent(`vstfs:///CodeReview/CodeReviewId/${projectId}/${pr.number}`);
      const ev = await this.api<{ value?: { status?: string }[] }>('GET', `${this.repo.collection}/${encodeURIComponent(this.repo.project)}/_apis/policy/evaluations?artifactId=${artifact}`, undefined, true).catch(() => undefined);
      checks = policiesOf(ev?.value);
    }
    return { state, review: reviewOf(r.reviewers), checks };
  }

  async merge(_root: string, pr: PullRequest): Promise<{ deletesBranch: boolean }> {
    const r = await this.api<{ status?: string; lastMergeSourceCommit?: { commitId?: string } }>('GET', `${this.base()}/pullrequests/${pr.number}`);
    if (r.status === 'completed') return { deletesBranch: true };
    const done = await this.api<{ status?: string; mergeStatus?: string }>('PATCH', `${this.base()}/pullrequests/${pr.number}`, {
      status: 'completed',
      lastMergeSourceCommit: { commitId: r.lastMergeSourceCommit?.commitId },
      // mergeStrategy is 5.1 and later; squashMerge is what older servers read.
      completionOptions: { mergeStrategy: 'squash', squashMerge: true, deleteSourceBranch: true },
    });
    if (done.status && done.status !== 'completed') throw new Error(`Azure DevOps didn’t complete it yet (${done.mergeStatus ?? done.status}). Policies may still be running; try again, or finish it in the browser.`);
    return { deletesBranch: true };
  }
}

// ---- Picking one ----------------------------------------------------------------------------------

/** The host for a remote URL, or why there is none. */
export function hostFor(remote: string, env: NodeJS.ProcessEnv = process.env): CodeHost | string {
  const ado = adoRepo(remote, env.CC_CONTROL_ADO_URL);
  if (ado) return new AzureDevOpsHost(ado, env);
  if (/github\.com[:/]/i.test(remote) || env.CC_CONTROL_GH) return new GitHubHost(env.CC_CONTROL_GH || 'gh');
  return `cc-control doesn’t know how to open a pull request on ${remote.replace(/\/\/[^@/]+@/, '//')} yet (it knows GitHub and Azure DevOps). Push the branch and open it in the browser.`;
}
