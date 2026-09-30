// Tickets for the Ticket Line's Inbox: read-only, from Jira and Trello, with the tokens kept here
// on the server (environment variables; they never reach the page). Until the owner connects a
// real site, a demo set in the real shape stands in (the mock's tickets), switched on in the app.
//
// Jira Cloud: CC_CONTROL_JIRA_SITE (https://you.atlassian.net), CC_CONTROL_JIRA_EMAIL,
//   CC_CONTROL_JIRA_TOKEN (an API token).
// Jira Data Center / Server (any other site, or CC_CONTROL_JIRA_KIND=server): CC_CONTROL_JIRA_SITE
//   (https://jira.company.local, with any context path), CC_CONTROL_JIRA_TOKEN (a personal access
//   token, sent as Bearer); or CC_CONTROL_JIRA_EMAIL (the username) with a password in the token.
// Both: optional CC_CONTROL_JIRA_JQL, and CC_CONTROL_JIRA_AC_FIELD (customfield_12345) when the
//   acceptance criteria live in their own field rather than in the description.
// Trello: CC_CONTROL_TRELLO_KEY, CC_CONTROL_TRELLO_TOKEN, CC_CONTROL_TRELLO_BOARDS (board ids, commas).
//
// fromJira / fromTrello turn each API's JSON into a Ticket and are tested against recorded shapes;
// the HTTP calls themselves haven't met a live site yet (PLAN §31).

import type { Ticket, TicketComment, TicketLink, TicketProject, TicketSources, SourceState } from '../shared/tickets.ts';
import type { Store } from './store.ts';

// ---- Jira ---------------------------------------------------------------------------------------

/** A node of Atlassian Document Format, Jira Cloud's rich text (only what flattening needs). */
interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
}

/** One block of flattened ADF: a heading, a paragraph, or a list item, each as plain text. */
type Block = { kind: 'heading' | 'para' | 'item'; text: string };

function inline(n: AdfNode): string {
  switch (n.type) {
    case 'text': return n.text ?? '';
    case 'hardBreak': return '\n';
    case 'mention': return String(n.attrs?.text ?? '@someone');
    case 'emoji': return String(n.attrs?.text ?? n.attrs?.shortName ?? '');
    case 'inlineCard': return String(n.attrs?.url ?? '');
    case 'date': return n.attrs?.timestamp ? new Date(Number(n.attrs.timestamp)).toISOString().slice(0, 10) : '';
    default: return (n.content ?? []).map(inline).join('');
  }
}

function blocks(n: AdfNode | undefined, out: Block[] = []): Block[] {
  if (!n) return out;
  switch (n.type) {
    case 'heading': out.push({ kind: 'heading', text: inline(n).trim() }); break;
    case 'paragraph': { const t = inline(n).trim(); if (t) out.push({ kind: 'para', text: t }); break; }
    case 'codeBlock': out.push({ kind: 'para', text: inline(n) }); break;
    case 'listItem': case 'taskItem': {
      // A list item's own text, then any nested list as further items.
      const own = (n.content ?? []).filter((c) => c.type !== 'bulletList' && c.type !== 'orderedList' && c.type !== 'taskList');
      const text = n.type === 'taskItem' ? inline(n).trim() : own.map(inline).join(' ').trim();
      if (text) out.push({ kind: 'item', text });
      for (const c of n.content ?? []) if (c !== undefined && !own.includes(c)) blocks(c, out);
      break;
    }
    default: for (const c of n.content ?? []) blocks(c, out);
  }
  return out;
}

/** Jira's rich text as plain text: headings and paragraphs as lines, list items as "- …". */
export function adfText(doc: unknown): string {
  if (typeof doc === 'string') return doc; // Jira Server / API v2 sends plain text
  return blocks(doc as AdfNode).map((b) => (b.kind === 'item' ? `- ${b.text}` : b.text)).join('\n');
}

