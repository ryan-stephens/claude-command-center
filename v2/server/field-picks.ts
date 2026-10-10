// The fields worth checking in a session (§142), for Claude and for the Data panel's lookup alike:
//   picked     by Claude (set_fields_to_check) or you, each with why and the value it should have
//   ticket     field ids the ticket's text names (v1's idsInText: dotted ids, "field 1000")
//   changes    field ids in the lines the session's worktrees added since they branched (and not yet
//              committed), so a field the code now reads or writes is offered without anyone typing it
// Picked first, then the ticket's, then the changes'; each id once.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { run as sh } from '../../server/hosts.ts';
import { idsInText } from '../../shared/verify.ts';
import type { FieldPick, Session } from '../shared/types.ts';

export const MAX_PICKS = 60;
const DIFF_MAX = 2_000_000;
const KEEP_MS = 30_000;

/** The added lines of a unified diff (not the +++ headers). */
export function addedLines(diff: string): string {
  return diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n');
}

/** Merge picks: each id once (any case), the first kept, later ones filling in why and expect it lacked. */
export function mergePicks(...lists: FieldPick[][]): FieldPick[] {
  const out: FieldPick[] = [];
  for (const list of lists) {
    for (const p of list) {
      const id = p.id.trim();
      if (!id) continue;
      const had = out.find((x) => x.id.toLowerCase() === id.toLowerCase());
      if (had) { if (!had.why && p.why) had.why = p.why; if (had.expect === undefined && p.expect !== undefined) had.expect = p.expect; continue; }
      out.push({ ...p, id });
    }
  }
  return out.slice(0, MAX_PICKS);
}

/** Picks as Claude or you send them: an id, and maybe why and the value it should have. */
export function cleanPicks(v: unknown, from: 'claude' | 'you'): FieldPick[] {
  if (!Array.isArray(v)) throw new Error('Give fields: a list of { id, why, expect }.');
  return v.flatMap((x): FieldPick[] => {
    const o = (typeof x === 'string' ? { id: x } : x) as Record<string, unknown>;
    const id = String(o?.id ?? '').trim().slice(0, 120);
    if (!id) return [];
    const why = typeof o.why === 'string' && o.why.trim() ? o.why.trim().slice(0, 200) : undefined;
    const expect = o.expect === undefined || o.expect === null ? undefined : String(o.expect).slice(0, 200);
    return [{ id, from, ...(why ? { why } : {}), ...(expect !== undefined ? { expect } : {}) }];
  }).slice(0, MAX_PICKS);
}

/** Field ids in what a worktree added: since it branched from its main line, committed or not. */
async function idsInWorktree(dir: string): Promise<string[]> {
  let base = '';
  for (const ref of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
    const r = await sh('git', ['merge-base', 'HEAD', ref], dir, undefined, 10_000);
    if (r.code === 0 && r.out.trim()) { base = r.out.trim(); break; }
  }
  const d = await sh('git', ['diff', '--no-color', '--unified=0', base || 'HEAD'], dir, undefined, 20_000);
  if (d.code !== 0) return [];
  let text = addedLines(d.out.slice(0, DIFF_MAX));
  // New files git doesn't track yet are changes too (a diff leaves them out).
  const fresh = await sh('git', ['ls-files', '--others', '--exclude-standard'], dir, undefined, 10_000);
  for (const f of fresh.code === 0 ? fresh.out.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 200) : []) {
    try { const st = statSync(join(dir, f)); if (st.isFile() && st.size < 200_000) text += `\n${readFileSync(join(dir, f), 'utf8')}`; } catch { /* gone */ }
    if (text.length > DIFF_MAX) break;
  }
  return idsInText(text);
}

export class FieldPicks {
  private changes = new Map<string, { at: number; ids: string[] }>();

  /** Everything worth checking in the session now: picked, the ticket's, the changes'. */
  async list(s: Session): Promise<FieldPick[]> {
    const ticket = s.ticket ? idsInText(`${s.ticket.title}\n${s.ticket.description}\n${s.ticket.acceptance.join('\n')}`) : [];
    let ch = this.changes.get(s.id);
    if (!ch || Date.now() - ch.at > KEEP_MS) {
      const ids = (await Promise.all(s.repos.map((r) => idsInWorktree(r.dir).catch(() => [] as string[])))).flat();
      ch = { at: Date.now(), ids };
      this.changes.set(s.id, ch);
    }
    return mergePicks(s.fieldPicks ?? [], ticket.map((id) => ({ id, from: 'ticket' as const })), ch.ids.map((id) => ({ id, from: 'changes' as const })));
  }
}
