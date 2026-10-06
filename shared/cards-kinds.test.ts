import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultMessage, kindForTicket, launchLines, packetText, reportIn, TESTING_NOTES, WORKSPACE_NOTES, type CardDraft, type PrTarget } from './cards.ts';

const UI = 'D:/r/ui';
const PR: PrTarget = { number: 318, title: 'Point the proxy', url: 'https://tfs/pr/318', host: 'azure', source: 'feature/WSS-123-proxy', target: 'develop', repo: UI };
const draft = (over: Partial<CardDraft> = {}): CardDraft => ({
  title: 'Gift card balance', workspaceId: null,
  packet: {
    workspace: [
      { kind: 'repo', id: UI, label: 'ui', on: true },
      { kind: 'note', id: WORKSPACE_NOTES, label: 'Workspace notes', text: 'The UI proxies to Okteto.', on: true },
      { kind: 'note', id: TESTING_NOTES, label: 'How this team tests', text: 'Make a scenario with the scenario tool.', on: true },
    ],
    ticket: [], card: [], note: '',
  },
  launch: { home: UI, branch: 'current', mode: 'plan', message: '' },
  ...over,
});

test('a ticket’s status or view says what kind of card it makes', () => {
  assert.equal(kindForTicket({ status: 'Ready for QA', views: ['qa'] }), 'qa');
  assert.equal(kindForTicket({ status: 'In Progress', views: ['qa'] }), 'qa', 'came in only through the QA view');
  assert.equal(kindForTicket({ status: 'Ready for QA', views: ['mine', 'qa'] }), 'qa', 'the status says so too');
  assert.equal(kindForTicket({ status: 'In Code Review' }), 'review');
  assert.equal(kindForTicket({ status: 'In Progress' }), 'build');
  assert.equal(kindForTicket(null), 'build');
  assert.equal(defaultMessage('SHOP-149', 'plan', 'qa'), 'QA SHOP-149: start with the test plan.');
  assert.equal(defaultMessage('SHOP-162', 'plan', 'review'), 'Review SHOP-162.');
});

test('a QA card’s context: its job, the report heading to use, and how the team tests', () => {
  const t = packetText(draft({ kind: 'qa', pr: PR }), 'SHOP-149');
  assert.match(t, /## Your job: QA this ticket/);
  assert.match(t, /# QA report: SHOP-149/);
  assert.match(t, /The change: PR #318/);
  assert.match(t, /## Notes\nWorkspace notes:\nThe UI proxies to Okteto\./);
  assert.match(t, /## How this team tests\nMake a scenario/);
  assert.match(t, /Start with the test plan\. Don’t set up data/);
  assert.doesNotMatch(packetText(draft(), 'CARD-1'), /Your job/, 'development cards need no job section');
});

test('a review card: read-only, on the PR’s branch in a copy, and the diff to read', () => {
  const d = draft({ kind: 'review', pr: PR, launch: { home: UI, branch: 'pr', mode: 'plan', message: 'Review WSS-123.' } });
  const t = packetText(d, 'WSS-123', PR.source);
  assert.match(t, /Read, don’t change/);
  assert.match(t, /git diff origin\/develop\.\.\.HEAD/);
  assert.match(t, /You are on feature\/WSS-123-proxy\./);
  assert.match(t, /reply with your findings instead of presenting a plan/);
  const lines = launchLines(d, 'WSS-123');
  assert.equal(lines[0], `git -C ${UI} fetch origin feature/WSS-123-proxy develop`);
  assert.equal(lines[1], `git -C ${UI} worktree add --detach ${UI}-wss-123 origin/feature/WSS-123-proxy`);
  assert.ok(lines.at(-2)!.includes(`cwd ${UI}-wss-123,`), 'Claude starts in the copy');
  assert.ok(launchLines(d, 'WSS-123', undefined, true).at(-1)!.includes(`-d ${UI}-wss-123 `), 'so does a tab (legacy)');
  const none = packetText(draft({ kind: 'review' }), 'WSS-9');
  assert.match(none, /No pull request was found for WSS-9/);
});

test('the report in a message: from its heading on, with the result it states', () => {
  assert.equal(reportIn('Nothing to report yet.', 1), undefined);
  const r = reportIn('Done.\n\n## QA report: X-1\n**Result:** Blocked\n\nThe env was down.', 7)!;
  assert.equal(r.text, '## QA report: X-1\n**Result:** Blocked\n\nThe env was down.');
  assert.equal(r.result, 'Blocked');
  assert.equal(r.at, 7);
  assert.equal(reportIn('# Code review: X-2\nVerdict: Approve with suggestions', 1)!.result, 'Approve with suggestions');
});
