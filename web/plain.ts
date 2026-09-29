// Plain language for everything Claude does: tool steps, approvals and how risky they are.
// Pure, so every label is tested (plain.test.ts) and shared by the transcript, the activity
// line, approval cards and the home preview.

import type { PermissionRequest, ToolFields } from '../shared/protocol.ts';
import { isInside, repoName } from '../shared/workspaces.ts';

export type Risk = 'safe' | 'changes' | 'careful';
export type StepIcon = 'read' | 'edit' | 'run' | 'search' | 'web' | 'agent' | 'plan' | 'tool';

/** "index.html", or "src/app.js" when the file sits under `cwd`. Never a full Windows path. */
export function shortFile(path: string | undefined, cwd?: string): string {
  if (!path) return 'a file';
  if (cwd && isInside(path, cwd)) {
    const rel = path.slice(cwd.replace(/[\\/]+$/, '').length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
    if (rel && rel.split('/').length <= 3) return rel;
  }
  return repoName(path);
}

function clip(s: string, max = 70): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Claude's Bash descriptions are imperative ("Check app.js for errors"); lower-case the first letter to follow "wants to". */
function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

function host(url: string | undefined): string {
  try { return new URL(url ?? '').host || 'a web page'; } catch { return 'a web page'; }
}

/** "mcp__github__create_issue" → { server: "github", tool: "create issue" }. */
function mcpParts(name: string): { server: string; tool: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? { server: m[1].replace(/[_-]+/g, ' '), tool: m[2].replace(/[_-]+/g, ' ') } : null;
}

// ---- Shell command risk -------------------------------------------------------------

// Matched against the start of each command in a line (see parts()), so `grep format` is not a disk format.
const CAREFUL_RULES: [RegExp, string][] = [
  [/^(rm|rmdir|del|erase|rd|unlink|remove-item|ri)\b|^find\b.*\s-delete\b|shutil\.rmtree/i, 'deletes files'],
  [/^git\s+(push|reset\s+--hard|clean\b|checkout\s+--\s|rebase|filter-branch|stash\s+(drop|clear))/i, 'can lose or publish work'],
  [/^git\s+branch\s+(-D|--delete\s+--force)\b/, 'can lose or publish work'],
  [/^(npm|pnpm|yarn|bun|pip3?|poetry|gem|cargo|go|brew|choco|winget|scoop|apt(-get)?|dnf|yum)\s+(install|i|add|remove|uninstall|rm|update|upgrade|get)\b/i, 'installs or removes software'],
  [/^(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b/i, 'talks to the internet'],
  [/^(sudo|runas)\b|^start-process\b.*-verb\s+runas/i, 'runs as administrator'],
  [/^(kill|pkill|killall|taskkill|stop-process)\b/i, 'stops programs'],
  [/^(mkfs|format|diskpart|dd)\b/i, 'touches whole disks'],
  [/^(chmod|chown|icacls|takeown)\b/i, 'changes file permissions'],
  [/^(docker|kubectl|terraform|helm)\b/i, 'changes containers or infrastructure'],
  [/^(npm|pnpm|yarn)\s+(run\s+)?(deploy|publish)\b|^(vercel|netlify|firebase|flyctl|fly|wrangler)\b.*\bdeploy\b|^gh\s+(pr\s+merge|release|repo\s+delete)/i, 'publishes or deploys'],
  [/^(reg\s+(add|delete)|setx)\b/i, 'changes system settings'],
];

// First words of commands that only look at things.
const READ_ONLY = new Set([
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'less', 'more', 'pwd', 'cd', 'echo', 'which', 'where', 'whoami', 'date',
  'grep', 'rg', 'findstr', 'find', 'wc', 'tree', 'stat', 'file', 'du', 'df', 'env', 'printenv', 'sort', 'uniq', 'diff',
  'get-childitem', 'get-content', 'get-location', 'get-item', 'select-string', 'test-path', 'get-command',
]);
const READ_ONLY_GIT = /^git\s+(status|log|diff|show|branch(\s+(-a|-r|--list|-v+))*\s*$|remote(\s+-v)?\s*$|rev-parse|ls-files|blame|describe|tag\s*$|config\s+--get)/i;
const READ_ONLY_OTHER = /^(node|python3?|npx\s+tsc)\s+(--check|-c\s+['"]?import|--noEmit|--version|-v|-V)\b|^(node|npm|pnpm|yarn|python3?|git|tsc)\s+(--version|-v|-V)\s*$|^npx\s+tsc\s+--noEmit/i;

/** Split a shell line into its commands, so `ls && rm -rf x` is judged by its riskiest part. */
function parts(command: string): string[] {
  return command.split(/&&|\|\||;|\|(?!\|)|\n/)
    // "(cd x && …", "FOO=1 cmd": judge the command itself.
    .map((p) => p.trim().replace(/^[({]\s*/, '').replace(/^(\w+=\S*\s+)+/, ''))
    .filter(Boolean);
}

export function classifyCommand(command: string): { risk: Risk; reason: string } {
  for (const p of parts(command)) {
    for (const [re, reason] of CAREFUL_RULES) if (re.test(p)) return { risk: 'careful', reason };
  }
  // Writing into a file (but not into /dev/null or 2>&1) changes things.
  if (/(^|[^0-9&])>{1,2}\s*(?!\/dev\/null|&|\$null|nul\b)\S/i.test(command)) return { risk: 'changes', reason: 'writes to a file' };
  const safe = parts(command).every((p) => {
    const first = p.split(/\s+/)[0].toLowerCase();
    if (first === 'find' && /\s-(exec|delete)\b/.test(p)) return false;
    return READ_ONLY.has(first) || READ_ONLY_GIT.test(p) || READ_ONLY_OTHER.test(p);
  });
  return safe ? { risk: 'safe', reason: 'only looks' } : { risk: 'changes', reason: 'runs code in your project' };
}

// ---- Tools ------------------------------------------------------------------------

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'TodoWrite', 'ExitPlanMode', 'BashOutput', 'ListMcpResourcesTool', 'ReadMcpResourceTool']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

export function toolRisk(name: string, fields?: ToolFields): { risk: Risk; reason: string } {
  if (SHELL_TOOLS.has(name)) return classifyCommand(fields?.command ?? '');
  if (READ_TOOLS.has(name)) return { risk: 'safe', reason: 'only looks' };
  if (EDIT_TOOLS.has(name)) return { risk: 'changes', reason: 'edits files' };
  if (name === 'KillShell' || name === 'KillBash') return { risk: 'changes', reason: 'stops a running command' };
  if (name === 'Task' || name === 'Agent') return { risk: 'safe', reason: 'its own actions still ask you' };
  return { risk: 'changes', reason: 'uses another tool' };
}

export const RISK_LABEL: Record<Risk, string> = { safe: 'Safe', changes: 'Makes changes', careful: 'Careful' };

/**
 * One line for a tool call in the transcript and the activity line.
 * `active`: "Reading index.html" while it runs, "Read index.html" once done.
 */
export function toolStep(name: string, fields: ToolFields | undefined, input: string, active: boolean, cwd?: string): { text: string; icon: StepIcon } {
  const file = shortFile(fields?.filePath, cwd);
  const pick = (doing: string, done: string) => (active ? doing : done);
  switch (name) {
    case 'Read': case 'NotebookRead': return { text: `${pick('Reading', 'Read')} ${file}`, icon: 'read' };
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return { text: `${pick('Changing', 'Changed')} ${file}`, icon: 'edit' };
    case 'Write': return { text: `${pick('Writing', 'Wrote')} ${file}`, icon: 'edit' };
    case 'Glob': return { text: `${pick('Looking for', 'Looked for')} files matching ${clip(fields?.pattern ?? input, 40)}`, icon: 'search' };
    case 'Grep': return { text: `${pick('Searching', 'Searched')} the code for “${clip(fields?.pattern ?? input, 40)}”`, icon: 'search' };
    case 'LS': return { text: `${pick('Listing', 'Listed')} the files in ${file}`, icon: 'search' };
    case 'WebFetch': return { text: `${pick('Opening', 'Opened')} ${host(fields?.url)}`, icon: 'web' };
    case 'WebSearch': return { text: `${pick('Searching', 'Searched')} the web for “${clip(input, 50)}”`, icon: 'web' };
    case 'Task': case 'Agent': return { text: `${pick('Helper working on', 'Helper worked on')}: ${clip(fields?.description ?? input, 60)}`, icon: 'agent' };
    case 'TodoWrite': return { text: pick('Updating the to-do list', 'Updated the to-do list'), icon: 'plan' };
    case 'ExitPlanMode': return { text: pick('Proposing a plan', 'Proposed a plan'), icon: 'plan' };
    case 'Bash': case 'PowerShell': {
      if (fields?.description) return { text: clip(fields.description, 80), icon: 'run' };
      return { text: `${pick('Running', 'Ran')} ${clip(fields?.command ?? input, 60)}`, icon: 'run' };
    }
  }
  const mcp = mcpParts(name);
  if (mcp) return { text: `${pick('Using', 'Used')} ${mcp.tool} (${mcp.server})`, icon: 'tool' };
  return { text: `${pick('Using', 'Used')} ${name}`, icon: 'tool' };
}

export interface Explanation {
  /** Finishes "Claude wants to …". */
  want: string;
  risk: Risk;
  /** Why it got that rating, e.g. "deletes files". */
  reason: string;
  /** The file or folder it acts on, when there is one. */
  touches?: string;
  /** What "Always" would allow, in words. */
  always: string;
}

/** Everything an approval card says, from the raw request. */
export function explainPermission(req: Pick<PermissionRequest, 'tool' | 'input' | 'fields'>, cwd?: string): Explanation {
  const f = req.fields;
  const { risk, reason } = toolRisk(req.tool, f);
  const where = cwd ? ` in ${repoName(cwd)}` : '';
  const file = f?.filePath ? shortFile(f.filePath, cwd) : undefined;
  switch (req.tool) {
    case 'Bash': case 'PowerShell': {
      const cmd = clip(f?.command ?? req.input, 60);
      return {
        want: f?.description ? lowerFirst(clip(f.description, 90)) : `run \`${cmd}\``,
        risk, reason,
        always: `always run commands starting “${clip((f?.command ?? req.input).split(/\s+/).slice(0, 2).join(' '), 30)}”${where}`,
      };
    }
    case 'Edit': case 'MultiEdit': case 'NotebookEdit':
      return { want: `change ${file}`, risk, reason, touches: file, always: `always edit files${where}` };
    case 'Write':
      return { want: `create or replace ${file}`, risk, reason, touches: file, always: `always edit files${where}` };
    case 'Read':
      return { want: `read ${file}`, risk, reason, touches: file, always: 'always read files like this' };
    case 'WebFetch':
      return { want: `open ${host(f?.url)}`, risk, reason, always: `always open ${host(f?.url)}` };
    case 'WebSearch':
      return { want: `search the web for “${clip(req.input, 50)}”`, risk, reason, always: 'always search the web' };
    case 'Glob': case 'Grep':
      return { want: `search the files for “${clip(f?.pattern ?? req.input, 40)}”`, risk, reason, always: 'always search files' };
    case 'Task': case 'Agent':
      return { want: `start a helper to ${lowerFirst(clip(f?.description ?? req.input, 60))}`, risk, reason, always: 'always start helpers' };
    case 'ExitPlanMode':
      return { want: 'stop planning and start making changes', risk, reason, always: 'always accept plans' };
  }
  const mcp = mcpParts(req.tool);
  if (mcp) return { want: `use “${mcp.tool}” from ${mcp.server}`, risk, reason, always: `always allow ${mcp.tool}` };
  return { want: `use ${req.tool}`, risk, reason, always: `always allow ${req.tool}` };
}
