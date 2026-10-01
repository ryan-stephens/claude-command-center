// What a card changed, as git sees it: every file different from where the branch left the base
// (committed or not, tracked or new), each with its patch. Shown by D on a card (web/components/
// ChangesSheet.tsx); worked out on the server (ShipService.changes). Pure parsing here, tested.

export interface ChangedFile {
  /** Relative to the repo root, with forward slashes. */
  path: string;
  /** added · modified · deleted · renamed · new (untracked). */
  kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'new';
  /** The card's session wrote it (ShipFile.mine). */
  mine: boolean;
  /** The unified diff for this file alone; '' for a binary. */
  patch: string;
  added: number;
  removed: number;
  binary?: boolean;
}

/** One repo the card works in: its home folder, each worktree of its, and any other repo of the card it wrote in. */
export interface RepoChanges {
  /** The repo's name (a worktree is named after the repo it is of). */
  repo: string;
  root: string;
  branch: string;
  /** What the diff is against: the base branch where this branch left it, or HEAD on the base itself. */
  base: string;
  /** Commits on the branch the base doesn't have. */
  committed: number;
  files: ChangedFile[];
  /** The patch was cut (very large diffs). */
  truncated?: boolean;
}

export interface Changes {
  /** The card's home repo first, then the others in the card's order. */
  repos: RepoChanges[];
}

/** The sheet's list: a header per repo when there are several, then its files; `index` counts files across repos. */
export type ChangeRow = { kind: 'repo'; repo: RepoChanges } | { kind: 'file'; repo: RepoChanges; file: ChangedFile; index: number };
export function changeRows(c: Changes): ChangeRow[] {
  const rows: ChangeRow[] = [];
  let index = 0;
  for (const repo of c.repos) {
    if (c.repos.length > 1) rows.push({ kind: 'repo', repo });
    for (const file of repo.files) rows.push({ kind: 'file', repo, file, index: index++ });
  }
  return rows;
}

export function changeTotals(c: Changes): { files: number; added: number; removed: number; truncated: boolean } {
  const files = c.repos.flatMap((r) => r.files);
  return { files: files.length, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0), truncated: c.repos.some((r) => r.truncated) };
}

/** What a repo's diff is against, in words: "shop-155 against main, 2 commits already on the branch" or "uncommitted, on main". */
export function againstText(r: Pick<RepoChanges, 'branch' | 'base' | 'committed'>): string {
  if (r.branch && r.branch !== r.base) return `${r.branch} against ${r.base}${r.committed ? `, ${r.committed} commit${r.committed === 1 ? '' : 's'} already on the branch` : ''}`;
  return `uncommitted, on ${r.branch || 'HEAD'}`;
}

/** One file's diff out of `git diff` output: split on the `diff --git` headers, count the lines. */
export function parsePatch(text: string): Omit<ChangedFile, 'mine'>[] {
  const out: Omit<ChangedFile, 'mine'>[] = [];
  const parts = text.split(/^(?=diff --git )/m).filter((p) => p.startsWith('diff --git '));
  for (const p of parts) {
    const head = /^diff --git a\/(.*?) b\/(.*)$/m.exec(p);
    if (!head) continue;
    const path = head[2];
    const binary = /^Binary files /m.test(p) || /^GIT binary patch/m.test(p);
    let kind: ChangedFile['kind'] = 'modified';
    if (/^new file mode/m.test(p)) kind = 'added';
    else if (/^deleted file mode/m.test(p)) kind = 'deleted';
    else if (/^rename from /m.test(p)) kind = 'renamed';
    let added = 0;
    let removed = 0;
    for (const line of p.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
    out.push({ path, kind, patch: binary ? '' : p, added, removed, ...(binary ? { binary: true } : {}) });
  }
  return out;
}

/** The lines of a patch, each with what it is, for colouring. */
export type PatchLine = { kind: 'add' | 'del' | 'hunk' | 'meta' | 'ctx'; text: string };
export function patchLines(patch: string): PatchLine[] {
  return patch.replace(/\n$/, '').split('\n').map((text) => {
    if (text.startsWith('@@')) return { kind: 'hunk', text };
    if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff ') || text.startsWith('index ') || /^(new|deleted) file mode/.test(text) || /^(rename|similarity) /.test(text)) return { kind: 'meta', text };
    if (text.startsWith('+')) return { kind: 'add', text };
    if (text.startsWith('-')) return { kind: 'del', text };
    return { kind: 'ctx', text };
  });
}
