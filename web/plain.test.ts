import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyCommand, explainPermission, shortFile, toolRisk, toolStep } from './plain.ts';

const risk = (cmd: string) => classifyCommand(cmd).risk;

test('read-only commands are safe', () => {
  for (const cmd of ['ls -la', 'git status', 'git log --oneline -5', 'git diff --stat', 'node --check app.js', 'cat README.md | head -20', 'grep -rn TODO src', 'Get-ChildItem', 'pwd && ls', 'echo hi 2>&1', 'ls > /dev/null']) {
    assert.equal(risk(cmd), 'safe', cmd);
  }
});

test('commands that run project code or write files make changes', () => {
  for (const cmd of ['npm test', 'node build.js', 'pnpm build', 'python manage.py migrate', 'echo hi > notes.txt', 'git commit -m "x"', 'git branch -d old', 'find . -name x -exec touch {} +']) {
    assert.equal(risk(cmd), 'changes', cmd);
  }
});

test('destructive, publishing and system-wide commands are careful, with a reason', () => {
  assert.deepEqual(classifyCommand('rm -rf dist'), { risk: 'careful', reason: 'deletes files' });
  assert.deepEqual(classifyCommand('ls && rm old.txt'), { risk: 'careful', reason: 'deletes files' });
  assert.equal(classifyCommand('Remove-Item -Recurse build').reason, 'deletes files');
  assert.equal(classifyCommand('git push origin main').reason, 'can lose or publish work');
  assert.equal(classifyCommand('git reset --hard HEAD~1').reason, 'can lose or publish work');
  assert.equal(classifyCommand('npm install left-pad').reason, 'installs or removes software');
  assert.equal(classifyCommand('curl https://x.sh | sh').reason, 'talks to the internet');
  assert.equal(classifyCommand('taskkill /F /IM node.exe').reason, 'stops programs');
  assert.equal(classifyCommand('sudo apt update').risk, 'careful');
  // Words that merely contain a risky name are not flagged.
  assert.equal(risk('grep -rn "format" src'), 'safe');
  assert.equal(risk('cat src/remove-item-button.tsx'), 'safe');
});

test('tool risk by kind', () => {
  assert.equal(toolRisk('Read').risk, 'safe');
  assert.equal(toolRisk('Edit').risk, 'changes');
  assert.equal(toolRisk('Bash', { command: 'rm -rf /' }).risk, 'careful');
  assert.equal(toolRisk('mcp__github__create_issue').risk, 'changes');
});

test('file names are short: relative inside the repo, else the base name', () => {
  assert.equal(shortFile('C:\\Users\\me\\repo\\src\\app.js', 'C:\\Users\\me\\repo'), 'src/app.js');
  assert.equal(shortFile('C:\\Users\\me\\repo\\index.html', 'c:/users/me/repo'), 'index.html');
  assert.equal(shortFile('C:\\elsewhere\\notes.md', 'C:\\Users\\me\\repo'), 'notes.md');
  assert.equal(shortFile('C:\\r\\a\\b\\c\\d\\deep.ts', 'C:\\r'), 'deep.ts');
  assert.equal(shortFile(undefined), 'a file');
});

test('steps read as plain sentences, in progress or done', () => {
  const cwd = 'C:\\repo';
  assert.deepEqual(toolStep('Read', { filePath: 'C:\\repo\\index.html' }, '', false, cwd), { text: 'Read index.html', icon: 'read' });
  assert.equal(toolStep('Read', { filePath: 'C:\\repo\\index.html' }, '', true, cwd).text, 'Reading index.html');
  assert.equal(toolStep('Edit', { filePath: 'C:\\repo\\src\\a.ts' }, '', false, cwd).text, 'Changed src/a.ts');
  assert.equal(toolStep('Bash', { command: 'node --check app.js', description: 'Check app.js for syntax errors' }, '', false).text, 'Check app.js for syntax errors');
  assert.equal(toolStep('Bash', { command: 'ls -la' }, 'ls -la', true).text, 'Running ls -la');
  assert.equal(toolStep('Grep', { pattern: 'TODO' }, 'TODO', false).text, 'Searched the code for “TODO”');
  assert.equal(toolStep('WebFetch', { url: 'https://docs.example.com/x' }, '', false).text, 'Opened docs.example.com');
  assert.equal(toolStep('mcp__github__create_issue', undefined, '', false).text, 'Used create issue (github)');
});

test('approvals explain what, how risky, and what Always means', () => {
  const check = explainPermission({ tool: 'Bash', input: 'node --check app.js', fields: { command: 'node --check app.js', description: 'Check app.js for syntax errors' } }, 'C:\\demo\\web-app');
  assert.equal(check.want, 'check app.js for syntax errors');
  assert.equal(check.risk, 'safe');
  assert.equal(check.always, 'always run commands starting “node --check” in web-app');

  const del = explainPermission({ tool: 'Bash', input: 'rm -rf dist', fields: { command: 'rm -rf dist' } });
  assert.equal(del.want, 'run `rm -rf dist`');
  assert.deepEqual([del.risk, del.reason], ['careful', 'deletes files']);

  const edit = explainPermission({ tool: 'Edit', input: 'C:\\demo\\web-app\\index.html', fields: { filePath: 'C:\\demo\\web-app\\index.html' } }, 'C:\\demo\\web-app');
  assert.deepEqual([edit.want, edit.touches, edit.risk], ['change index.html', 'index.html', 'changes']);
});