const AC_HEADING = /^(acceptance criteria|done when|definition of done)\b/i;
/** A list item: markdown (- * 1.), Jira wiki markup (* ** # ##), or a bullet. */
const ITEM = /^\s*([-•]|\*+|#+|\d+[.)])\s+/;
/** A heading or bold line's text: markdown (#), wiki (h3.), bold (*…*). */
const headingText = (l: string) => l.replace(/^\s*h[1-6]\.\s*/i, '').replace(/^[#*_\s]+/, '').replace(/[:*_\s]+$/, '').trim();

/**
 * Split a description into its text and its acceptance criteria: the list under a heading (or a
 * bold line) called "Acceptance criteria", "Done when" or "Definition of done". Jira has no
 * standard field for them, so this is the convention most teams use.
 */
export function splitAcceptance(doc: unknown): { description: string; acceptance: string[] } {
  if (typeof doc === 'string') {
    const lines = doc.split(/\r?\n/);
    const at = lines.findIndex((l) => AC_HEADING.test(headingText(l)));
    if (at < 0) return { description: doc.trim(), acceptance: [] };
    const rest = lines.slice(at + 1);
    const end = rest.findIndex((l) => l.trim() && !ITEM.test(l));
    const items = (end < 0 ? rest : rest.slice(0, end)).map((l) => l.replace(ITEM, '').trim()).filter(Boolean);
    return { description: [...lines.slice(0, at), ...(end < 0 ? [] : rest.slice(end))].join('\n').trim(), acceptance: items };
  }
  const all = blocks(doc as AdfNode);
  const at = all.findIndex((b) => (b.kind === 'heading' || b.kind === 'para') && AC_HEADING.test(b.text.replace(/[:*]+$/, '')));
  if (at < 0) return { description: adfText(doc), acceptance: [] };
  let end = at + 1;
  while (end < all.length && all[end].kind === 'item') end++;
  const keep = [...all.slice(0, at), ...all.slice(end)];
  return {
    description: keep.map((b) => (b.kind === 'item' ? `- ${b.text}` : b.text)).join('\n').trim(),
    acceptance: all.slice(at + 1, end).map((b) => b.text),
  };
}

interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    status?: { name?: string; statusCategory?: { key?: string } };
    project?: { key?: string; name?: string };
    updated?: string;
    comment?: { comments?: { author?: { displayName?: string }; body?: unknown; created?: string }[] };
    attachment?: { filename?: string; content?: string }[];
    issuelinks?: { type?: { inward?: string; outward?: string }; inwardIssue?: { key: string; fields?: { summary?: string } }; outwardIssue?: { key: string; fields?: { summary?: string } } }[];
  };
}

/** The acceptance criteria in their own field: a list, or text with one per line. */
function acceptanceField(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : (x as { value?: string })?.value ?? '')).map((x) => x.trim()).filter(Boolean);
  const text = adfText(v ?? '');
  return text.split(/\r?\n/).map((l) => l.replace(ITEM, '').trim()).filter(Boolean);
}

/** A Jira issue (Cloud API v3 or Data Center API v2) as a Ticket. `acField` names a custom field holding the acceptance criteria. */
export function fromJira(issue: JiraIssue, site?: string, acField?: string): Ticket {
  const f = issue.fields ?? {};
  const split = splitAcceptance(f.description ?? '');
  const own = acField ? acceptanceField((f as Record<string, unknown>)[acField]) : [];
  const { description, acceptance } = own.length ? { description: adfText(f.description ?? '').trim(), acceptance: own } : split;
  const comments: TicketComment[] = (f.comment?.comments ?? []).map((c) => ({
    author: c.author?.displayName ?? 'someone', body: adfText(c.body ?? '').trim(), at: Date.parse(c.created ?? '') || 0,
  })).filter((c) => c.body);
  const links: TicketLink[] = [];
  for (const l of f.issuelinks ?? []) {
    const other = l.outwardIssue ?? l.inwardIssue;
    if (other) links.push({ key: other.key, title: other.fields?.summary ?? '', relation: (l.outwardIssue ? l.type?.outward : l.type?.inward) ?? 'relates to' });
  }
  return {
    key: issue.key,
    source: 'jira',
    project: f.project?.key ?? issue.key.split('-')[0],
    projectName: f.project?.name ?? f.project?.key ?? issue.key.split('-')[0],
    title: f.summary ?? issue.key,
    description,
    acceptance,
    comments,
    attachments: (f.attachment ?? []).map((a) => ({ name: a.filename ?? 'file', ...(a.content ? { url: a.content } : {}) })),
    links,
    status: f.status?.name ?? '',
    done: f.status?.statusCategory?.key === 'done',
    ...(site ? { url: `${site.replace(/\/+$/, '')}/browse/${issue.key}` } : {}),
    updatedAt: Date.parse(f.updated ?? '') || 0,
  };
}

