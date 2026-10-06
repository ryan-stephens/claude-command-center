import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, join } from 'node:path';

/** claude.exe on PATH, so Windows Terminal starts the same one a terminal would. */
export function findClaude(): string {
  if (process.env.CC_CONTROL_CLAUDE) return process.env.CC_CONTROL_CLAUDE;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const exe = join(dir, 'claude.exe');
    if (dir && existsSync(exe)) return exe;
  }
  return 'claude';
}

/** The CLI the SDK ships for this machine (an optional dependency), if it was installed. */
export function bundledClaude(): string | undefined {
  const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  try {
    const exe = createRequire(import.meta.resolve('@anthropic-ai/claude-agent-sdk')).resolve(`${pkg}/claude${process.platform === 'win32' ? '.exe' : ''}`);
    return existsSync(exe) ? exe : undefined;
  } catch {
    return undefined;
  }
}

let sdkExe: { path?: string } | undefined;
/**
 * The CLI the SDK's sessions run, as `pathToClaudeCodeExecutable`. CC_CONTROL_CLAUDE wins; then the
 * SDK's own binary (undefined: the SDK finds it). An install that skipped optional dependencies (a
 * company npm feed often does) has none, so it falls back to the Claude Code on PATH rather than failing.
 */
export function sdkClaude(): string | undefined {
  if (!sdkExe) {
    if (process.env.CC_CONTROL_CLAUDE) sdkExe = { path: process.env.CC_CONTROL_CLAUDE };
    else if (bundledClaude()) sdkExe = {};
    else {
      const onPath = findClaude();
      sdkExe = { path: onPath === 'claude' ? undefined : onPath };
    }
  }
  return sdkExe.path;
}
