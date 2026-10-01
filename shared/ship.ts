// Ship: commit a card's work, push its branch and open a pull request written from its ticket.
// The words (commit message, PR title and body) are pure and shared, so the sheet shows exactly
// what the server will send; server/ship.ts runs git and gh.

import type { Card } from './cards.ts';

/** A pull request a card opened, as last seen through its host. */
export interface PullRequest {
  number: number;
  /** Its page on the host. */
  url: string;
  /** Where it lives (older cards: GitHub). */
  host?: 'github' | 'azure';
  state?: 'OPEN' | 'MERGED' | 'CLOSED';
  /** gh's reviewDecision: APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or empty. */
  review?: string;
  checks?: 'pass' | 'fail' | 'pending' | 'none';
  checkedAt?: number;
  /** The repo it is for (its folder name) and the folder it was shipped from; unset on cards from before Ship went per repo. */
  repo?: string;
  root?: string;
}

/** A changed file in the card's repo, relative to its root. `mine`: the card's session wrote it. */
export interface ShipFile {
  path: string;
  /** git's two-letter status: " M", "??", "A ", "D "… */
  status: string;
  mine: boolean;
}

/** What shipping one of the card's repos will do. */
export interface RepoShipPlan {
  /** The repo's folder name, and the folder it ships from (the card's worktree of it, or the repo itself). */
  repo: string;
  root: string;
  /** The branch it is on, and the new branch it will make first when that is the default branch. */
  branch: string;
  newBranch?: string;
  /** The branch the PR goes into. */
  base: string;
  /** Where the PR will open ("GitHub", "Azure DevOps"); empty when there is no host for the remote. */
  host: string;
  files: ShipFile[];
  /** Commits already on the branch that the base doesn't have. */
  ahead: number;
  /** Problems that will stop it, found up front (no remote, gh missing…). */
  blockers: string[];
  /** Worth knowing, but not in the way. */
  notes: string[];
}

/**
 * What shipping a card will do, worked out by the server when the sheet opens: one block per repo
 * the card changed (its home repo always), with one commit message, title and body for all of them.
 */
export interface ShipPlan {
  cardId: string;
  repos: RepoShipPlan[];
  commit: string;
  title: string;
  body: string;
  /** Every repo's blockers, named by repo when there are several. */
  blockers: string[];
  notes: string[];
}

/** What the sheet sends back: the words as edited, and the files to commit in each repo (by its root). */
export interface ShipRequest {
  commit: string;
  title: string;
  body: string;
  repos: { root: string; paths: string[] }[];
}

/** A card's pull requests: the list, or the single one cards had before Ship went per repo. */
export function prsOf(ship: { pr?: PullRequest; prs?: PullRequest[] } | undefined): PullRequest[] {
  return ship?.prs ?? (ship?.pr ? [ship.pr] : []);
}

export const allMerged = (prs: PullRequest[]) => prs.length > 0 && prs.every((p) => p.state === 'MERGED');
export const openPrs = (prs: PullRequest[]) => prs.filter((p) => p.state === 'OPEN' || !p.state);

/** The tile's one line: "PR #12 · approved · checks passing", or "2 PRs · #12 approved, #7 waiting for review". */
export function prsLine(prs: PullRequest[]): string {
  if (prs.length <= 1) return prs[0] ? prLine(prs[0]) : '';
  return `${prs.length} PRs · ${prs.map((p) => prLine(p).replace(/^PR /, '')).join(', ')}`;
}

const lcFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const firstPara = (s: string, max: number) => {
  const p = s.trim().split(/\n\s*\n/)[0]?.trim() ?? '';
  return p.length > max ? `${p.slice(0, max - 1)}…` : p;
};

/** "feat: save cart for signed-out users (SHOP-155)": a conventional commit naming the card. */
export function commitMessage(c: Pick<Card, 'key' | 'title'>): string {
  return `feat: ${lcFirst(c.title.trim())} (${c.key})`;
}

/** The PR's title: the ticket's key and title, or the card's title when it has no ticket. */
export function prTitle(c: Pick<Card, 'key' | 'title' | 'ticket'>): string {
  return c.ticket ? `${c.key}: ${c.title}` : c.title;
}

/**
 * The PR's body, written from the ticket: what it is for, what Claude said it did, the acceptance
 * criteria as a checklist for the reviewer, the files, whether it was tried, and the ticket.
 */
export function prBody(c: Pick<Card, 'key' | 'title' | 'ticket' | 'packet' | 'live'>, files: string[], tried?: string): string {
  const L: string[] = [];
  const why = c.ticket?.description ? firstPara(c.ticket.description, 800) : c.title;
  L.push(why);
  const said = c.live?.lastMessage ? firstPara(c.live.lastMessage, 800) : '';
  if (said) L.push('', `**What changed** (from Claude): ${said}`);
  const ac = c.packet.ticket.filter((i) => i.kind === 'ac' && i.on);
  if (ac.length) L.push('', '## Done when', ...ac.map((i) => `- [ ] ${i.label}`));
  if (files.length) {
    L.push('', '## Files');
    for (const f of files.slice(0, 30)) L.push(`- \`${f}\``);
    if (files.length > 30) L.push(`- …and ${files.length - 30} more`);
  }
  L.push('', tried ? `Tried locally: \`${tried}\`.` : 'Not tried locally yet.');
  if (c.ticket) L.push('', c.ticket.url ? `Ticket: [${c.key}](${c.ticket.url})` : `Ticket: ${c.key}${c.ticket.demo ? ' (a demo ticket)' : ''}`);
  L.push('', '_Opened from the Ticket Line in cc-control._');
  return L.join('\n');
}

/**
 * The line a PR gets when the card ships several repos: the others, linked once their PR exists
 * (the ones opened before it), named otherwise. Added under the body the sheet showed.
 */
export function partOf(key: string, others: { repo: string; url?: string }[]): string {
  if (!others.length) return '';
  return `Part of ${key} with ${others.map((o) => (o.url ? `[${o.repo}](${o.url})` : `${o.repo} (its PR opens with this one)`)).join(', ')}.`;
}

/** "PR #12 · approved · checks passing": one line for the tile and the drawer. */
export function prLine(pr: PullRequest): string {
  const parts = [`PR #${pr.number}`];
  if (pr.state === 'MERGED') parts.push('merged');
  else if (pr.state === 'CLOSED') parts.push('closed');
  else {
    if (pr.review === 'APPROVED') parts.push('approved');
    else if (pr.review === 'CHANGES_REQUESTED') parts.push('changes asked for');
    else parts.push('waiting for review');
    if (pr.checks === 'pass') parts.push('checks passing');
    else if (pr.checks === 'fail') parts.push('checks failing');
    else if (pr.checks === 'pending') parts.push('checks running');
  }
  return parts.join(' · ');
}
