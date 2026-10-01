import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { askOf, type Card } from '../shared/cards.ts';
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
    CC_CONTROL_JIRA_TOKEN: 'secret', CC_CONTROL_ADO_TOKEN: 'secret', CC_CONTROL_TRELLO_KEY: 'k', CC_CONTROL_JIRA_SITE: 'https://jira',
  }, 'card-1', 'tok', 7777);
  assert.deepEqual(Object.keys(env).sort(), ['CC_CONTROL_CARD', 'CC_CONTROL_JIRA_SITE', 'CC_CONTROL_TOKEN', 'CC_CONTROL_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CONFIG_DIR', 'PATH'], 'the settings file’s tokens never reach the tab');
  assert.equal(env.CC_CONTROL_URL, 'http://127.0.0.1:7777');
});

test('once linked, only /clear moves the card to another session; a claude run inside the tab gets nothing', () => {
  const card = seed();
  cards.sessionStart(card.id, 'secret-token', { session_id: 'tab-session-1', source: 'startup' });
  assert.equal(cards.sessionStart(card.id, 'secret-token', { session_id: 'nested-run-1', source: 'startup' }), null);
  assert.equal(cards.get(card.id)!.sessionId, 'tab-session-1');
});

test('hook events move the linked card; events from other sessions are ignored', () => {
  const card = seed();
  cards.sessionStart(card.id, 'secret-token', { session_id: 'tab-session-2', source: 'startup' });
  cards.hookEvent(card.id, 'secret-token', 'PermissionRequest', { session_id: 'someone-else', tool_name: 'Bash', tool_input: { command: 'x' } });
  assert.equal(cards.get(card.id)!.stage, 'plan');
  cards.hookEvent(card.id, 'secret-token', 'PermissionRequest', { session_id: 'tab-session-2', tool_name: 'Bash', tool_input: { command: 'x' } });
  assert.equal(cards.get(card.id)!.stage, 'needs');
  assert.throws(() => cards.hookEvent(card.id, 'nope-nope', 'Stop', { session_id: 'tab-session-2' }), /token/);
});

type HookOut = { hookSpecificOutput: { hookEventName: string; additionalContext: string } } | null;

