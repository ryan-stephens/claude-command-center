// The Launchpad's ticket picker, from Jira: the tickets assigned to you that are still workable
// (not done, not in a status past the work), kept for a minute; and a search of the rest of Jira by
// key or words. A machine without Jira gets the demo set, so the picker can be tried anywhere.

import type { Ticket } from '../../shared/tickets.ts';
import { demoOthers, demoTickets, fetchJira, jiraConfig, searchJql, ticketMatches, type JiraConfig } from '../../server/tickets.ts';
import { skipStatuses, workable } from '../shared/tickets.ts';
import type { TicketPick, TicketPicks } from '../shared/types.ts';

const MINE_JQL = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';
const KEEP_MS = 60_000;

const pickOf = (t: Ticket, mine: boolean): TicketPick => ({ key: t.key, title: t.title, status: t.status, ...(t.url ? { url: t.url } : {}), updatedAt: t.updatedAt, mine });

export class MyTickets {
  private env: NodeJS.ProcessEnv;
  private kept: { at: number; picks: TicketPick[] } | undefined;
  private asking: Promise<TicketPick[]> | undefined;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
  }

  /** Your tickets and, with text, what Jira finds for it. A Jira that can't be reached is said, not thrown. */
  async picks(q: string, fresh = false): Promise<TicketPicks> {
    let c: JiraConfig | undefined;
    try { c = jiraConfig(this.env); } catch (e) { return { mine: [], found: [], source: 'jira', problem: (e as Error).message }; }
    const skip = skipStatuses(this.env.CCV2_JIRA_SKIP);
    if (!c) {
      const mine = demoTickets().filter((t) => t.source === 'jira' && !t.assignee && workable(t, skip)).map((t) => pickOf(t, true));
      const found = q.trim().length >= 2 ? [...demoTickets(), ...demoOthers()].filter((t) => !mine.some((m) => m.key === t.key) && ticketMatches(t, q)).map((t) => pickOf(t, false)) : [];
      return { mine, found, source: 'demo' };
    }
    let problem: string | undefined;
    const mine = await this.mine(c, skip, fresh).catch((e: Error) => { problem = e.message; return [] as TicketPick[]; });
    const jql = searchJql(q);
    let found: TicketPick[] = [];
    if (jql) {
      try {
        found = (await fetchJira(c, jql, 20)).filter((t) => !mine.some((m) => m.key === t.key)).map((t) => pickOf(t, false));
      } catch (e) {
        // A key that doesn't exist is a 400 from Jira: nothing found, not a failure.
        if (!/Jira said 400/.test((e as Error).message) || !/^key =/.test(jql)) problem ??= (e as Error).message;
      }
    }
    return { mine, found, source: 'jira', ...(problem ? { problem } : {}) };
  }

  /** Assigned to you, not done, not skipped; asked of Jira at most once a minute unless fresh. */
  private async mine(c: JiraConfig, skip: string[], fresh: boolean): Promise<TicketPick[]> {
    if (!fresh && this.kept && Date.now() - this.kept.at < KEEP_MS) return this.kept.picks;
    this.asking ??= fetchJira(c, MINE_JQL, 100)
      .then((list) => {
        const picks = list.filter((t) => workable(t, skip)).map((t) => pickOf(t, true));
        this.kept = { at: Date.now(), picks };
        return picks;
      })
      .finally(() => { this.asking = undefined; });
    return this.asking;
  }
}