const JIRA_FIELDS = ['summary', 'description', 'status', 'project', 'updated', 'comment', 'attachment', 'issuelinks'];
const DEFAULT_JQL = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';

/** Jira settings from the environment, or why they aren't enough. */
export interface JiraConfig { site: string; kind: 'cloud' | 'server'; email?: string; token: string; jql: string; acField?: string }

export function jiraConfig(e: NodeJS.ProcessEnv): JiraConfig | undefined {
  const site = e.CC_CONTROL_JIRA_SITE?.trim().replace(/\/+$/, '');
  const token = e.CC_CONTROL_JIRA_TOKEN?.trim();
  if (!site || !token) return undefined;
  const kind = e.CC_CONTROL_JIRA_KIND === 'server' || e.CC_CONTROL_JIRA_KIND === 'cloud' ? e.CC_CONTROL_JIRA_KIND
    : /\.atlassian\.net$/i.test(new URL(site).hostname) ? 'cloud' : 'server';
  const email = e.CC_CONTROL_JIRA_EMAIL?.trim() || undefined;
  if (kind === 'cloud' && !email) return undefined;
  return { site, kind, ...(email ? { email } : {}), token, jql: e.CC_CONTROL_JIRA_JQL || DEFAULT_JQL, ...(e.CC_CONTROL_JIRA_AC_FIELD ? { acField: e.CC_CONTROL_JIRA_AC_FIELD.trim() } : {}) };
}

/** The search request: Cloud's /rest/api/3/search/jql with email + API token; Data Center's /rest/api/2/search with a PAT (Bearer) or username + password. */
export function jiraSearch(c: JiraConfig): { url: string; init: RequestInit } {
  const auth = c.kind === 'server' && !c.email ? `Bearer ${c.token}` : `Basic ${Buffer.from(`${c.email}:${c.token}`).toString('base64')}`;
  return {
    url: `${c.site}${c.kind === 'cloud' ? '/rest/api/3/search/jql' : '/rest/api/2/search'}`,
    init: {
      method: 'POST',
      headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql: c.jql, fields: [...JIRA_FIELDS, ...(c.acField ? [c.acField] : [])], maxResults: 50 }),
    },
  };
}

/** What a failed request means, in words. */
export function jiraProblem(status: number, c: JiraConfig): string {
  if (status === 401) return c.kind === 'cloud' ? 'check CC_CONTROL_JIRA_EMAIL and the API token' : 'check the personal access token (Profile → Personal Access Tokens in Jira)';
  if (status === 403) return 'the token can’t search (or CAPTCHA is on for the account: sign in once in the browser)';
  if (status === 404) return c.kind === 'server' ? 'check the site address, including any context path such as /jira' : 'check the site address';
  if (status === 400) return 'check CC_CONTROL_JIRA_JQL';
  return '';
}

