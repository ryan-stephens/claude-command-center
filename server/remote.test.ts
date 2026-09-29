import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieToken, findRemoteIp, remoteHostAllowed, tokenMatches } from './remote.ts';

test('remote IP override accepts only Tailscale or loopback aliases', () => {
  const tryIp = (ip: string) => {
    process.env.CC_CONTROL_REMOTE_IP = ip;
    try { return findRemoteIp(); } catch (e) { return (e as Error).message; } finally { delete process.env.CC_CONTROL_REMOTE_IP; }
  };
  assert.equal(tryIp('100.101.102.103'), '100.101.102.103');
  assert.equal(tryIp('127.0.0.2'), '127.0.0.2');
  assert.match(tryIp('0.0.0.0'), /refused/);
  assert.match(tryIp('192.168.1.25'), /refused/);
  assert.match(tryIp('127.0.0.1'), /refused/); // that's the tokenless local listener
  assert.match(tryIp('100.128.0.1'), /refused/); // just outside 100.64.0.0/10
});

test('token comparison', () => {
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abd', 'abc'), false);
  assert.equal(tokenMatches('ab', 'abc'), false);
  assert.equal(tokenMatches(undefined, 'abc'), false);
});

test('cookie parsing', () => {
  assert.equal(cookieToken('a=1; cc_token=x-y_z; b=2'), 'x-y_z');
  assert.equal(cookieToken('cc_tokenx=1'), undefined);
  assert.equal(cookieToken(undefined), undefined);
});

test('remote hosts: the Tailscale IP or a MagicDNS name, on the right port', () => {
  assert.equal(remoteHostAllowed('100.64.1.2:7777', '100.64.1.2', 7777), true);
  assert.equal(remoteHostAllowed('laptop.tail1234.ts.net:7777', '100.64.1.2', 7777), true);
  assert.equal(remoteHostAllowed('evil.com:7777', '100.64.1.2', 7777), false);
  assert.equal(remoteHostAllowed('ts.net.evil.com:7777', '100.64.1.2', 7777), false);
  assert.equal(remoteHostAllowed('100.64.1.2:8080', '100.64.1.2', 7777), false);
  assert.equal(remoteHostAllowed(undefined, '100.64.1.2', 7777), false);
});
