// The Launchpad's pure half: a session's key and branch, which repos and APIs the work suggests,
// the first message, and the context pack Claude reads from the worktree (CLAUDE.local.md).

import { branchFor } from '../../shared/cards.ts';
import { namesApi, type Stack } from '../../shared/stack.ts';
import type { TicketInfo } from './types.ts';

/** A key for a session without a ticket: the ask's first words, as a slug ("tidy-loan-page"). */
export function keyFor(text: string): string {
  const words = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 4);
  return (words.join('-') || 'session').slice(0, 32).replace(/-$/, '');
}

/** The session's title: the ticket's, else the ask's first line, cut at a word near 80 characters. */
export function titleFor(ticket: TicketInfo | undefined, text: string): string {
  if (ticket) return ticket.title;
  const line = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? '';
  if (line.length <= 80) return line;
  const cut = line.slice(0, 80);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : 80)}…`;
}

/** The branch: the ticket key and the title's first words (shop-160-waive-late-fee). */
export function branchOf(key: string, title: string): string {
  return key.includes('-') && /^[A-Za-z][\w]*-\d+$/.test(key) ? branchFor(key, title) : `cc/${key}`.slice(0, 60);
}

/** What Claude is told first. */
export function firstMessageFor(ticket: TicketInfo | undefined, text: string): string {
  if (ticket) return `Read CLAUDE.local.md (the context pack), then plan ${ticket.key}. Stop for my OK before editing.`;
  const ask = text.trim();
  return ask ? `${ask}\n\n(CLAUDE.local.md has this session's context and tools.)` : '';
}

/** Words the work is about: the ticket's title, description and criteria, or the ask. */
export function workText(ticket: TicketInfo | undefined, text: string): string {
  return [ticket?.title, ticket?.description, ...(ticket?.acceptance ?? []), text].filter(Boolean).join('\n');
}

/**
 * Which repos to tick: the stack's UI and the APIs the work names, and the workspace's home; the
 * rest of the workspace's repos are offered unticked. Paths in the workspace's order.
 */
export function suggestRepos(repos: string[], home: string | undefined, stack: Stack | undefined, text: string): { path: string; name: string; on: boolean; why: string }[] {
  const nameOf = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
  return repos.map((path) => {
    const name = nameOf(path);
    const lower = name.toLowerCase();
    const api = stack?.apis.find((a) => a.repo.toLowerCase() === lower);
    if (api && namesApi(text, api)) return { path, name, on: true, why: 'named in the ticket' };
    if (stack?.ui && stack.ui.repo.toLowerCase() === lower) return { path, name, on: true, why: 'the stack’s UI' };
    if (home && nameOf(home).toLowerCase() === lower) return { path, name, on: true, why: 'the workspace’s home' };
    if (text && new RegExp(`\\b${lower.replace(/[^a-z0-9]+/g, '[-_ ]?')}\\b`, 'i').test(text)) return { path, name, on: true, why: 'named in the ticket' };
    return { path, name, on: false, why: api ? 'an API in the stack' : 'in the workspace' };
  });
}

/** Which of the stack's APIs to run: the ones whose repos are ticked (those are what the session changes). */
export function suggestApis(stack: Stack | undefined, ticked: string[]): { name: string; on: boolean; why: string }[] {
  const names = ticked.map((n) => n.toLowerCase());
  return (stack?.apis ?? []).map((a) => names.includes(a.repo.toLowerCase())
    ? { name: a.repo, on: true, why: 'in this session: runs from its worktree' }
    : { name: a.repo, on: false, why: 'from Dev unless you add it' });
}

export interface PackInput {
  key: string;
  title: string;
  ticket?: TicketInfo;
  repos: { name: string; dir: string }[];
  branch: string;
  logsDir: string;
  notes?: string;
  apis: string[];
  tools: { loans: boolean; fields: boolean; updates?: boolean; fieldLists: string[] };
}

/** The context pack: what Claude reads first, written to the home worktree as CLAUDE.local.md. */
export function contextPack(p: PackInput): string {
  const lines: string[] = [`# ${p.key} · ${p.title}`, '', 'This is a Command Center session. Everything below was set up for this piece of work.', ''];
  if (p.ticket) {
    lines.push('## The ticket', '', `${p.ticket.key}: ${p.ticket.title}${p.ticket.url ? ` (${p.ticket.url})` : ''}`, '');
    if (p.ticket.description.trim()) lines.push(p.ticket.description.trim(), '');
    if (p.ticket.acceptance.length) lines.push('### Acceptance criteria', '', ...p.ticket.acceptance.map((a) => `- ${a}`), '');
    if (p.ticket.links.length) lines.push('### Linked', '', ...p.ticket.links.map((l) => `- ${l}`), '');
  }
  lines.push('## Repos', '', `Every repo is a worktree on the branch \`${p.branch}\`:`, '', ...p.repos.map((r) => `- ${r.name}: \`${r.dir}\``), '');
  if (p.notes?.trim()) lines.push('## Team notes', '', p.notes.trim(), '');
  lines.push('## The stack', '');
  lines.push(p.apis.length
    ? `The UI runs against these APIs from this session: ${p.apis.join(', ')}. Every other API comes from Dev through the UI's proxy file.`
    : 'No APIs run locally yet: the UI talks to Dev. Add one with stack_add_api when you change it.');
  lines.push(`Each service writes its output to \`${p.logsDir}\` (one file per service): read it when something fails.`, '');
  lines.push('## Tools (the command-center MCP server)', '');
  lines.push('- `session_info`: this session, its repos and branch.');
  lines.push('- `stack_status`, `stack_up`, `stack_add_api`, `stack_restart`, `stack_logs`: bring up and check the UI and APIs for this worktree. Adding an API rebuilds the UI\'s proxy file and restarts the UI.');
  if (p.tools.loans) lines.push('- `test_data_tool`, `list_loan_scenarios`, `make_test_loan`: the test-data tool. Start it with `test_data_tool` (start) when it isn’t running; make a loan in Dev or UAT from a saved scenario (never Prod).');
  if (p.tools.fields) lines.push(`- \`lookup_fields\`: read a loan's fields through the record lookup (\`details\` for read-only marks and options; \`expect\` to compare).${p.tools.fieldLists.length ? ` Saved field lists: ${p.tools.fieldLists.join(', ')}.` : ''}`);
  if (p.tools.fields) lines.push(p.tools.updates ? '- `update_fields`: change a loan’s fields through the record lookup and wait until the change shows.' : '- `update_fields`: off on this machine (the record lookup only reads here).');
  if (p.tools.fields) lines.push('- `fields_to_check`, `set_fields_to_check`: the fields worth checking for this work (yours, the ticket’s, the ones in your changes) and the loans made; pick the ones that prove the change, with why and the value each should have.');
  if (p.tools.loans || p.tools.fields) lines.push('- `data_status`: a loan still being made, or any lookup or change, by id.', '', 'Everything you do with these shows on the session’s Data panel in Command Center, so the user sees the loans, the fields and their values as you work. Work out which fields and values prove the change from the ticket’s criteria and your changes, pick them with `set_fields_to_check`, and keep them current as the work moves.');
  lines.push('- `add_evidence`: record what proves the change works (tests run, what you checked).');
  lines.push('- `ship`: push the branch, open the PRs with the evidence, and post the review request. Commit first; ask the user before shipping.');
  lines.push('', 'Prove the change end to end before handing it over: bring the stack up, make a test loan, set up and check its fields, then tell the user what to try.');
  return `${lines.join('\n')}\n`;
}
