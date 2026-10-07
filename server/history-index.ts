import { listSessions, type SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sessionOfFile } from './mirror.ts';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const LIST_LIMIT = 300;
const REFRESH_DEBOUNCE_MS = 1500;
/**
 * §119: a session the list has already, whose transcript only grows (a terminal writing it): the
 * list is read again at most this often. Reading it takes about 150 ms and goes to every page, and a
 * terminal writes many times a second. A new session still shows within REFRESH_DEBOUNCE_MS.
 */
const KNOWN_REFRESH_MS = 10_000;
/** A transcript written this recently by a process we don't own is probably open in a terminal. */
export const ACTIVE_ELSEWHERE_MS = 2 * 60_000;

/** The session a transcript file under `~/.claude/projects` belongs to: its own (`<project>/<id>.jsonl`) or one of its subagents' (`<project>/<id>/subagents/…`). */
export function ownerOfFile(file: string): string | null {
  const parts = file.split(/[\\/]/);
  const m = /^([0-9a-f-]{36})(\.jsonl)?$/i.exec(parts[1] ?? '');
  return m && (m[2] ? parts.length === 2 : parts.length > 2) ? m[1] : null;
}

/** Every Claude Code session on the machine, refreshed when `~/.claude/projects` changes. */
export class HistoryIndex {
  sessions: SDKSessionInfo[] = [];
  private byId = new Map<string, SDKSessionInfo>();
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private due = 0;
  private onChange: () => void;
  private onFile: (sessionId: string) => void;
  private running: (sessionId: string) => boolean;

  /**
   * `onFile`: a session's own transcript file was written (by us or by a terminal). `running`: the
   * app runs that session now, so it knows its state already: its writes (every message while it
   * streams) don't refresh the list (§98). Retiring it refreshes once.
   */
  constructor(onChange: () => void, onFile: (sessionId: string) => void = () => {}, running: (sessionId: string) => boolean = () => false) {
    this.onChange = onChange;
    this.onFile = onFile;
    this.running = running;
  }

  async start(): Promise<void> {
    await this.refresh();
    try {
      this.watcher = watch(PROJECTS_DIR, { recursive: true }, (_event, file) => {
        if (!file || !String(file).endsWith('.jsonl')) return;
        const id = sessionOfFile(String(file));
        if (id) this.onFile(id);
        const owner = ownerOfFile(String(file));
        if (!owner || !this.running(owner)) this.scheduleRefresh(owner && this.byId.has(owner) ? KNOWN_REFRESH_MS : REFRESH_DEBOUNCE_MS);
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

  /** Read the list again in `ms` (or sooner, if a read is already due sooner). */
  scheduleRefresh(ms = REFRESH_DEBOUNCE_MS): void {
    const due = Date.now() + ms;
    if (this.timer && this.due <= due) return;
    if (this.timer) clearTimeout(this.timer);
    this.due = due;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh().then(this.onChange, (e) => console.warn(`history refresh failed: ${e.message}`));
    }, ms);
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
