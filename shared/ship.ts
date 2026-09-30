// Ship: commit a card's work, push its branch and open a pull request written from its ticket.
// The words (commit message, PR title and body) are pure and shared, so the sheet shows exactly
// what the server will send; server/ship.ts runs git and gh.

import type { Card } from './cards.ts';

/** The pull request a card opened, as last seen through gh. */
export interface PullRequest {
  number: number;
  url: string;
  state?: 'OPEN' | 'MERGED' | 'CLOSED';
  /** gh's reviewDecision: APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or empty. */
  review?: string;
  checks?: 'pass' | 'fail' | 'pending' | 'none';
  checkedAt?: number;
}

/** A changed file in the card's repo, relative to its root. `mine`: the card's session wrote it. */
export interface ShipFile {
  path: string;
  /** git's two-letter status: " M", "??", "A ", "D "… */
  status: string;
  mine: boolean;
}

/** What shipping a card will do, worked out by the server when the sheet opens. */
export interface ShipPlan {
  cardId: string;
  /** The repo it ships from (the card's folder) and its root. */
  root: string;
  /** The branch it is on, and the new branch it will make first when that is the default branch. */
  branch: string;
  newBranch?: string;
  /** The branch the PR goes into. */
  base: string;
  files: ShipFile[];
  /** Commits already on the branch that the base doesn't have. */
  ahead: number;
  commit: string;
  title: string;
  body: string;
  /** Problems that will stop it, found up front (no remote, gh missing…). */
  blockers: string[];
  /** Worth knowing, but not in the way. */
  notes: string[];
}

/** What the sheet sends back: the words as edited, and the files to commit. */
export interface ShipRequest {
  commit: string;
  title: string;
  body: string;
  paths: string[];
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
