import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { askOf, type Card } from '../shared/cards.ts';
import { APP_EVENTS, appHooks, CardService, cleanDraft, tabEnv } from './cards.ts';
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
    launch: { home: 'elsewhere', mode: 'bypassPermissions', branch: 'yolo', message: 'Plan \r\nit\n\n\n\nnow ' },
  }, []);
  assert.equal(d.title, 'Size guide');
  assert.equal(d.workspaceId, null);
  assert.deepEqual(d.packet.card, [], 'unknown item kinds are dropped');
  assert.equal(d.launch.home, dir, 'the home falls back to an included repo');
  assert.equal(d.launch.mode, 'plan', 'never a mode the page did not offer');
  assert.equal(d.launch.branch, 'worktree', 'development works in worktrees unless the page said otherwise');
  assert.equal(d.launch.message, 'Plan\nit\n\nnow', 'the lines stay (§69); only trailing spaces and runs of blank lines go');
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

test('a ticket that moved past the work takes its card to Done; a status change short of that is kept on the card', () => {
  const ticket = { key: 'SHOP-7', source: 'jira' as const, project: 'SHOP', projectName: 'Shop', title: 'x', description: '', acceptance: [], comments: [], attachments: [], links: [], status: 'In Progress', done: false, updatedAt: 5 };
  const card: Card = { ...seed(), id: crypto.randomUUID(), key: 'SHOP-7', stage: 'try', ticket, live: { phase: 'waiting', text: 'Done. Ready to try', at: 1 } };
  store.saveCard(card, 't');
  assert.equal(cards.ticketMoved({ ...ticket, status: 'In Progress' }, false), undefined, 'nothing changed: nothing saved');
  const qa = cards.ticketMoved({ ...ticket, status: 'Ready for QA', updatedAt: 9 }, false)!;
  assert.equal(qa.stage, 'try', 'short of done: the card stays where it is');
  assert.deepEqual([qa.ticket!.status, qa.ticket!.updatedAt], ['Ready for QA', 9]);
  const po = cards.ticketMoved({ ...ticket, status: 'Ready for PO', updatedAt: 12 }, true)!;
  assert.equal(po.stage, 'done');
  assert.equal(po.live!.text, 'Ready for PO in Jira: done');
  assert.equal(cards.get(card.id)!.stage, 'done', 'saved');
  assert.equal(cards.ticketMoved({ ...ticket, status: 'Done', done: true }, true), undefined, 'a card already done is left alone');
  assert.equal(cards.ticketMoved({ ...ticket, key: 'SHOP-999' }, true), undefined, 'no card for it');
});

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

