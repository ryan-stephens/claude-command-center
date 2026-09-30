import { listSessions, type SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sessionOfFile } from './mirror.ts';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const LIST_LIMIT = 300;
const REFRESH_DEBOUNCE_MS = 1500;
/** A transcript written this recently by a process we don't own is probably open in a terminal. */
export const ACTIVE_ELSEWHERE_MS = 2 * 60_000;

/** Every Claude Code session on the machine, refreshed when `~/.claude/projects` changes. */
export class HistoryIndex {
  sessions: SDKSessionInfo[] = [];
  private byId = new Map<string, SDKSessionInfo>();
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private onChange: () => void;
  private onFile: (sessionId: string) => void;

  /** `onFile`: a session's own transcript file was written (by us or by a terminal). */
  constructor(onChange: () => void, onFile: (sessionId: string) => void = () => {}) {
    this.onChange = onChange;
    this.onFile = onFile;
  }

  async start(): Promise<void> {
    await this.refresh();
    try {
      this.watcher = watch(PROJECTS_DIR, { recursive: true }, (_event, file) => {
        if (!file || !String(file).endsWith('.jsonl')) return;
        this.scheduleRefresh();
        const id = sessionOfFile(String(file));
        if (id) this.onFile(id);
      });
    } catch (e) {
      console.warn(`history: cannot watch ${PROJECTS_DIR}: ${(e as Error).message}`);
    }
  }

  stop(): void {
    this.watcher?.close();
    if (this.timer) clearTimeout(this.timer);
  }

  get(id: string): SDKSessionInfo | undefined {
    return this.byId.get(id);
  }

  scheduleRefresh(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh().then(this.onChange, (e) => console.warn(`history refresh failed: ${e.message}`));
    }, REFRESH_DEBOUNCE_MS);
  }

  async refresh(): Promise<void> {
    this.sessions = await listSessions({ limit: LIST_LIMIT });
    this.byId = new Map(this.sessions.map((s) => [s.sessionId, s]));
  }

  /** Distinct working directories, most recently used first. */
  repos(): string[] {
    const seen = new Set<string>();
    for (const s of this.sessions) if (s.cwd) seen.add(s.cwd);
    return [...seen];
  }
}