export async function fetchJira(c: JiraConfig): Promise<Ticket[]> {
  const { url, init } = jiraSearch(c);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message;
    throw new Error(`Couldn't reach Jira at ${c.site} (${code})${/CERT|ISSUER|SELF_SIGNED/.test(code) ? ': the server’s certificate isn’t trusted; see CC_CONTROL_CA_FILE' : ''}`);
  }
  if (!res.ok) { const why = jiraProblem(res.status, c); throw new Error(`Jira said ${res.status} ${res.statusText}${why ? `: ${why}` : ''}`); }
  const body = await res.json() as { issues?: JiraIssue[] };
  return (body.issues ?? []).map((i) => fromJira(i, c.site, c.acField));
}

// ---- Trello -------------------------------------------------------------------------------------

interface TrelloCard {
  id: string;
  idShort: number;
  name: string;
  desc?: string;
  idList?: string;
  closed?: boolean;
  shortUrl?: string;
  dateLastActivity?: string;
  checklists?: { name?: string; checkItems?: { name?: string; pos?: number }[] }[];
  attachments?: { name?: string; url?: string }[];
  actions?: { type?: string; date?: string; memberCreator?: { fullName?: string }; data?: { text?: string } }[];
}
interface TrelloBoard { id: string; name: string; lists?: { id: string; name: string }[] }

/** "Storefront board" → "SB", "web" → "WEB": the prefix of a Trello card's key. */
export function boardPrefix(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'TR';
  return (words.length === 1 ? words[0].slice(0, 5) : words.map((w) => w[0]).join('').slice(0, 5));
}

/**
 * A Trello card as a Ticket. Its acceptance criteria are the checklist called "Acceptance
 * criteria" / "Done when", or else its first checklist; it is done when it sits in a list called
 * Done (or is archived).
 */
export function fromTrello(card: TrelloCard, board: TrelloBoard): Ticket {
  const list = board.lists?.find((l) => l.id === card.idList)?.name ?? '';
  const checklist = card.checklists?.find((c) => AC_HEADING.test(c.name ?? '')) ?? card.checklists?.[0];
  return {
    key: `${boardPrefix(board.name)}-${card.idShort}`,
    source: 'trello',
    project: board.id,
    projectName: board.name,
    title: card.name,
    description: (card.desc ?? '').trim(),
    acceptance: [...(checklist?.checkItems ?? [])].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)).map((i) => (i.name ?? '').trim()).filter(Boolean),
    comments: (card.actions ?? []).filter((a) => a.type === 'commentCard' && a.data?.text)
      .map((a) => ({ author: a.memberCreator?.fullName ?? 'someone', body: a.data!.text!.trim(), at: Date.parse(a.date ?? '') || 0 }))
      .sort((a, b) => a.at - b.at),
    attachments: (card.attachments ?? []).map((a) => ({ name: a.name ?? 'file', ...(a.url ? { url: a.url } : {}) })),
    links: [],
    status: list,
    done: Boolean(card.closed) || /^done\b/i.test(list),
    ...(card.shortUrl ? { url: card.shortUrl } : {}),
    updatedAt: Date.parse(card.dateLastActivity ?? '') || 0,
  };
}

async function fetchTrello(key: string, token: string, boards: string[]): Promise<Ticket[]> {
  const auth = `key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`https://api.trello.com/1/${path}${path.includes('?') ? '&' : '?'}${auth}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Trello said ${res.status} ${res.statusText}${res.status === 401 ? ': check the key and token' : ''}`);
    return res.json() as Promise<T>;
  };
  const out: Ticket[] = [];
  for (const id of boards) {
    const board = await get<TrelloBoard>(`boards/${encodeURIComponent(id)}?fields=name&lists=open&list_fields=name`);
    const cards = await get<TrelloCard[]>(`boards/${encodeURIComponent(id)}/cards?fields=name,desc,idShort,idList,closed,shortUrl,dateLastActivity&checklists=all&attachments=true&attachment_fields=name,url&actions=commentCard`);
    out.push(...cards.map((c) => fromTrello(c, board)));
  }
  return out;
}

// ---- Demo tickets: the mock's, in the real shape --------------------------------------------------

const DAY = 86_400_000;

