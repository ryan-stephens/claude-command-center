import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadConfig, withoutSecrets } from './config.ts';

const dir = mkdtempSync(join(tmpdir(), 'cc-config-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('the settings file fills the environment, but never over what is already set', () => {
  const file = join(dir, 'config.env');
  writeFileSync(file, '# Jira\r\nCC_CONTROL_JIRA_SITE=https://jira.vu.local\r\nCC_CONTROL_JIRA_TOKEN="abc=123"\r\nCC_CONTROL_PORT=7777\r\n\r\n#CC_CONTROL_ADO_TOKEN=off\r\n');
  const env: NodeJS.ProcessEnv = { CC_CONTROL_PORT: '7788', CC_CONTROL_JIRA_SITE: '' };
  const state = loadConfig(file, env);
  assert.equal(state.file, file);
  assert.deepEqual(state.set.sort(), ['CC_CONTROL_JIRA_SITE', 'CC_CONTROL_JIRA_TOKEN']);
  assert.deepEqual(state.kept, ['CC_CONTROL_PORT'], 'a one-off CC_CONTROL_PORT=7788 still wins');
  assert.equal(env.CC_CONTROL_JIRA_TOKEN, 'abc=123');
  assert.equal(env.CC_CONTROL_JIRA_SITE, 'https://jira.vu.local', 'an empty variable counts as unset');
  assert.equal(env.CC_CONTROL_ADO_TOKEN, undefined, 'comments are comments');
  assert.deepEqual(loadConfig(join(dir, 'missing.env'), {}), { set: [], kept: [], systemCerts: 0 }, 'no file: nothing, and no error');
});

test('a settings file saved as UTF-16, with a BOM, or with an unquoted # is named, not silently ignored', () => {
  const bom = join(dir, 'bom.env');
  writeFileSync(bom, '\uFEFFCC_CONTROL_JIRA_SITE=https://jira.example\r\n');
  const env: NodeJS.ProcessEnv = {};
  assert.deepEqual(loadConfig(bom, env).set, ['CC_CONTROL_JIRA_SITE'], 'the BOM is dropped from the first name');
  const utf16 = join(dir, 'utf16.env');
  writeFileSync(utf16, Buffer.from('CC_CONTROL_JIRA_TOKEN=abc\r\n', 'utf16le'));
  assert.match(loadConfig(utf16, {}).problem ?? '', /UTF-16/);
  const hash = join(dir, 'hash.env');
  writeFileSync(hash, 'CC_CONTROL_JIRA_TOKEN=#abc\r\n');
  assert.match(loadConfig(hash, {}).problem ?? '', /CC_CONTROL_JIRA_TOKEN is set to nothing/);
  assert.deepEqual(withoutSecrets({ PATH: 'x', CC_CONTROL_JIRA_TOKEN: 't', CC_CONTROL_ADO_TOKEN: 't', CC_CONTROL_TRELLO_KEY: 'k', CC_CONTROL_JIRA_EMAIL: 'me', CC_CONTROL_PORT: '1' }),
    { PATH: 'x', CC_CONTROL_JIRA_EMAIL: 'me', CC_CONTROL_PORT: '1' }, 'tokens and keys are left out of what the server starts');
});
