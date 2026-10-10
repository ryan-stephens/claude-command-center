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