/** Made-up tickets (docs/futures/path-line.html) for trying the Inbox before a real site is connected. */
export function demoTickets(now = Date.now()): Ticket[] {
  const t = (x: Partial<Ticket> & Pick<Ticket, 'key' | 'title' | 'description'>): Ticket => ({
    source: 'jira', project: x.key.split('-')[0], projectName: '', acceptance: [], comments: [], attachments: [], links: [],
    status: 'To Do', done: false, updatedAt: now, demo: true, ...x,
  });
  const shop = { project: 'SHOP', projectName: 'Storefront' };
  const pay = { project: 'PAY', projectName: 'Payments' };
  return [
    t({ ...shop, key: 'SHOP-155', title: 'Save cart for signed-out users', updatedAt: now - 2 * 3600_000,
      description: 'Guests lose their cart when they close the tab. Keep it for 30 days and merge it when they sign in.',
      acceptance: ['The cart survives closing the tab', 'It merges on sign-in without duplicates', 'Gift cards in the cart still apply'],
      comments: [{ author: 'Priya', body: 'Keep the 30 days configurable', at: now - DAY }, { author: 'Sam', body: 'Check the cookie banner covers local storage', at: now - 3600_000 }],
      attachments: [{ name: 'cart-merge-flow.png' }], links: [{ key: 'SHOP-98', title: 'Guest checkout', relation: 'relates to' }] }),
    t({ ...pay, key: 'PAY-91', title: 'Show refund status to support staff', updatedAt: now - DAY,
      description: 'Support can’t tell whether a refund went through. Show its status on the order page in the admin.',
      acceptance: ['Status shows pending, sent or failed', 'It updates when the webhook arrives'],
      comments: [{ author: 'Dana', body: 'Support wants it on the order list too', at: now - DAY }] }),
    t({ ...shop, key: 'SHOP-160', title: 'Cart badge shows the wrong count after sign-in', updatedAt: now - 3 * DAY,
      description: 'After signing in, the cart badge shows the guest count until you reload.', acceptance: ['The badge updates without a reload'] }),
    t({ ...pay, key: 'PAY-77', title: 'Refunds over $500 need a second approver', updatedAt: now - 5 * DAY,
      description: 'Large refunds need a second person to approve them in the admin.', acceptance: ['Refunds over $500 wait for a second approver'] }),
    t({ project: 'DOCS', projectName: 'Docs & site', key: 'DOCS-19', title: 'Document the refunds endpoint', status: 'In Progress', updatedAt: now - 4 * 3600_000,
      description: 'The refunds endpoint has no reference page. Partners keep asking support how partial refunds work.',
      acceptance: ['A reference page with every field', 'A partial refund example', 'Linked from the API index'] }),
    t({ ...shop, key: 'SHOP-98', title: 'Guest checkout', status: 'Done', done: true, updatedAt: now - 90 * DAY,
      description: 'Let people check out without an account.', acceptance: ['Guests can pay without signing up'] }),
    t({ source: 'trello', project: 'demo-trello-web', projectName: 'Web board', key: 'WB-12', title: 'Footer links 404 on /about', status: 'Doing', updatedAt: now - 6 * 3600_000,
      description: 'Three footer links on /about point to old paths.', acceptance: ['Every footer link returns 200'] }),
  ];
}

// ---- The service ---------------------------------------------------------------------------------

const REFRESH_MS = 5 * 60_000;

export class TicketService {
  private store: Store;
  private changed: () => void;
  private env: NodeJS.ProcessEnv;
  private real: Ticket[] = [];
  private jira: SourceState = { state: 'off' };
  private trello: SourceState = { state: 'off' };
  private at: number | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(store: Store, changed: () => void, env: NodeJS.ProcessEnv = process.env) {
    this.store = store;
    this.changed = changed;
    this.env = env;
  }

