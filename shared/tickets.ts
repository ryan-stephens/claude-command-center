// Tickets from Jira and Trello, as the Ticket Line uses them: read-only, fetched by the server
// (which keeps the tokens), shown in the Inbox, and turned into the ticket layer of a card's packet.
// Pure and erasable TS, shared by the server and the page. Tested in tickets.test.ts.

import type { PacketItem } from './cards.ts';

export type TicketSource = 'jira' | 'trello';

export interface TicketComment {
  author: string;
  body: string;
  at: number;
}

export interface TicketLink {
  key: string;
  title: string;
  /** "blocks", "is blocked by", "relates to"… as the source words it. */
  relation: string;
}

export interface Ticket {
  /** SHOP-155 for Jira; for Trello, the board's short name and the card number, e.g. WEB-12. */
  key: string;
  source: TicketSource;
  /** Jira project key, or Trello board id: what maps to a workspace. */
  project: string;
  projectName: string;
  title: string;
  /** Plain text (Jira's rich text flattened). */
  description: string;
  /** "Done when": from an "Acceptance criteria" section (Jira) or a checklist (Trello). */
  acceptance: string[];
  comments: TicketComment[];
  attachments: { name: string; url?: string }[];
  links: TicketLink[];
  /** The status as the source names it ("To Do", "In Progress", a Trello list). */
  status: string;
  done: boolean;
  url?: string;
  updatedAt: number;
  /** A made-up ticket from the demo set, not a real one. */
  demo?: boolean;
  /** Hidden from the Inbox by you (Delete on it); Shift+T shows it again. Nothing changes in the tracker. */
  hidden?: boolean;
  /** Who it is assigned to, as the tracker names them. */
  assignee?: string;
  /** The Inbox views it came in through: assigned to you, and waiting for QA. Unset: yours. */
  views?: InboxView[];
  /** Found by a search on the new-card screen rather than fetched for the Inbox. */
  found?: boolean;
  /** The workspace its project maps to, filled in by the server. */
  workspaceId?: string | null;
}

export const SOURCE_NAME: Record<TicketSource, string> = { jira: 'Jira', trello: 'Trello' };

/**
 * What the Inbox shows (v switches): tickets assigned to you, or every ticket waiting for QA in
 * your projects, whoever built it. Tickets to review are found with the search on the new-card
 * screen instead, since boards rarely have a column for them.
 */
export type InboxView = 'mine' | 'qa';
export const INBOX_VIEWS: { id: InboxView; name: string }[] = [
  { id: 'mine', name: 'Mine' },
  { id: 'qa', name: 'Ready for QA' },
];

export function inView(t: Pick<Ticket, 'views'>, view: InboxView): boolean {
  return (t.views ?? ['mine']).includes(view);
}

/** A project (Jira) or board (Trello) the tickets came from, and the workspace it maps to. */
export interface TicketProject {
  id: string;
  name: string;
  source: TicketSource;
  count: number;
  workspaceId: string | null;
}

/** Where tickets come from: each source connected, not set up, or failing (with why). */
export interface TicketSources {
  jira: SourceState;
  trello: SourceState;
  demo: boolean;
  /** When they were last fetched. */
  at?: number;
}
export type SourceState = { state: 'off' } | { state: 'ok'; count: number } | { state: 'error'; message: string };

/** One line of a comment list, as Claude reads it. */
const commentLine = (c: TicketComment) => `- ${c.author}: ${c.body.replace(/\s+/g, ' ').trim()}`;

/**
 * The ticket layer of a new card's packet, as the mock draws it: the description and each
 * acceptance criterion on; comments and linked tickets there but off (they can be long, or
 * beside the point); attachments on, as their names.
 */
export function ticketItems(t: Ticket): PacketItem[] {
  const items: PacketItem[] = [];
  if (t.description.trim()) items.push({ kind: 'desc', id: 'desc', label: 'Description', text: t.description.trim(), on: true });
  t.acceptance.forEach((a, i) => items.push({ kind: 'ac', id: `ac${i}`, label: a, on: true }));
  if (t.comments.length) {
    const latest = t.comments[t.comments.length - 1].body.replace(/\s+/g, ' ').trim();
    items.push({
      kind: 'comments', id: 'comments', on: false,
      label: `Comments (${t.comments.length}), latest: “${latest.length > 60 ? `${latest.slice(0, 58)}…` : latest}”`,
      text: t.comments.map(commentLine).join('\n'),
    });
  }
  for (const a of t.attachments) items.push({ kind: 'attach', id: `attach:${a.name}`, label: `Attachment: ${a.name}`, text: a.url ? `${a.name} (${a.url})` : a.name, on: true });
  for (const l of t.links) items.push({ kind: 'linked', id: `link:${l.key}`, label: `Linked ticket: ${l.key} ${l.title}`, text: `${l.key} ${l.title} (${l.relation})`, on: false });
  return items;
}

/** Another ticket added to a card as extra context (the first one is the card's own ticket). */
export function relatedItem(t: Ticket): PacketItem {
  return { kind: 'ticket', id: `ticket:${t.key}`, label: `Related ticket: ${t.key} ${t.title}`, text: `${t.key} ${t.title}${t.description.trim() ? `\n${t.description.trim()}` : ''}`, on: true };
}

/** The ticket section of the packet text: what the SessionStart hook hands Claude. */
export function ticketText(t: Pick<Ticket, 'key' | 'source'>, items: PacketItem[]): string[] {
  const on = items.filter((i) => i.on);
  const L = ['', `## The ticket (${SOURCE_NAME[t.source]} ${t.key})`];
  const desc = on.find((i) => i.kind === 'desc');
  if (desc) L.push(desc.text ?? '');
  const ac = on.filter((i) => i.kind === 'ac');
  if (ac.length) L.push('', 'Done when:', ...ac.map((i) => `- ${i.label}`));
  const comments = on.find((i) => i.kind === 'comments');
  if (comments) L.push('', 'Comments:', comments.text ?? '');
  const attach = on.filter((i) => i.kind === 'attach');
  if (attach.length) L.push('', ...attach.map((i) => `Attachment: ${i.text ?? i.label}`));
  const links = on.filter((i) => i.kind === 'linked');
  if (links.length) L.push('', ...links.map((i) => `Linked ticket: ${i.text ?? i.label}`));
  return L;
}

/** "Jira · Storefront · To Do · Priya": the line under a ticket's title. */
export function ticketSub(t: Ticket): string {
  return `${SOURCE_NAME[t.source]} · ${t.projectName} · ${t.status}${t.assignee && !inView(t, 'mine') ? ` · ${t.assignee}` : ''}`;
}

/**
 * The Inbox: open tickets that no card has started yet, in the workspace shown (tickets whose
 * project isn't mapped show only under All), newest first.
 */
export function inbox(tickets: Ticket[], started: Set<string>, filter: 'all' | string, view: InboxView = 'mine'): Ticket[] {
  return tickets
    .filter((t) => !t.done && !t.hidden && !t.found && inView(t, view) && !started.has(t.key) && (filter === 'all' || t.workspaceId === filter))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
