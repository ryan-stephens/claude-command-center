import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionSummary, Workspace } from '../shared/protocol.ts';
import { age, bucketOf, groupSessions, sessionsIn, statusLabel } from './home-model.ts';

const s = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary =>
  ({ id, title: id, cwd: 'C:\\repos\\web-app', lastModified: 0, live: false, ...extra });
const none = { pending: false, unread: false };

test('buckets: approvals and unseen finishes need you, then working, done, earlier', () => {
  assert.equal(bucketOf(s('a', { live: true, status: 'running' }), { pending: true, unread: false }), 'needs');
  assert.equal(bucketOf(s('a', { live: true, status: 'idle' }), { pending: false, unread: true }), 'needs');
  assert.equal(bucketOf(s('a', { live: true, status: 'running' }), none), 'working');
  assert.equal(bucketOf(s('a', { live: true, status: 'idle', background: 2 }), none), 'working');
  assert.equal(bucketOf(s('a', { live: true, status: 'idle' }), none), 'done');
  assert.equal(bucketOf(s('a', { live: true, status: 'stopped' }), none), 'earlier');
  assert.equal(bucketOf(s('a'), none), 'earlier');
});

test('status words are plain', () => {
  assert.deepEqual(statusLabel(s('a', { live: true, status: 'requires_action' }), none), { text: 'Waiting for your OK', tone: 'amber' });
  assert.equal(statusLabel(s('a', { live: true, status: 'idle' }), { pending: false, unread: true }).text, 'Finished · your turn');
  assert.equal(statusLabel(s('a', { live: true, status: 'running' }), none).text, 'Working on it');
  assert.equal(statusLabel(s('a', { live: true, status: 'idle', background: 1 }), none).text, 'Done · 1 still running');
  assert.equal(statusLabel(s('a', { live: true, status: 'idle' }), none).text, 'Done');
  assert.equal(statusLabel(s('a', { activeElsewhere: true }), none).text, 'Open in a terminal');
  assert.equal(statusLabel(s('a'), none).text, '');
});

test('sessions belong to a workspace by folder; the rest go under key 0', () => {
  const store: Workspace = { id: 'w1', name: 'Store', color: 'orange', repos: ['C:\\repos\\web-app', 'C:\\repos\\api'] };
  const list = [s('web'), s('api', { cwd: 'c:/repos/api/src' }), s('other', { cwd: 'D:\\scratch' })];
  assert.deepEqual(sessionsIn({ kind: 'workspace', id: 'w1' }, list, [store]).map((x) => x.id), ['web', 'api']);
  assert.deepEqual(sessionsIn({ kind: 'rest' }, list, [store]).map((x) => x.id), ['other']);
  assert.deepEqual(sessionsIn({ kind: 'workspace', id: 'gone' }, list, [store]), []);
  assert.equal(sessionsIn({ kind: 'rest' }, list, []).length, 3, 'with no workspaces, key 0 holds everything');
});

test('groups come in fixed order, skip empty buckets, and order "needs you" like Alt+N', () => {
  const list = [s('done', { live: true, status: 'idle' }), s('old'), s('b', { live: true, status: 'idle' }), s('a', { live: true, status: 'running' })];
  const flags = (x: SessionSummary) => ({ pending: x.id === 'a', unread: x.id === 'b' });
  const groups = groupSessions(list, flags, ['a', 'b']);
  assert.deepEqual(groups.map((g) => [g.bucket, g.sessions.map((x) => x.id)]), [['needs', ['a', 'b']], ['done', ['done']], ['earlier', ['old']]]);
});

test('ages', () => {
  assert.equal(age(0, 10_000), 'now');
  assert.equal(age(0, 5 * 60_000), '5m');
  assert.equal(age(0, 3 * 3600_000), '3h');
  assert.equal(age(0, 3 * 86400_000), '3d');
  assert.equal(age(0, 30 * 86400_000), '4w');
});
