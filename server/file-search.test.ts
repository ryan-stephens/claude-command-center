import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileScore, searchFiles } from './file-search.ts';

test('fileScore: names starting with the query first, then names, paths, then in-order letters', () => {
  const s = (p: string) => fileScore('app', p);
  assert.ok(s('src/app.ts') > s('src/myapp.ts'));
  assert.ok(s('src/myapp.ts') > s('app/index.ts'));
  assert.ok(s('app/index.ts') > s('a/p/p.ts'));
  assert.equal(fileScore('zzz', 'src/app.ts'), -1);
  assert.ok(fileScore('src/ap', 'src/app.ts') > 0, 'a typed path works too');
});

test('searchFiles finds files in the repo and the others it can use, skipping ignored folders', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-files-'));
  try {
    const web = join(root, 'web');
    const docs = join(root, 'docs');
    for (const f of ['src/app.ts', 'src/util.ts', 'README.md', 'node_modules/x/app.js']) {
      mkdirSync(join(web, f, '..'), { recursive: true });
      writeFileSync(join(web, f), '');
    }
    mkdirSync(docs);
    writeFileSync(join(docs, 'api.md'), '');
    const hits = await searchFiles(web, [docs], 'ap');
    assert.deepEqual(hits.map((h) => h.label), ['src/app.ts', 'api.md']);
    assert.equal(hits[0].path, 'src/app.ts', 'own repo: relative');
    assert.equal(hits[1].path, join(docs, 'api.md'), 'other repo: full path');
    assert.equal(hits[1].repo, 'docs');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
