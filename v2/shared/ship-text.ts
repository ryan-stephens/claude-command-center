// The Ship dock's words: the PR's title and body with the session's evidence, and the review
// request posted to the team's channel. Pure, so the page previews exactly what is sent.

import type { Evidence, Session, ShippedPr } from './types.ts';

/** "feat: SHOP-160 waive the late fee on a loan", or the plain title for a session without a ticket. */
export function defaultTitle(s: Pick<Session, 'key' | 'title' | 'ticket'>): string {
  const t = s.title.charAt(0).toLowerCase() + s.title.slice(1);
  return s.ticket ? `feat: ${s.ticket.key} ${t}` : `feat: ${t}`;
}

/** Every piece of evidence the session gathered: what it recorded, the loans it made and the field checks it ran. */
export function evidenceOf(s: Pick<Session, 'evidence' | 'loans' | 'fields'>): Evidence[] {
  const out: Evidence[] = [...s.evidence];
  for (const l of s.loans) out.push({ kind: 'loan', text: `Test loan ${l.loan} (${l.env === 'dev' ? 'Dev' : 'UAT'}) from "${l.scenario}"`, at: l.at, ok: true });
  for (const f of s.fields) {
    const name = f.list ? `"${f.list}"` : `${f.total} field${f.total === 1 ? '' : 's'}`;
    out.push({ kind: 'fields', text: `Field check ${name} on ${f.loan}: ${f.matched} of ${f.total} as expected${f.differs.length ? ` (differs: ${f.differs.slice(0, 3).map((d) => d.id).join(', ')})` : ''}`, at: f.at, ok: f.differs.length === 0 });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The PR's body: the ticket, a summary, the criteria, and the evidence. */
export function prBody(s: Pick<Session, 'key' | 'title' | 'ticket' | 'evidence' | 'loans' | 'fields'>, summary = '', others: { repo: string; url?: string }[] = []): string {
  const lines: string[] = [];
  if (s.ticket) lines.push(`**${s.ticket.key}**: ${s.ticket.title}${s.ticket.url ? ` (${s.ticket.url})` : ''}`, '');
  if (summary.trim()) lines.push(summary.trim(), '');
  if (s.ticket?.acceptance.length) lines.push('### Acceptance criteria', '', ...s.ticket.acceptance.map((a) => `- [ ] ${a}`), '');
  const ev = evidenceOf(s);
  if (ev.length) lines.push('### Evidence', '', ...ev.map((e) => `- ${e.ok ? '✅' : '⚠️'} ${e.text}`), '');
  if (others.length) lines.push('### Part of', '', ...others.map((o) => `- ${o.repo}${o.url ? `: ${o.url}` : ''}`), '');
  lines.push('_Shipped from Command Center._');
  return lines.join('\n');
}

/** The review request for the team's channel (Slack mrkdwn). */
export function slackText(s: Pick<Session, 'key' | 'title' | 'ticket' | 'evidence' | 'loans' | 'fields'>, prs: Pick<ShippedPr, 'repo' | 'number' | 'url'>[], mention = ''): string {
  const head = `${mention ? `${mention} ` : ''}*Review please: ${s.ticket ? `${s.ticket.key} ` : ''}${s.title}*`;
  const list = prs.length ? prs.map((p) => `<${p.url}|${p.repo} #${p.number}>`).join(' · ') : '(no PR links yet)';
  const ev = evidenceOf(s);
  const proof = ev.length ? `\n${ev.map((e) => `${e.ok ? '✓' : '!'} ${e.text}`).join('\n')}` : '';
  const ticket = s.ticket?.url ? `\nTicket: <${s.ticket.url}|${s.ticket.key}>` : '';
  return `${head}\n${list}${ticket}${proof}`;
}