  /** Fetch now and every few minutes while something is connected. */
  start(): void {
    void this.refresh();
    this.timer = setInterval(() => { if (this.connected()) void this.refresh(); }, REFRESH_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private connected(): boolean {
    return Boolean(this.env.CC_CONTROL_JIRA_TOKEN || this.env.CC_CONTROL_TRELLO_TOKEN);
  }

  async refresh(): Promise<void> {
    const e = this.env;
    const got: Ticket[] = [];
    const run = async (ready: boolean, load: () => Promise<Ticket[]>): Promise<SourceState> => {
      if (!ready) return { state: 'off' };
      try {
        const list = await load();
        got.push(...list);
        return { state: 'ok', count: list.length };
      } catch (err) {
        return { state: 'error', message: (err as Error).message };
      }
    };
    [this.jira, this.trello] = await Promise.all([
      run(Boolean(jiraConfig(e)), () => fetchJira(jiraConfig(e)!)),
      run(Boolean(e.CC_CONTROL_TRELLO_KEY && e.CC_CONTROL_TRELLO_TOKEN && e.CC_CONTROL_TRELLO_BOARDS),
        () => fetchTrello(e.CC_CONTROL_TRELLO_KEY!, e.CC_CONTROL_TRELLO_TOKEN!, e.CC_CONTROL_TRELLO_BOARDS!.split(',').map((s) => s.trim()).filter(Boolean))),
    ]);
    this.real = got;
    this.at = Date.now();
    this.changed();
  }

  demoOn(): boolean {
    return this.store.getMeta('tickets.demo') === '1';
  }

  setDemo(on: boolean): void {
    this.store.setMeta('tickets.demo', on ? '1' : '0');
    this.changed();
  }

  /** Which workspace each project (Jira key or Trello board id) goes to. */
  mapping(): Record<string, string> {
    try { return JSON.parse(this.store.getMeta('tickets.map') ?? '{}') as Record<string, string>; } catch { return {}; }
  }

  setMapping(project: string, workspaceId: string | null): void {
    const m = this.mapping();
    if (workspaceId) m[project] = workspaceId;
    else delete m[project];
    this.store.setMeta('tickets.map', JSON.stringify(m));
    this.changed();
  }

  /** Every ticket, with the workspace its project maps to (a mapped workspace that is gone counts as none). */
  list(workspaceIds: string[]): Ticket[] {
    const m = this.mapping();
    const hidden = this.hiddenKeys();
    const all = [...this.real, ...(this.demoOn() ? demoTickets() : [])];
    return all.map((t) => ({ ...t, workspaceId: m[t.project] && workspaceIds.includes(m[t.project]) ? m[t.project] : null, ...(hidden[t.key] ? { hidden: true } : {}) }));
  }

  /** Tickets hidden from the Inbox, with when: kept on the server so they stay hidden across restarts and browsers. */
  hiddenKeys(): Record<string, number> {
    try { return JSON.parse(this.store.getMeta('tickets.hidden') ?? '{}') as Record<string, number>; } catch { return {}; }
  }

  /** Hide a ticket from the Inbox, or show it again. Nothing is written to Jira or Trello. */
  setHidden(key: string, hidden: boolean): void {
    const h = this.hiddenKeys();
    if (hidden) h[key] = Date.now();
    else delete h[key];
    this.store.setMeta('tickets.hidden', JSON.stringify(h));
    this.changed();
  }

  get(key: string, workspaceIds: string[]): Ticket | undefined {
    return this.list(workspaceIds).find((t) => t.key === key);
  }

  projects(workspaceIds: string[]): TicketProject[] {
    const by = new Map<string, TicketProject>();
    for (const t of this.list(workspaceIds)) {
      const p = by.get(t.project) ?? { id: t.project, name: t.projectName, source: t.source, count: 0, workspaceId: t.workspaceId ?? null };
      p.count += 1;
      by.set(t.project, p);
    }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  sources(): TicketSources {
    return { jira: this.jira, trello: this.trello, demo: this.demoOn(), ...(this.at ? { at: this.at } : {}) };
  }
}
