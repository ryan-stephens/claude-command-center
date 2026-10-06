import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownerOfFile } from './history-index.ts';

const ID = '3a85637c-e7b9-45d5-890e-e27471357aa3';

test('a transcript file belongs to its session, a subagent’s to the session it ran in (§98)', () => {
  assert.equal(ownerOfFile(`D--repos-x\\${ID}.jsonl`), ID);
  assert.equal(ownerOfFile(`D--repos-x/${ID}.jsonl`), ID);
  assert.equal(ownerOfFile(`D--repos-x\\${ID}\\subagents\\agent-a1.jsonl`), ID);
  assert.equal(ownerOfFile(`D--repos-x\\${ID}`), null); // the folder itself
  assert.equal(ownerOfFile('D--repos-x\\notes.jsonl'), null);
  assert.equal(ownerOfFile(`${ID}.jsonl`), null); // not under a project folder
});
