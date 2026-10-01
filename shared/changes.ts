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

export interface Changes {
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
