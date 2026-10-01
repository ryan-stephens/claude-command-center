// Claude Code asks, the first time it starts in a folder, whether to trust it, and remembers the
// answer per folder in ~/.claude.json (projects[<folder>].hasTrustDialogAccepted). A card's new
// worktrees are folders Claude Code has never seen, so every worktree card stops at that prompt in
// its tab. With the setting on (off by default; the Keys and hints dialog shows exactly this),
// cc-control marks the card's worktrees trusted before the tab opens. Nothing else in the file is
// touched, and it is written whole only when it read as JSON.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CLAUDE_JSON = join(homedir(), '.claude.json');

/** How Claude Code keys a folder: forward slashes, no trailing one. */
export function projectKey(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Mark folders trusted. Returns the ones newly marked (already-trusted ones are skipped). Throws
 * when the file can't be read as JSON, so a broken file is never overwritten.
 */
export function trustFolders(dirs: string[], file = CLAUDE_JSON): string[] {
  if (!dirs.length) return [];
  let data: Record<string, unknown> = {};
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${file} isn’t a JSON object.`);
    data = v as Record<string, unknown>;
  }
  const projects = (data.projects && typeof data.projects === 'object' && !Array.isArray(data.projects) ? data.projects : {}) as Record<string, Record<string, unknown>>;
  const marked: string[] = [];
  for (const dir of dirs) {
    const key = projectKey(dir);
    const p = projects[key] && typeof projects[key] === 'object' ? projects[key] : {};
    if (p.hasTrustDialogAccepted === true) continue;
    projects[key] = { ...p, hasTrustDialogAccepted: true };
    marked.push(dir);
  }
  if (!marked.length) return [];
  data.projects = projects;
  // Written beside, then renamed over: Claude Code reading mid-write sees the old file or the new one.
  const tmp = `${file}.cc-control-tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
  return marked;
}
