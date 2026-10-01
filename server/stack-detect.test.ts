import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { validateStack } from '../shared/stack.ts';
import { detectWorkspaceStack, repoFiles } from './stack-detect.ts';

const dir = mkdtempSync(join(tmpdir(), 'cc-detect-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function put(rel: string, text: string): void {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

test('a repo on disk is walked without its node_modules, .git or build output, and its files are read on demand', () => {
  put('loans-api/okteto.yml', 'name: loans-api\nforward:\n  - 8080:8080\n');
  put('loans-api/src/LoansApi/LoansApi.csproj', '<Project />');
  put('loans-api/src/LoansApi/Controllers/SelfController.cs', '[Route("self")] class SelfController {}');
  put('loans-api/node_modules/x/index.js', '');
  put('loans-api/.git/HEAD', 'ref: x');
  put('loans-api/bin/Debug/x.dll', '');
  const r = repoFiles(join(dir, 'loans-api'));
  assert.equal(r.name, 'loans-api');
  assert.deepEqual(r.files, ['okteto.yml', 'src/LoansApi/Controllers/SelfController.cs', 'src/LoansApi/LoansApi.csproj']);
  assert.match(r.read('okteto.yml')!, /^name: loans-api/);
  assert.equal(r.read('nope.txt'), undefined);
  put('shop-ui/angular.json', JSON.stringify({ projects: { shop: { architect: { serve: { options: { proxyConfig: 'proxy.conf.json' } } } } } }));
  put('shop-ui/proxy.conf.json', '{ "/api/loans/**": { "target": "https://shared.example" } }');
  const d = detectWorkspaceStack([join(dir, 'shop-ui'), join(dir, 'loans-api')]);
  const s = validateStack(d.stack);
  assert.deepEqual(s.apis.map((a) => [a.repo, a.values.health, a.values.dir]), [['loans-api', '/self', 'src/LoansApi']]);
  assert.equal(s.ui?.repo, 'shop-ui');
  assert.deepEqual(Object.keys(s.api.proxy!), ['/api/{{route}}/**']);
});
