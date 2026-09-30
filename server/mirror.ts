// Live view of sessions this app doesn't run (open in a terminal): when one's transcript file
// changes, clients looking at it get it re-read. Tested in mirror.test.ts.

/** At most one re-read per session per this many ms, so a busy terminal doesn't flood the page. */
export const MIRROR_THROTTLE_MS = 700;

export interface MirrorDeps<C> {
  /** Read the session's transcript as it is now. */
  read(id: string): Promise<unknown[]>;
  /** Send it to one client. */
  send(client: C, id: string, items: unknown[]): void;
  /** Sessions this app runs itself stream their own updates; skip them. */
  owned(id: string): boolean;
  throttleMs?: number;
}

export class Mirror<C> {
  private watching = new Map<C, string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private last = new Map<string, number>();
  private deps: MirrorDeps<C>;

  constructor(deps: MirrorDeps<C>) {
    this.deps = deps;
  }

  /** A client is looking at this session (the last one it opened). */
  watch(client: C, id: string): void {
    this.watching.set(client, id);
  }

  forget(client: C): void {
    this.watching.delete(client);
  }

  watchers(id: string): C[] {
    return [...this.watching].filter(([, w]) => w === id).map(([c]) => c);
  }

  /** The session's transcript file changed on disk. */
  changed(id: string, now = Date.now()): void {
    if (this.deps.owned(id) || !this.watchers(id).length || this.timers.has(id)) return;
    const wait = Math.max(0, (this.last.get(id) ?? 0) + (this.deps.throttleMs ?? MIRROR_THROTTLE_MS) - now);
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      this.last.set(id, Date.now());
      this.push(id).catch((e: Error) => console.warn(`mirror ${id}: ${e.message}`));
    }, wait));
  }

  private async push(id: string): Promise<void> {
    if (this.deps.owned(id)) return;
    const clients = this.watchers(id);
    if (!clients.length) return;
    const items = await this.deps.read(id);
    for (const c of this.watchers(id)) this.deps.send(c, id, items);
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

/** `<project>/<session id>.jsonl` → the session id; subagent and other files → null. */
export function sessionOfFile(file: string): string | null {
  const parts = file.split(/[\\/]/);
  if (parts.length !== 2) return null;
  const m = /^([0-9a-f-]{36})\.jsonl$/i.exec(parts[1]);
  return m ? m[1] : null;
}