test('a session is reopened only when it has one, its folder is there, and its tab doesn’t look alive (§85)', async () => {
  const card = seed();
  await assert.rejects(cards.reopen('nope'), /gone/);
  await assert.rejects(cards.reopen(card.id), /hasn’t started a session/);
  cards.sessionStart(card.id, 'secret-token', { session_id: 'live-session-1', source: 'startup' });
  // No folder yet (the card never opened a tab in this test): said before anything else.
  await assert.rejects(cards.reopen(card.id), /isn’t there any more/);
  store.saveCard({ ...cards.get(card.id)!, cwd: dir }, 'secret-token');
  // The hooks just spoke: the tab is alive without a channel, so a second tab on the session is refused.
  await assert.rejects(cards.reopen(card.id), /looks open .* g brings the tab forward/);
  cards.hookEvent(card.id, 'secret-token', 'SessionEnd', { session_id: 'live-session-1' });
  // Ended: a resume is allowed (not run here: it would open a real terminal); the folder check comes first again.
  store.saveCard({ ...cards.get(card.id)!, cwd: join(dir, 'gone') }, 'secret-token');
  await assert.rejects(cards.reopen(card.id), /isn’t there any more/);
  // A restart: every card forgets its channel until the script in its tab says hello again.
  cards.channelState(card.id, true);
  assert.equal(cards.get(card.id)!.channel, true);
  cards.resetChannels();
  assert.equal(cards.get(card.id)!.channel, false);
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

test('context added later waits on the card and goes with the next message typed in its tab', async () => {
  const card = seed();
  cards.sessionStart(card.id, 'secret-token', { session_id: 'tab-session-3', source: 'startup' });
  const other = mkdtempSync(join(tmpdir(), 'cc-cards-more-'));
  try {
    const added = await cards.addContext(card.id, [
      { kind: 'repo', id: other, label: 'x', on: true },
      { kind: 'repo', id: dir, label: 'x', on: true },
      { kind: 'ticket', id: 'ticket:SHOP-160', label: 'Related ticket: SHOP-160 Tax', text: 'SHOP-160 Tax\nRound it.', on: true },
    ], '  Use the guest_cart flag.  ');
    assert.deepEqual(added.map((i) => i.kind), ['repo', 'ticket', 'note'], 'a repo the card already has is skipped');
    await assert.rejects(cards.addContext(card.id, [{ kind: 'repo', id: other, label: 'x', on: true }], ''), /Nothing new/);

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

test('what waits before the session links goes with the packet; waiting items can be taken back', async () => {
  const card = seed();
  const [note] = await cards.addContext(card.id, [], 'First note');
  await cards.addContext(card.id, [], 'Second note');
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

test('the app’s own session (§93): in-process hooks move the card with no token, and add what waits to the next message', async () => {
  const card = { ...seed(), runner: 'app' as const, sessionId: 'app-00000001', live: { phase: 'working' as const, text: 'Starting Claude', at: 1 } };
  store.saveCard(card);
  const get = () => cards.get(card.id)!;
  cards.appEvent(card.id, 'PreToolUse', { session_id: 'app-00000001', tool_name: 'Read', tool_input: { file_path: join(dir, 'a.ts') } });
  assert.equal(get().live!.text, 'reading a.ts');
  // UserPromptSubmit carries what waits on the card, once.
  await cards.addContext(card.id, [], 'Round money down.');
  const out = cards.appEvent(card.id, 'UserPromptSubmit', { session_id: 'app-00000001', prompt: 'go on' }) as { hookSpecificOutput: { additionalContext: string } };
  assert.match(out.hookSpecificOutput.additionalContext, /Round money down\./);
  assert.equal(cards.appEvent(card.id, 'UserPromptSubmit', { session_id: 'app-00000001', prompt: 'and again' }), null, 'sent once');
  cards.appEvent(card.id, 'Stop', { session_id: 'app-00000001', last_assistant_message: 'Should the label say Size guide or Sizing?' });
  assert.equal(get().live!.phase, 'needs', 'a turn ending on a question waits on you, as from a tab');
  assert.equal(cards.appEvent('gone', 'Stop', {}), null, 'a card deleted while its session ran is no error');
});

test('appHooks: every tracked event but PermissionRequest and SessionEnd, each answering with what `on` returns, never throwing', async () => {
  const seen: string[] = [];
  const hooks = appHooks((event, input) => {
    seen.push(`${event}:${input.tool_name ?? ''}`);
    if (event === 'Stop') throw new Error('boom');
    return event === 'UserPromptSubmit' ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'more' } } : null;
  });
  assert.deepEqual(Object.keys(hooks).sort(), [...APP_EVENTS].sort());
  assert.ok(!('PermissionRequest' in hooks) && !('SessionEnd' in hooks));
  const call = (event: keyof typeof hooks, input: object) => hooks[event]![0].hooks[0](input as never, undefined, { signal: new AbortController().signal });
  assert.deepEqual(await call('UserPromptSubmit', { prompt: 'x' }), { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'more' } });
  assert.deepEqual(await call('PreToolUse', { tool_name: 'Bash' }), {});
  const quiet = console.error;
  console.error = () => {};
  try { assert.deepEqual(await call('Stop', {}), {}, 'a failure is logged, and Claude carries on'); } finally { console.error = quiet; }
  assert.deepEqual(seen, ['UserPromptSubmit:', 'PreToolUse:Bash', 'Stop:']);
});

test('a broker request is the card’s ask until answered: a parallel tool’s PreToolUse doesn’t take it away (§93)', () => {
  const card = { ...seed(), runner: 'app' as const, sessionId: 'app-00000002', stage: 'build' as const, live: { phase: 'working' as const, text: 'x', at: 1 } };
  store.saveCard(card);
  const get = () => cards.get(card.id)!;
  cards.appEvent(card.id, 'PreToolUse', { session_id: 'app-00000002', tool_name: 'Bash', tool_input: { command: 'pnpm test' } });
  cards.appAsk('app-00000002', 'req-1', 'Bash', { command: 'pnpm test', description: 'Run the tests' });
  assert.deepEqual(askOf(get()), { kind: 'tool', tool: 'Bash', detail: 'running: Run the tests', requestId: 'req-1' });
  assert.equal(get().stage, 'needs');
  cards.appEvent(card.id, 'PreToolUse', { session_id: 'app-00000002', tool_name: 'Read', tool_input: { file_path: 'b.ts' } });
  assert.equal(askOf(get())?.requestId, 'req-1', 'still asking');
  assert.equal(get().live!.phase, 'needs');
  cards.askResolved('app-00000002', 'req-other');
  assert.equal(askOf(get())?.requestId, 'req-1', 'another request’s end changes nothing');
  cards.askResolved('app-00000002', 'req-1');
  assert.equal(askOf(get()), undefined);
  assert.equal(get().live!.text, 'Answered from here');
  // A plan, and a question form, the way the hooks would have said them.
  cards.appAsk('app-00000002', 'req-2', 'ExitPlanMode', { plan: '1. Do it' });
  assert.deepEqual(askOf(get()), { kind: 'plan', tool: 'ExitPlanMode', plan: '1. Do it', requestId: 'req-2' });
  cards.askResolved('app-00000002', 'req-2');
  cards.appAsk('app-00000002', 'req-3', 'AskUserQuestion', { questions: [{ question: 'Which?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }] }] });
  assert.equal(askOf(get())!.questions![0].options.length, 2);
  assert.equal(askOf(get())!.requestId, 'req-3');
  cards.appAsk('nobody', 'req-4', 'Bash', {});
  assert.equal(askOf(get())!.requestId, 'req-3', 'a session that is no card’s asks nothing of it');
});

test('after a server restart a working or asking app card waits, and says the next message resumes it (§93)', () => {
  const working = { ...seed(), runner: 'app' as const, sessionId: 'app-00000003', live: { phase: 'working' as const, text: 'editing a.ts', at: 1, turnSince: 1 } };
  const asking = { ...seed(), runner: 'app' as const, sessionId: 'app-00000004', live: { phase: 'needs' as const, text: 'x', at: 1, ask: { kind: 'tool' as const, tool: 'Bash', requestId: 'gone' } } };
  const idle = { ...seed(), runner: 'app' as const, sessionId: 'app-00000005', live: { phase: 'waiting' as const, text: 'Replied: hi', at: 1 } };
  const tab = { ...seed(), sessionId: 'tab-00000001', live: { phase: 'working' as const, text: 'in its tab', at: 1 } };
  for (const c of [working, asking, idle, tab]) store.saveCard(c);
  cards.afterRestart();
  for (const c of [working, asking]) {
    const after = cards.get(c.id)!;
    assert.equal(after.live!.phase, 'waiting');
    assert.equal(after.live!.text, 'The server restarted; the next message resumes the session');
    assert.equal(after.live!.ask, undefined, 'the request died with the server');
    assert.equal(after.live!.turnSince, undefined);
    assert.equal(after.boot.at(-1)!.text, 'The server restarted; the next message resumes the session');
  }
  assert.equal(cards.get(idle.id)!.live!.text, 'Replied: hi', 'one between turns stays as it was');
  assert.equal(cards.get(tab.id)!.live!.text, 'in its tab', 'a terminal card is its tab’s business');
});

test('/clear in an app session moves the card to the new id; what was added since goes again with the next message (§93)', async () => {
  const card = { ...seed(), runner: 'app' as const, sessionId: 'app-00000006' };
  store.saveCard(card);
  await cards.addContext(card.id, [], 'Use the blue button.');
  assert.ok(cards.takeWaiting(card.id)!.includes('Use the blue button.'));
  assert.equal(cards.takeWaiting(card.id), null, 'taken once');
  cards.followSession('app-00000006', 'app-00000007');
  const after = cards.get(card.id)!;
  assert.equal(after.sessionId, 'app-00000007');
  assert.equal(cards.bySession('app-00000007')!.id, card.id);
  assert.equal(after.later![0].sent, undefined, 'the fresh conversation hasn’t seen it');
  assert.match(after.boot.at(-1)!.text, /Fresh start \(\/clear\): linked session app-0000/);
  cards.followSession('not-a-card', 'x');
});

test('a card’s app session starts with its mode, its model and the packet in its system prompt', () => {
  const card: Card = { ...seed(), runner: 'app', sessionId: 'app-00000008', model: 'haiku', live: { phase: 'working', text: '', at: 1, mode: 'acceptEdits' } };
  const o = cards.sessionOptions(card);
  assert.equal(o.mode, 'acceptEdits', 'the mode it last reported');
  assert.equal(cards.sessionOptions({ ...card, live: undefined }).mode, 'plan', 'else the one it started with');
  assert.equal(o.options.model, 'haiku');
  const sp = o.options.systemPrompt as { type: string; preset: string; append: string };
  assert.equal(sp.preset, 'claude_code', 'Claude Code’s own prompt, with the packet after it');
  assert.match(sp.append, /^# Context from cc-control · CARD-9 Size guide/);
  assert.deepEqual(Object.keys(o.options.hooks as object).sort(), [...APP_EVENTS].sort());
});

test('y / n from here say so on the card at once; an approved plan moves it to Build (§93)', () => {
  const card = { ...seed(), runner: 'app' as const, sessionId: 'app-00000009', stage: 'plan' as const, live: { phase: 'working' as const, text: 'x', at: 1, mode: 'plan' } };
  store.saveCard(card);
  const get = () => cards.get(card.id)!;
  cards.appAsk('app-00000009', 'req-1', 'ExitPlanMode', { plan: '1. Do it' });
  assert.equal(get().live!.text, 'Plan ready: approve it with y', 'not “in the tab”');
  cards.answered(card.id, 'allow');
  assert.equal(get().stage, 'build');
  assert.equal(get().live!.text, 'Plan approved: building');
  assert.equal(get().live!.ask, undefined);
  cards.askResolved('app-00000009', 'req-1');
  assert.equal(get().live!.text, 'Plan approved: building', 'the broker settling after changes nothing');
  cards.appAsk('app-00000009', 'req-2', 'Bash', { command: 'mkdir x', description: 'Make x' });
  assert.equal(get().stage, 'needs');
  cards.answered(card.id, 'deny');
  assert.equal(get().live!.text, 'Denied Bash: Make x');
  assert.equal(get().stage, 'build', 'back to work: Claude carries on without it');
  // A turn stopped with Esc never reports Stop: the session going idle ends it on the card.
  store.saveCard({ ...get(), live: { ...get().live!, phase: 'working', turnSince: 5 } });
  cards.sessionIdle('app-00000009');
  assert.equal(get().live!.phase, 'waiting');
  assert.equal(get().live!.text, 'Stopped');
  cards.appEvent(card.id, 'Stop', { session_id: 'app-00000009', last_assistant_message: 'All done.' });
  cards.sessionIdle('app-00000009');
  assert.equal(get().live!.text, 'Replied: All done.', 'a turn that ended normally keeps what Stop said');
});
