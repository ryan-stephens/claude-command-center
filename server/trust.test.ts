import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { projectKey, trustFolders } from './trust.ts';

const dir = mkdtempSync(join(tmpdir(), 'cc-trust-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('folders are keyed the way Claude Code keys them: forward slashes, no trailing one', () => {
  assert.equal(projectKey('D:\\repos\\loans-api-card-4\\'), 'D:/repos/loans-api-card-4');
});

test('marking a folder trusted touches only that project’s flag, and skips ones already trusted', () => {
  const file = join(dir, 'claude.json');
  writeFileSync(file, JSON.stringify({ numStartups: 3, projects: { 'D:/repos/shop-ui': { allowedTools: ['Bash'], hasTrustDialogAccepted: true }, 'D:/repos/loans-api': { lastCost: 1 } } }));
  const marked = trustFolders(['D:\\repos\\shop-ui', 'D:\\repos\\loans-api', 'D:\\repos\\loans-api-card-4'], file);
  assert.deepEqual(marked, ['D:\\repos\\loans-api', 'D:\\repos\\loans-api-card-4'], 'shop-ui was trusted already');
  const data = JSON.parse(readFileSync(file, 'utf8')) as { numStartups: number; projects: Record<string, Record<string, unknown>> };
  assert.equal(data.numStartups, 3, 'the rest of the file is kept');
  assert.deepEqual(data.projects['D:/repos/shop-ui'], { allowedTools: ['Bash'], hasTrustDialogAccepted: true });
  assert.deepEqual(data.projects['D:/repos/loans-api'], { lastCost: 1, hasTrustDialogAccepted: true }, 'a project Claude Code knows keeps its other keys');
  assert.deepEqual(data.projects['D:/repos/loans-api-card-4'], { hasTrustDialogAccepted: true }, 'a new folder gets only the flag');
  assert.deepEqual(trustFolders(['D:\\repos\\loans-api'], file), [], 'nothing to do the second time');
});

test('a file that doesn’t exist is made; one that isn’t JSON is left alone', () => {
  const fresh = join(dir, 'fresh.json');
  assert.deepEqual(trustFolders(['C:\\work\\a'], fresh), ['C:\\work\\a']);
  assert.deepEqual(JSON.parse(readFileSync(fresh, 'utf8')), { projects: { 'C:/work/a': { hasTrustDialogAccepted: true } } });
  const broken = join(dir, 'broken.json');
  writeFileSync(broken, '{ not json');
  assert.throws(() => trustFolders(['C:\\work\\b'], broken));
  assert.equal(readFileSync(broken, 'utf8'), '{ not json', 'untouched');
  assert.deepEqual(trustFolders([], broken), [], 'nothing asked, nothing read');
});
