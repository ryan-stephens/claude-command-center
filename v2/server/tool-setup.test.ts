import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findInstalls, launchUrl, lookInFolder, saveStart } from './tool-setup.ts';

/** A made-up tool: a web API with launch settings, a test project, a web UI on pnpm. */
function sampleTool(root: string, withScript = false): string {
  const dir = join(root, 'Sample-Data-Tool');
  mkdirSync(join(dir, 'src', 'Sample.Api', 'Properties'), { recursive: true });
  writeFileSync(join(dir, 'src', 'Sample.Api', 'Sample.Api.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');
  writeFileSync(join(dir, 'src', 'Sample.Api', 'Properties', 'launchSettings.json'), JSON.stringify({ profiles: { iis: { commandName: 'IISExpress' }, api: { commandName: 'Project', applicationUrl: 'https://localhost:7101;http://localhost:5101' } } }));
  mkdirSync(join(dir, 'src', 'Sample.Api.Tests'), { recursive: true });
  writeFileSync(join(dir, 'src', 'Sample.Api.Tests', 'Sample.Api.Tests.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');
  mkdirSync(join(dir, 'src', 'Sample.Lib'), { recursive: true });
  writeFileSync(join(dir, 'src', 'Sample.Lib', 'Sample.Lib.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>');
  mkdirSync(join(dir, 'web', 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(dir, 'web', 'package.json'), JSON.stringify({ name: 'sample-web', scripts: { dev: 'vite', build: 'vite build' } }));
  writeFileSync(join(dir, 'web', 'pnpm-lock.yaml'), '');
  writeFileSync(join(dir, 'web', 'node_modules', 'x', 'package.json'), JSON.stringify({ scripts: { start: 'x' } }));
  if (withScript) writeFileSync(join(dir, 'start-all.ps1'), 'Write-Host start');
  return dir;
}

test('the API address from launch settings: the project profile, http first', () => {
  assert.equal(launchUrl(JSON.stringify({ profiles: { a: { commandName: 'Project', applicationUrl: 'https://localhost:7001;http://localhost:5001' } } })), 'http://localhost:5001');
  assert.equal(launchUrl('{ not json'), undefined);
});

test('a folder: its web API (not tests or libraries) with its address, its web UI on its package manager, the first of each ticked', () => {
  const dir = sampleTool(mkdtempSync(join(tmpdir(), 'ccv2-setup-')));
  const r = lookInFolder(dir);
  assert.equal(r.problem, undefined);
  assert.deepEqual(r.options.map((o) => [o.kind, o.command, o.on]), [
    ['api', 'dotnet run --project "src/Sample.Api/Sample.Api.csproj"', true],
    ['ui', 'pnpm --dir "web" run dev', true],
  ]);
  assert.equal(r.url, 'http://localhost:5101');
});

test('a start script at the top is ticked instead; a missing or relative folder says so', () => {
  const dir = sampleTool(mkdtempSync(join(tmpdir(), 'ccv2-setup-')), true);
  const r = lookInFolder(dir);
  assert.deepEqual(r.options.filter((o) => o.on).map((o) => o.command), ['powershell -NoProfile -File .\\start-all.ps1']);
  // The same folder written with forward slashes (as the finder gives it) finds the same.
  assert.deepEqual(lookInFolder(dir.replace(/\\/g, '/')).options.map((o) => o.command), r.options.map((o) => o.command));
  assert.match(lookInFolder(join(dir, 'nope')).problem!, /There is no folder/);
  assert.match(lookInFolder('relative/path').problem!, /full path/);
});

test('installs are found by the tool’s name beside the workspaces’ repos', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccv2-find-'));
  sampleTool(root);
  mkdirSync(join(root, 'shop-ui'));
  const found = findInstalls('Sample Data Tool', [join(root, 'shop-ui')], join(root, 'nohome'));
  assert.deepEqual(found.map((f) => f.split('/').pop()), ['Sample-Data-Tool']);
  assert.deepEqual(findInstalls('ab', [join(root, 'shop-ui')]), []);
});

test('saving writes the folder, the picked commands (built here) and the address, keeping the rest of the file', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccv2-save-'));
  const dir = sampleTool(root);
  const file = join(root, 'verify.json');
  writeFileSync(file, JSON.stringify({ lookup: { url: 'http://lookup.example.invalid/Lookup' }, builder: { name: 'Sample data', url: 'http://127.0.0.1:9999' } }));
  const ids = lookInFolder(dir).options.map((o) => o.id);
  const r = saveStart(file, dir, ids, '');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.lookup.url, 'http://lookup.example.invalid/Lookup');
  assert.equal(saved.builder.name, 'Sample data');
  assert.equal(saved.builder.url, 'http://localhost:5101');
  assert.equal(saved.builder.cwd, dir.replace(/[\\/]+$/, ''));
  assert.deepEqual(saved.builder.launch, r.launch);
  assert.equal(r.launch.length, 2);
  assert.throws(() => saveStart(file, dir, ['api:not-there.csproj'], ''), /Tick at least one/);
  assert.throws(() => saveStart(file, dir, ids, 'http://tools.example.invalid'), /on this machine/);
  writeFileSync(file, '{ broken');
  assert.throws(() => saveStart(file, dir, ids, ''), /isn’t JSON, so it wasn’t changed/);
});