test('context added later waits on the card and goes with the next message typed in its tab', () => {
  const card = seed();
  cards.sessionStart(card.id, 'secret-token', { session_id: 'tab-session-3', source: 'startup' });
  const other = mkdtempSync(join(tmpdir(), 'cc-cards-more-'));
  try {
    const added = cards.addContext(card.id, [
      { kind: 'repo', id: other, label: 'x', on: true },
      { kind: 'repo', id: dir, label: 'x', on: true },
      { kind: 'ticket', id: 'ticket:SHOP-160', label: 'Related ticket: SHOP-160 Tax', text: 'SHOP-160 Tax\nRound it.', on: true },
    ], '  Use the guest_cart flag.  ');
    assert.deepEqual(added.map((i) => i.kind), ['repo', 'ticket', 'note'], 'a repo the card already has is skipped');
    assert.throws(() => cards.addContext(card.id, [{ kind: 'repo', id: other, label: 'x', on: true }], ''), /Nothing new/);

    assert.equal(cards.hookEvent(card.id, 'secret-token', 'PreToolUse', { session_id: 'tab-session-3', tool_name: 'Read' }), null, 'only a typed message takes it');
    const out = cards.hookEvent(card.id, 'secret-token', 'UserPromptSubmit', { session_id: 'tab-session-3', prompt: 'go on' }) as HookOut;
    assert.equal(out!.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    const text = out!.hookSpecificOutput.additionalContext;
    assert.match(text, /^# Added to CARD-9 by cc-control/);
    assert.ok(text.includes(`: ${other}`), 'the repo, by path');
    assert.match(text, /## Also look at\n- SHOP-160 Tax\n {2}Round it\./);
    assert.match(text, /## From you\nUse the guest_cart flag\.$/);
    const saved = cards.get(card.id)!;
    assert.ok(saved.later!.every((i) => i.sent), 'all marked as sent');
    assert.equal(saved.stage, 'plan', 'the message still moves the card as before');
    assert.equal(cards.hookEvent(card.id, 'secret-token', 'UserPromptSubmit', { session_id: 'tab-session-3' }), null, 'sent once');

    // /clear loses it, so SessionStart sends it again with the packet.
    const again = cards.sessionStart(card.id, 'secret-token', { session_id: 'tab-session-4', source: 'clear' }) as HookOut;
    assert.match(again!.hookSpecificOutput.additionalContext, /## From you\nKeep it small\.[\s\S]*# Added to CARD-9[\s\S]*guest_cart/);
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

test('what waits before the session links goes with the packet; waiting items can be taken back', () => {
  const card = seed();
  const [note] = cards.addContext(card.id, [], 'First note');
  cards.addContext(card.id, [], 'Second note');
  cards.withdraw(card.id, note.id);
  assert.deepEqual(cards.get(card.id)!.later!.map((i) => i.text), ['Second note']);
  const out = cards.sessionStart(card.id, 'secret-token', { session_id: 'tab-session-5', source: 'startup' }) as HookOut;
  assert.match(out!.hookSpecificOutput.additionalContext, /Second note/);
  assert.equal(cards.hookEvent(card.id, 'secret-token', 'UserPromptSubmit', { session_id: 'tab-session-5' }), null, 'not sent twice');
  const sent = cards.get(card.id)!.later![0];
  assert.throws(() => cards.withdraw(card.id, sent.id), /already gone/);
});

test('done by hand: only a card that is in Ship (its PR merged or closed elsewhere); QA and review cards any time', () => {
  const card = seed();
  assert.throws(() => cards.finish(card.id), /ships with a pull request/);
  store.saveCard({ ...card, stage: 'ship' });
  cards.finish(card.id);
  assert.equal(cards.get(card.id)!.stage, 'done');
  const qa = { ...seed(), kind: 'qa' as const, stage: 'build' as const };
  store.saveCard(qa);
  cards.finish(qa.id);
  assert.equal(cards.get(qa.id)!.stage, 'done');
});

test('a relayed permission prompt survives the hooks around it, and goes when answered or when the tool ran', () => {
  const card = seed();
  store.saveCard({ ...card, sessionId: 'sess-00000001', channel: true, live: { phase: 'working', text: 'working', at: 1 } });
  const hook = (event: string, input: object) => cards.hookEvent(card.id, 'secret-token', event, { session_id: 'sess-00000001', hook_event_name: event, ...input } as never);
  const get = () => cards.get(card.id)!;
  // The real order seen live: channel request, then PreToolUse (clears the ask), then PermissionRequest.
  cards.channelAsk(card.id, 'Bash', 'req-1', 'Run the tests');
  assert.deepEqual(askOf(get()), { kind: 'tool', tool: 'Bash', detail: 'Run the tests', requestId: 'req-1' }, 'answerable before any hook says a word');
  hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'pnpm test', description: 'Run the tests' } });
  hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'pnpm test', description: 'Run the tests' } });
  assert.equal(get().live!.phase, 'needs');
  assert.equal(askOf(get())!.requestId, 'req-1', 'the hook’s fuller description, with the channel’s id');
  cards.channelAnswered(card.id, 'req-1');
  assert.equal(get().relayed, undefined);
  assert.equal(askOf(get())!.requestId, undefined);
  // The tool running (or the turn ending) also clears a relayed prompt nobody answered from here.
  cards.channelAsk(card.id, 'Edit', 'req-2');
  hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: 'a.ts' }, tool_response: {} });
  assert.equal(get().relayed, undefined);
  // A plan: with the hooks quiet (PreToolUse cleared the ask), the relayed prompt alone says it is one.
  store.saveCard({ ...get(), live: { phase: 'working', text: 'x', at: 2 } });
  cards.channelAsk(card.id, 'ExitPlanMode', 'req-3');
  assert.equal(askOf(get())!.kind, 'plan');
  hook('Stop', {});
  assert.equal(get().relayed, undefined);
  // Without a channel, a stale relayed entry is never offered.
  cards.channelAsk(card.id, 'Bash', 'req-4');
  store.saveCard({ ...get(), channel: false });
  assert.equal(askOf(get())?.requestId, undefined);
});
