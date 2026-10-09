// The Ship dock's server half: for each of the session's worktrees with commits, push the branch and
// open its PR on the repo's host (v1's GitHub and Azure DevOps hosts), with the session's evidence in
// the body, then post the review request to the team's channel through a Slack incoming webhook
// (CC_CONTROL_SLACK_WEBHOOK in ~/.cc-control/config.env, never the repo). Claude commits; ship never
// commits for it, and refuses while a worktree has uncommitted changes.

import { hostFor, run, why } from '../../server/hosts.ts';
import { prBody, slackText } from '../shared/ship-text.ts';
import { evidenceOf, defaultTitle } from '../shared/ship-text.ts';
import type { Session, ShipPlan, ShippedPr } from '../shared/types.ts';

export interface SlackConfig { webhook: string; channel: string; mention: string }

export function slackConfig(env: NodeJS.ProcessEnv = process.env): SlackConfig | undefined {
  const webhook = env.CC_CONTROL_SLACK_WEBHOOK?.trim();
  // Slack's incoming webhooks; a loopback address is allowed too (a stand-in, for walkthroughs).
  if (!webhook || !/^(https:\/\/hooks\.slack\.com\/|http:\/\/127\.0\.0\.1:\d{1,5}\/)\S*$/.test(webhook)) return undefined;
  return { webhook, channel: env.CC_CONTROL_SLACK_CHANNEL?.trim() || 'the team channel', mention: env.CC_CONTROL_SLACK_MENTION?.trim() ?? '' };
}

async function git(dir: string, args: string[]): Promise<string> {
  const o = await run('git', args, dir, undefined, 30_000);
  if (o.code !== 0) throw new Error(why(o));
  return o.out.trim();
}

/** The branch a worktree's PR goes into: the remote's default (origin/HEAD), else main. */
async function baseOf(dir: string, remote: string): Promise<string> {
  const head = await git(dir, ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`]).catch(() => '');
  return head.replace(`${remote}/`, '') || 'main';
}

interface RepoState { name: string; dir: string; branch: string; ahead: number; dirty: number; remote?: string; url?: string; base: string; host?: ReturnType<typeof hostFor> }

async function stateOf(r: Session['repos'][number]): Promise<RepoState> {
  const branch = await git(r.dir, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '');
  const dirty = (await git(r.dir, ['status', '--porcelain']).catch(() => '')).split(/\r?\n/).filter(Boolean).length;
  const remotes = (await git(r.dir, ['remote']).catch(() => '')).split(/\r?\n/).filter(Boolean);
  const remote = remotes.includes('origin') ? 'origin' : remotes[0];
  const base = remote ? await baseOf(r.dir, remote) : 'main';
  const ahead = Number(await git(r.dir, ['rev-list', '--count', `${remote ? `${remote}/` : ''}${base}..HEAD`]).catch(() => '0')) || 0;
  const url = remote ? await git(r.dir, ['remote', 'get-url', remote]).catch(() => '') : '';
  return { name: r.name, dir: r.dir, branch, ahead, dirty, base, ...(remote ? { remote } : {}), ...(url ? { url, host: hostFor(url) } : {}) };
}

/** What shipping would do, and what stops it, before anything runs. */
export async function shipPlan(s: Session, slack?: SlackConfig): Promise<ShipPlan> {
  const states = await Promise.all(s.repos.map(stateOf));
  const repos: ShipPlan['repos'] = [];
  const blockers: string[] = [];
  for (const st of states) {
    const pr = s.prs.find((p) => p.repo === st.name);
    let blocker: string | undefined;
    if (st.dirty) blocker = `${st.dirty} uncommitted change${st.dirty === 1 ? '' : 's'}: ask Claude to commit first`;
    else if (!st.remote) blocker = 'no remote to push to';
    else if (!st.branch || st.branch === 'HEAD' || st.branch === st.base) blocker = `on ${st.branch || 'no branch'}, not the session's branch`;
    if (blocker && (st.ahead || st.dirty)) blockers.push(`${st.name}: ${blocker}`);
    repos.push({ name: st.name, branch: st.branch, ahead: st.ahead, dirty: st.dirty, ...(st.host ? { host: typeof st.host === 'string' ? 'unknown host' : st.host.name } : {}), ...(pr ? { pr } : {}), ...(blocker ? { blocker } : {}) });
  }
  if (!repos.some((r) => r.ahead > 0) && !s.prs.length) blockers.push('No commits on the session’s branch yet.');
  const body = prBody(s, '', []);
  return {
    title: defaultTitle(s), body, repos, evidence: evidenceOf(s), blockers,
    ...(slack ? { slack: { channel: slack.channel, text: slackText(s, s.prs, slack.mention) } } : {}),
  };
}

/** Push and open the PRs (a repo that already has one is pushed again), then post. Returns the PRs and what happened. */
export async function ship(s: Session, opts: { title: string; summary: string; post: boolean; mention: boolean }, slack?: SlackConfig): Promise<{ prs: ShippedPr[]; notes: string[]; posted?: boolean }> {
  const plan = await shipPlan(s, slack);
  if (plan.blockers.length) throw new Error(plan.blockers.join(' · '));
  const states = await Promise.all(s.repos.map(stateOf));
  const prs: ShippedPr[] = [...s.prs];
  const notes: string[] = [];
  const todo = states.filter((st) => st.ahead > 0);
  for (const st of todo) {
    const push = await run('git', ['push', '-u', st.remote!, st.branch], st.dir, undefined, 120_000);
    if (push.code !== 0) throw new Error(`${st.name}: the push failed: ${why(push)}`);
    if (prs.some((p) => p.repo === st.name)) { notes.push(`${st.name}: pushed to its open PR`); continue; }
    if (!st.host || typeof st.host === 'string') { notes.push(`${st.name}: pushed; open its PR by hand (${typeof st.host === 'string' ? st.host : 'unknown host'})`); continue; }
    const others = todo.filter((o) => o !== st).map((o) => ({ repo: o.name }));
    const pr = await st.host.create(st.dir, { title: opts.title, body: prBody(s, opts.summary, others), head: st.branch, base: st.base });
    prs.push({ repo: st.name, number: pr.number, url: pr.url, ...(pr.state ? { state: pr.state } : {}) });
    notes.push(`${st.name}: PR #${pr.number} opened`);
  }
  let posted: boolean | undefined;
  if (opts.post && slack) {
    posted = await postSlack(slack, slackText(s, prs, opts.mention ? slack.mention : ''));
    notes.push(posted ? `posted to ${slack.channel}` : `couldn’t post to ${slack.channel}`);
  }
  return { prs, notes, ...(posted !== undefined ? { posted } : {}) };
}

export async function postSlack(slack: SlackConfig, text: string): Promise<boolean> {
  try {
    const res = await fetch(slack.webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** A shipped PR as its host says now: state, review, checks. */
export async function refreshPr(s: Session, pr: ShippedPr): Promise<ShippedPr> {
  const r = s.repos.find((x) => x.name === pr.repo);
  if (!r) return pr;
  const url = await git(r.dir, ['remote', 'get-url', 'origin']).catch(() => '');
  const host = url ? hostFor(url) : undefined;
  if (!host || typeof host === 'string') return pr;
  try {
    const v = await host.view(r.dir, { number: pr.number, url: pr.url });
    return { ...pr, ...(v.state ? { state: v.state } : {}), ...(v.review !== undefined ? { review: v.review } : {}), ...(v.checks ? { checks: v.checks } : {}) };
  } catch {
    return pr;
  }
}
