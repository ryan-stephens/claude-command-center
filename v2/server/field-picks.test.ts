import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '../shared/types.ts';
import { addedLines, cleanPicks, FieldPicks, mergePicks } from './field-picks.ts';

test('added lines only, not the file headers', () => {
  assert.equal(addedLines('+++ b/x.ts\n@@ -1 +1 @@\n-old CX.OLD.ONE\n+new CX.NEW.ONE\n'), 'new CX.NEW.ONE');
});

test('picks merge by id in any case, the first kept and filled in by later ones', () => {
  const m = mergePicks([{ id: 'CX.A', from: 'claude', why: 'the waiver flag' }], [{ id: 'cx.a', from: 'ticket', expect: 'Y' }, { id: 'CX.B', from: 'changes' }]);
  assert.deepEqual(m, [{ id: 'CX.A', from: 'claude', why: 'the waiver flag', expect: 'Y' }, { id: 'CX.B', from: 'changes' }]);
});

test('picks as sent: ids or { id, why, expect }, blanks dropped, a list required', () => {
  assert.deepEqual(cleanPicks(['CX.A', { id: ' CX.B ', why: ' set by the waiver ', expect: 0 }, { id: '' }], 'claude'), [{ id: 'CX.A', from: 'claude' }, { id: 'CX.B', from: 'claude', why: 'set by the waiver', expect: '0' }]);
  assert.throws(() => cleanPicks('CX.A', 'you'), /a list/);
});

test('a session’s fields: picked first, then the ticket’s, then the ones its worktree added (committed, changed or new)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccv2-picks-'));
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...a], { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'fees.ts'), 'export const old = "CX.OLD.FIELD";\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  git('checkout', '-q', '-b', 'work');
  writeFileSync(join(dir, 'fees.ts'), 'export const old = "CX.OLD.FIELD";\nexport const waived = read("CX.FEE.WAIVED");\n');
  git('commit', '-qam', 'waive');
  writeFileSync(join(dir, 'reason.ts'), 'export const reason = read("CX.WAIVER.REASON");\n');
  const s = {
    id: 's1', fieldPicks: [{ id: 'CX.FEE.WAIVED', from: 'claude', why: 'set when waived', expect: 'Y' }],
    ticket: { key: 'SHOP-1', title: 'Waive the fee', description: 'Show field 1000 on the page.', acceptance: ['CX.FEE.WAIVED is Y'], links: [] },
    repos: [{ repo: dir, name: 'fees', dir }],
  } as unknown as Session;
  const list = await new FieldPicks().list(s);
  assert.deepEqual(list.map((p) => [p.id, p.from]), [['CX.FEE.WAIVED', 'claude'], ['1000', 'ticket'], ['CX.WAIVER.REASON', 'changes']]);
});
