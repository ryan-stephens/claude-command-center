import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from './sessions.ts';
import type { Session } from '../shared/types.ts';

const draft = (key: string): Omit<Session, 'id'> => ({
  key, title: 'Waive the late fee', workspaceId: 'w1', repos: [], home: 'C:/x', branch: 'shop-160-waive', createdAt: Date.now(),
  opener: 'terminal', firstMessage: 'go', claude: { state: 'starting', text: 'opening', at: 0 }, loans: [], fields: [], evidence: [], prs: [],
});

test('sessions are kept in a file, found by key, checked by their token, and survive a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccv2-'));
  const a = new SessionStore(dir);
  const { session, token } = a.add(draft('SHOP-160'));
  assert.ok(a.check(session.id, token));
  assert.ok(!a.check(session.id, token.replace(/.$/, (c) => (c === '0' ? '1' : '0'))));
  assert.ok(!a.check(session.id, ''));
  a.update(session.id, (s) => ({ ...s, loans: [{ loan: 'LN-1', env: 'dev', scenario: 'Late fee', at: 1 }] }));
  const b = new SessionStore(dir);
  assert.equal(b.byKey('shop-160')?.loans[0].loan, 'LN-1');
  assert.ok(b.check(session.id, token));
  b.remove(session.id);
  assert.equal(new SessionStore(dir).list().length, 0);
  assert.ok(!readdirSync(dir).some((f) => f.endsWith('.tmp')));
});

test('a broken file is set aside, not overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccv2-'));
  writeFileSync(join(dir, 'sessions.json'), '{ not json');
  const s = new SessionStore(dir);
  assert.equal(s.list().length, 0);
  assert.ok(readdirSync(dir).some((f) => f.startsWith('sessions.json.broken-')));
});
