// Saved opening prompts (PLAN §62): a prompt is a template with {{placeholders}} that the new-card
// screen fills from the card as it stands (its ticket, repos, folders, workspace, branch, kind), so the
// first thing Claude is told names the context it was given. Pure: the page renders, the server
// stores, and both share the placeholder list and the three defaults the store is seeded with.

import type { CardKind } from './cards.ts';

/** A prompt as the server keeps it (SQLite, like settings and workspaces). A kind puts it first for cards of that kind. */
export interface SavedPrompt {
  id: string;
  name: string;
  body: string;
  kind?: CardKind;
  /** Epoch ms of the last save (no history yet: versioning is after the MVP). */
  updatedAt: number;
}

export interface PromptTicket { key: string; title: string }

/** What the composer knows that a prompt can name. Everything optional: an unfilled placeholder renders to nothing. */
export interface PromptContext {
  /** The card's own ticket. */
  ticket?: PromptTicket | null;
  /** The card's ticket, then the related ones. */
  tickets?: PromptTicket[];
  /** The repos Claude can see, by name, the one it starts in first. */
  repos?: string[];
  /** The repo it starts in. */
  home?: string;
  /** Folders from disk, as paths. */
  folders?: string[];
  lane?: string;
  /** The card's branch name. */
  branch?: string;
  /** Develop, QA or Code review. */
  kind?: string;
}

export const PLACEHOLDERS: { name: string; what: string }[] = [
  { name: 'ticket', what: 'the card’s ticket: key and title' },
  { name: 'tickets', what: 'the card’s ticket and its related ones, as a list' },
  { name: 'repos', what: 'the repos Claude can see, by name, the one it starts in first' },
  { name: 'home', what: 'the repo it starts in' },
  { name: 'folders', what: 'folders added from disk' },
  { name: 'workspace', what: 'the workspace’s name' },
  { name: 'branch', what: 'the card’s branch name' },
  { name: 'kind', what: 'Develop, QA or Code review' },
];

const ticketText = (t: PromptTicket) => (t.title.trim() ? `${t.key} (${t.title.trim()})` : t.key);

/** Each placeholder's text for this card; '' where the card has nothing for it. */
export function fillers(ctx: PromptContext): Record<string, string> {
  // The order matters to unrenderPrompt: among values of one length, the earlier name wins (the list over the one).
  return {
    tickets: (ctx.tickets ?? (ctx.ticket ? [ctx.ticket] : [])).map(ticketText).join(', '),
    ticket: ctx.ticket ? ticketText(ctx.ticket) : '',
    repos: (ctx.repos ?? []).join(', '),
    home: ctx.home ?? '',
    folders: (ctx.folders ?? []).join(', '),
    workspace: ctx.lane ?? '',
    // The name it had before workspaces were called that (§126): prompts saved with {{lane}} still fill.
    lane: ctx.lane ?? '',
    branch: ctx.branch ?? '',
    kind: ctx.kind ?? '',
  };
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** The placeholder names a template uses, in order, once each (unknown ones included, so the editor can say so). */
export function placeholdersIn(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) { const n = m[1].toLowerCase(); if (!out.includes(n)) out.push(n); }
  return out;
}

export interface Rendered {
  text: string;
  /** Placeholders the card had nothing for (rendered to nothing). */
  missing: string[];
  /** Names that aren't placeholders (rendered to nothing too). */
  unknown: string[];
}

/** Spaces a removed placeholder left behind: doubled spaces, a space before punctuation, empty brackets. */
function tidyLine(line: string): string {
  return line
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([,.;:!?)])/g, '$1')
    .replace(/\( /g, '(')
    .replace(/(^|[^,]),(\s*,)+/g, '$1,')
    .replace(/^[\s,;]+/, '')
    .trim();
}

/**
 * Fill a template from the card. A line whose placeholders all came out empty is left out
 * entirely (so "Extracted business logic is in {{folders}}." disappears from a card with no
 * folders), and three or more blank lines in a row become one.
 */
export function renderPrompt(template: string, ctx: PromptContext): Rendered {
  const f = fillers(ctx);
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const lines = template.replace(/\r\n/g, '\n').split('\n').map((line) => {
    let had = 0; let filled = 0;
    const out = line.replace(PLACEHOLDER, (_, raw: string) => {
      const name = raw.toLowerCase();
      had += 1;
      if (!(name in f)) { unknown.add(name); return ''; }
      const v = f[name];
      if (!v) { missing.add(name); return ''; }
      filled += 1;
      return v;
    });
    return had && !filled ? null : tidyLine(out);
  });
  const text = lines.filter((l): l is string => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, missing: [...missing], unknown: [...unknown] };
}

/**
 * The reverse, for "Save as a prompt": what the card filled in goes back to its placeholder
 * (longest values first, so a repo named inside the repo list becomes part of {{repos}}), making
 * the saved prompt reusable on the next card. Values under three characters are left alone.
 */
export function unrenderPrompt(text: string, ctx: PromptContext): string {
  const f = fillers(ctx);
  const pairs = Object.entries(f).filter(([, v]) => v.length >= 3).sort((a, b) => b[1].length - a[1].length);
  let out = text;
  for (const [name, v] of pairs) out = out.split(v).join(`{{${name}}}`);
  return out;
}

/** The prompts offered for a card: the ones for its kind first, then the ones for any kind, then the rest; each group by name. */
export function promptsFor(prompts: SavedPrompt[], kind: CardKind): SavedPrompt[] {
  const rank = (p: SavedPrompt) => (p.kind === kind ? 0 : !p.kind ? 1 : 2);
  return [...prompts].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The three the store starts with, editable like any other. Each says the worktree is already made: the card makes it. A blank line between the parts (what to do, where to look, the constraint, how to start), so the message reads in sections (§69). */
export const DEFAULT_PROMPTS: Omit<SavedPrompt, 'id' | 'updatedAt'>[] = [
  {
    name: 'Review and plan',
    kind: 'build',
    body: [
      'Please review {{tickets}} and take them into context.',
      'You’ll likely need these repos: {{repos}}. Start in {{home}}.',
      'Extracted business logic and other material is in {{folders}}.',
      'This card already made a worktree of each repo on branch {{branch}}, and you are in it: don’t create branches or worktrees yourself.',
      'Before changing anything, read the relevant code, then write a short plan: the changes, the files they touch, and what you’ll test. Wait for my approval.',
    ].join('\n\n'),
  },
  {
    name: 'Fix a bug',
    kind: 'build',
    body: [
      '{{tickets}} describes a bug. Reproduce it first.',
      'The code is in {{repos}}; start in {{home}}.',
      'Related material is in {{folders}}.',
      'You’re in a worktree this card made on branch {{branch}}: don’t create branches or worktrees yourself.',
      'Find the cause before changing anything and explain it in a few lines. Then propose the smallest fix and a test that would have caught it, and wait for my approval before editing.',
    ].join('\n\n'),
  },
  {
    name: 'QA this change',
    kind: 'qa',
    body: [
      'QA {{tickets}}: test the change against its acceptance criteria.',
      'The code is in {{repos}}; start in {{home}}.',
      'Test notes and data are in {{folders}}.',
      'Start with a test plan: what to check, how, and what data it needs. Then run it and report what passed, what failed, and anything that looks wrong beyond the ticket.',
      'Don’t create branches or worktrees: this card has already set up where you work.',
    ].join('\n\n'),
  },
];
