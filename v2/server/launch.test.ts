import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeArgs, withHooks, writeLocalFiles } from './launch.ts';
import type { ClaudeStatus } from '../shared/types.ts';

const f = { sessionId: 'sid', token: 'tok', url: 'http://127.0.0.1:7878' };

test('the folder\'s own settings are kept; our hooks replace older ones of ours; our MCP server is allowed', () => {
  const theirs = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo theirs' }] }, { hooks: [{ type: 'command', command: 'node "C:/x/v2/hooks/hook.mjs" Stop old old http://127.0.0.1:1' }] }] }, enabledMcpjsonServers: ['other'] };
  const out = withHooks(theirs, f) as { model: string; hooks: Record<string, { hooks: { command: string }[] }[]>; enabledMcpjsonServers: string[] };
  assert.equal(out.model, 'opus');
  assert.equal(out.hooks.Stop.length, 2);
  assert.equal(out.hooks.Stop[0].hooks[0].command, 'echo theirs');
  assert.match(out.hooks.Stop[1].hooks[0].command, /hook\.mjs" Stop sid tok http:\/\/127\.0\.0\.1:7878$/);
  assert.ok(out.hooks.SessionStart && out.hooks.PermissionRequest);
  assert.deepEqual(out.enabledMcpjsonServers, ['other', 'command-center']);
});

test('the local files go in the folder; a repo\'s own .mcp.json is left alone and ours goes outside', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccv2-home-'));
  const out = mkdtempSync(join(tmpdir(), 'ccv2-out-'));
  assert.deepEqual(writeLocalFiles({ ...f, dir, pack: '# pack\n' }, out), {});
  assert.equal(readFileSync(join(dir, 'CLAUDE.local.md'), 'utf8'), '# pack\n');
  assert.match(readFileSync(join(dir, '.mcp.json'), 'utf8'), /"CCV2_SESSION": "sid"/);
  assert.ok(existsSync(join(dir, '.claude', 'settings.local.json')));
  const team = mkdtempSync(join(tmpdir(), 'ccv2-team-'));
  writeFileSync(join(team, '.mcp.json'), '{"mcpServers":{"theirs":{}}}');
  mkdirSync(join(team, '.claude'));
  const r = writeLocalFiles({ ...f, dir: team, pack: 'p' }, out);
  assert.equal(readFileSync(join(team, '.mcp.json'), 'utf8'), '{"mcpServers":{"theirs":{}}}');
  assert.ok(r.mcpConfig && existsSync(r.mcpConfig));
});

test('a tab resumes the session Claude reported, else starts it with the first message; other worktrees join with --add-dir', () => {
  const claude: ClaudeStatus = { state: 'done', text: '', at: 0 };
  const s = { key: 'SHOP-160', title: 'Waive', repos: [{ repo: 'C:/a', name: 'a', dir: 'C:/a-shop-160' }, { repo: 'C:/b', name: 'b', dir: 'C:/b-shop-160' }], home: 'C:/a-shop-160', firstMessage: 'Plan it', claude };
  assert.deepEqual(claudeArgs(s), { args: ['-n', 'SHOP-160 Waive', '--add-dir', 'C:/b-shop-160'], message: 'Plan it' });
  assert.deepEqual(claudeArgs({ ...s, claude: { ...claude, claudeId: 'abc' } }).args.slice(-2), ['--resume', 'abc']);
});
