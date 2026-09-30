import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { Card } from '../shared/cards.ts';
import { CardService, cleanDraft, tabEnv } from './cards.ts';
import { Store } from './store.ts';

const dir = mkdtempSync(join(tmpdir(), 'cc-cards-'));
const store = new Store(join(dir, 'test.db'));
after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
let changes = 0;
const cards = new CardService(store, { port: 7788, changed: () => { changes++; } });

const repoItem = (id: string, on = true) => ({ kind: 'repo' as const, id, label: 'x', on });

test('a draft needs a title and a real repo; unknown workspaces and modes fall back', () => {
  assert.throws(() => cleanDraft({ title: '  ' }, []), /title/);
  assert.throws(() => cleanDraft({ title: 'x', packet: { workspace: [repoItem(join(dir, 'nope'))] } }, []), /Not a folder/);
  assert.throws(() => cleanDraft({ title: 'x', packet: { workspace: [repoItem(dir, false)] } }, []), /at least one repo/);
  const d = cleanDraft({
    title: ' Size guide ', workspaceId: 'gone',
    packet: { workspace: [repoItem(dir)], card: [{ kind: 'shell', id: 'rm -rf' }], note: 'hi' },
    launch: { home: 'elsewhere', mode: 'bypassPermissions', branch: 'yolo', message: 'Plan\nit' },
  }, []);
  assert.equal(d.title, 'Size guide');
  assert.equal(d.workspaceId, null);
  assert.deepEqual(d.packet.card, [], 'unknown item kinds are dropped');
  assert.equal(d.launch.home, dir, 'the home falls back to an included repo');
  assert.equal(d.launch.mode, 'plan', 'never a mode the page did not offer');
  assert.equal(d.launch.branch, 'new');
  assert.equal(d.launch.message, 'Plan it');
});

function seed(): Card {
  const card: Card = {
    id: crypto.randomUUID(), key: 'CARD-9', title: 'Size guide', workspaceId: null, stage: 'plan', createdAt: Date.now(),
    packet: { workspace: [repoItem(dir)], ticket: [], card: [], note: 'Keep it small.' },
    launch: { home: dir, branch: 'current', mode: 'plan', message: 'Plan CARD-9.' },
    boot: [{ at: 1, text: 'Waiting for the session to start', state: 'go' }],
  };
  store.saveCard(card, 'secret-token');
  return card;
}

test('the SessionStart hook needs the card’s own token', () => {
  const card = seed();
  assert.throws(() => cards.sessionStart(card.id, 'wrong-token!', { session_id: 'abcdef12-3456' }), /token/);
  assert.throws(() => cards.sessionStart('no-such-card', 'secret-token', { session_id: 'abcdef12-3456' }), /Unknown card/);
  assert.throws(() => cards.sessionStart(card.id, 'secret-token', { session_id: '../../etc' }), /session id/);
});

test('startup links the session and returns the packet as additionalContext', () => {
  const card = seed();
  const before = changes;
  const out = cards.sessionStart(card.id, 'secret-token', { session_id: 'abcdef12-3456-7890', source: 'startup' }) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /CARD-9 Size guide[\s\S]*## From you\nKeep it small\./);
  const saved = cards.get(card.id)!;
  assert.equal(saved.sessionId, 'abcdef12-3456-7890');
  assert.deepEqual(saved.boot.map((b) => b.state), ['ok', 'ok', 'ok'], 'the waiting step is gone');
  assert.match(saved.boot[1].text, /Linked session abcdef12/);
  assert.ok(changes > before, 'the page hears about it');
});

test('a resumed session is only linked; a cleared one gets the packet again', () => {
  const card = seed();
  cards.sessionStart(card.id, 'secret-token', { session_id: 'first-session-1', source: 'startup' });
  assert.equal(cards.sessionStart(card.id, 'secret-token', { session_id: 'first-session-1', source: 'resume' }), null);
  const again = cards.sessionStart(card.id, 'secret-token', { session_id: 'second-session-2', source: 'clear' });
  assert.ok(again);
  const saved = cards.get(card.id)!;
  assert.equal(saved.sessionId, 'second-session-2');
  assert.ok(saved.boot.some((b) => /after \/clear/.test(b.text)));
});

test('card keys are never reused, and the token never reaches the card itself', () => {
  const a = store.nextCardKey();
  const b = store.nextCardKey();
  assert.notEqual(a, b);
  assert.equal(cards.peekKey(), `CARD-${Number(b.slice(5)) + 1}`);
  const card = seed();
  assert.ok(!JSON.stringify(cards.get(card.id)).includes('secret-token'));
  cards.delete(card.id);
  assert.equal(cards.get(card.id), undefined);
});

test('the tab gets the card, not the markers of a Claude Code session the server runs under', () => {
  const env = tabEnv({
    PATH: 'x', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CODE_MESSAGING_SOCKET: 'p',
    CLAUDE_CODE_BRIDGE_SESSION_ID: 'b', CLAUDE_PID: '1', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CONFIG_DIR: 'c',
  }, 'card-1', 'tok', 7777);
  assert.deepEqual(Object.keys(env).sort(), ['CC_CONTROL_CARD', 'CC_CONTROL_TOKEN', 'CC_CONTROL_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CONFIG_DIR', 'PATH']);
  assert.equal(env.CC_CONTROL_URL, 'http://127.0.0.1:7777');
});
