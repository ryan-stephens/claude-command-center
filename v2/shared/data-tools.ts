// The pure parts of the data tools (§140), shared by the server and the page: comparing values the way
// the record lookup shows them, and reading the lines a person types ("ID" or "ID = value").

/** Two values alike: numbers with or without thousands commas or trailing zeros, anything else in any case, spaces trimmed. */
export function sameValue(a: string, b: string): boolean {
  const norm = (v: string) => { const t = v.trim(); return /^-?[\d,]*\.?\d+$/.test(t) && /\d/.test(t) ? String(Number(t.replace(/,/g, ''))) : t.toLowerCase(); };
  return norm(a) === norm(b);
}

/**
 * Lines of "ID" or "ID = value", one per line (only "=": ids may hold colons; an id may have spaces).
 * "ID =" is the empty value. Blank lines and # comments are skipped; an id twice counts once.
 */
export function parseFieldLines(text: string): { ids: string[]; values: Record<string, string> } {
  const ids: string[] = [];
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    const id = (at < 0 ? line : line.slice(0, at)).trim();
    if (!id) continue;
    if (!ids.some((x) => x.toLowerCase() === id.toLowerCase())) ids.push(id);
    if (at >= 0) values[id] = line.slice(at + 1).trim();
  }
  return { ids, values };
}

/** Dev or UAT from what was asked; anything else (Prod above all) is refused in plain words. */
export function dataEnv(v: unknown): 'dev' | 'uat' {
  const e = String(v ?? 'dev').toLowerCase();
  if (e !== 'dev' && e !== 'uat') throw new Error('The data tools are for Dev or UAT only, never Prod.');
  return e;
}

/** A loan id as the tools take it. */
export function loanId(v: unknown): string {
  const l = String(v ?? '').trim();
  if (!/^[\w.{}-]{1,80}$/.test(l)) throw new Error(l ? 'That loan id doesn’t look like one.' : 'Name the loan.');
  return l;
}

/** The ask for Claude that Loan Forge sends: the session's key, the folder, the template, the env, any notes. */
export function scenarioAsk(o: { key: string; folder: string; like?: string; env: 'dev' | 'uat'; notes?: string }): string {
  return [
    `Make a new test-data scenario for ${o.key} that sets up a loan to test this work as it is implemented now.`,
    `Use the command-center tools: call scenario_guide${o.like ? ` with like: "${o.like}"` : ''} and follow its steps. File it under the folder "${o.folder}".`,
    `Then make it with make_scenario and run it in ${o.env === 'dev' ? 'Dev' : 'UAT'} (run_env: "${o.env}"), pick the fields that prove the change, and look them up on the new loan.`,
    ...(o.notes?.trim() ? [`Also: ${o.notes.trim()}`] : []),
  ].join('\n');
}

/**
 * The ask for Claude behind Field Finder's *Check with Claude*: which loan fields prove this work.
 * Claude has the ticket (CLAUDE.local.md), the worktrees and the toolbelt; the picks come back
 * through set_fields_to_check, so they show in the Fields-to-check box with why and the value expected.
 */
export function fieldsAsk(o: { key: string; loan?: string }): string {
  return [
    `Which loan fields prove ${o.key} works? Pick them for Field Finder, from what this session knows:`,
    '1. Re-read the ticket and its acceptance criteria (CLAUDE.local.md) and this session’s changes in every worktree (git diff against the base branch, committed or not).',
    '2. Call fields_to_check: what is picked already, the field ids the ticket names, and the ones in the lines this session added.',
    '3. Find the field ids involved: ones the changed code reads, sets or branches on; ones the criteria describe by name (find their ids in the code, mappings, constants or saved field lists); and ones whose value this work should change. Use only ids you found there; never invent one, and say so when a criterion has no id you can find.',
    '4. Call set_fields_to_check with each one: the id, why it proves the change (one line), and the value it should have once this works, when you can tell. Drop picks that no longer apply (remove).',
    `Keep it to the fields that prove the change, usually 3 to 10.${o.loan ? ` If it helps, look them up on loan ${o.loan} with lookup_fields.` : ''} Then reply with a short table: id, why, expected value.`,
  ].join('\n');
}
