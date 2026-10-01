import assert from 'node:assert/strict';
import { test } from 'node:test';
import { againstText, changeRows, changeTotals, parsePatch, patchLines, type RepoChanges } from './changes.ts';

const sample = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a };
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
diff --git a/img/logo.png b/img/logo.png
new file mode 100644
Binary files /dev/null and b/img/logo.png differ
diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-gone
`;

test('a git diff splits into files with their kind and counts', () => {
  const files = parsePatch(sample);
  assert.deepEqual(files.map((f) => [f.path, f.kind, f.added, f.removed, Boolean(f.binary)]), [
    ['src/a.ts', 'modified', 2, 1, false],
    ['src/new.ts', 'added', 2, 0, false],
    ['img/logo.png', 'added', 0, 0, true],
    ['old.ts', 'deleted', 0, 1, false],
  ]);
  assert.ok(files[0].patch.startsWith('diff --git a/src/a.ts'));
  assert.equal(files[2].patch, '', 'a binary has no patch to show');
  assert.deepEqual(parsePatch(''), []);
});

test('the rows across repos: a header per repo only when there are several, files numbered across them, totals', () => {
  const files = parsePatch(sample).map((f) => ({ ...f, mine: f.path !== 'old.ts' }));
  const ui: RepoChanges = { repo: 'shop-ui', root: 'C:/r/shop-ui-card-1', branch: 'card-1', base: 'main', committed: 2, files: files.slice(0, 2) };
  const api: RepoChanges = { repo: 'loans-api', root: 'C:/r/loans-api-card-1', branch: 'card-1', base: 'main', committed: 0, files: files.slice(2), truncated: true };
  const none: RepoChanges = { repo: 'docs', root: 'C:/r/docs-card-1', branch: 'card-1', base: 'main', committed: 0, files: [] };
  assert.deepEqual(changeRows({ repos: [ui] }).map((r) => (r.kind === 'repo' ? `# ${r.repo.repo}` : `${r.index} ${r.file.path}`)), ['0 src/a.ts', '1 src/new.ts'], 'one repo: no header');
  assert.deepEqual(changeRows({ repos: [ui, api, none] }).map((r) => (r.kind === 'repo' ? `# ${r.repo.repo}` : `${r.index} ${r.file.path}`)),
    ['# shop-ui', '0 src/a.ts', '1 src/new.ts', '# loans-api', '2 img/logo.png', '3 old.ts', '# docs']);
  assert.deepEqual(changeTotals({ repos: [ui, api, none] }), { files: 4, added: 4, removed: 2, truncated: true });
  assert.deepEqual(changeTotals({ repos: [none] }), { files: 0, added: 0, removed: 0, truncated: false });
  assert.equal(againstText(ui), 'card-1 against main, 2 commits already on the branch');
  assert.equal(againstText(api), 'card-1 against main');
  assert.equal(againstText({ branch: 'main', base: 'main', committed: 0 }), 'uncommitted, on main');
  assert.equal(againstText({ branch: '', base: '', committed: 0 }), 'uncommitted, on HEAD');
});

test('patch lines are classed for colouring', () => {
  const kinds = patchLines(parsePatch(sample)[0].patch).map((l) => l.kind);
  assert.deepEqual(kinds, ['meta', 'meta', 'meta', 'meta', 'hunk', 'ctx', 'del', 'add', 'add', 'ctx']);
});
