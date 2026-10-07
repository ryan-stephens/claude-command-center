// Live view of sessions this app doesn't run (open in a terminal): when one's transcript file
// changes, clients looking at it get it re-read. Tested in mirror.test.ts.
//
// §119: each client gets only what follows what it already has (`from`), not the whole transcript
// every time: a terminal writing into a long session sent the page about 1 MB a second, which the
// page parsed and merged several times a second. And a big transcript is re-read less often: the
// wait between reads grows with how long the last one took.

/** At most one re-read per session per this many ms, so a busy terminal doesn't flood the page. */
export const MIRROR_THROTTLE_MS = 700;
/** §119: the wait between re-reads is at least this many times as long as the last read took. */
export const MIRROR_COST_FACTOR = 5;

export interface MirrorDeps<C> {
  /** Read the session's transcript as it is now. */
  read(id: string): Promise<unknown[]>;
  /** Send it to one client: all of it, or (with `from`) what follows the first `from` items, which the client has. */
  send(client: C, id: string, items: unknown[], from?: number): void;
  /** Sessions this app runs itself stream their own updates; skip them. */
  owned(id: string): boolean;
  throttleMs?: number;
}

export class Mirror<C> {
  private watching = new Map<C, string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private last = new Map<string, number>();
  /** How long each session's last read took (§119). */
  private cost = new Map<string, number>();
  /** What each client has of the session it watches: its item count and the last item's uuid (§119). */
  private sent = new Map<C, { id: string; count: number; last?: string }>();
  private deps: MirrorDeps<C>;

  constructor(deps: MirrorDeps<C>) {
    this.deps = deps;
  }

  /** A client is looking at this session (the last one it opened). */
  watch(client: C, id: string): void {
    this.watching.set(client, id);
    if (this.sent.get(client)?.id !== id) this.sent.delete(client);
  }

  /** The client was just sent this session's transcript (when it opened it): later changes send what follows. */
  has(client: C, id: string, items: unknown[]): void {
    this.sent.set(client, { id, count: items.length, last: uuidOf(items[items.length - 1]) });
  }

  forget(client: C): void {
    this.watching.delete(client);
    this.sent.delete(client);
  }

  watchers(id: string): C[] {
    return [...this.watching].filter(([, w]) => w === id).map(([c]) => c);
  }

  /** The session's transcript file changed on disk. */
  changed(id: string, now = Date.now()): void {
    if (this.deps.owned(id) || !this.watchers(id).length || this.timers.has(id)) return;
    const gap = Math.max(this.deps.throttleMs ?? MIRROR_THROTTLE_MS, (this.cost.get(id) ?? 0) * MIRROR_COST_FACTOR);
    const wait = Math.max(0, (this.last.get(id) ?? 0) + gap - now);
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
    const t0 = Date.now();
    const items = await this.deps.read(id);
    this.cost.set(id, Date.now() - t0);
    for (const c of this.watchers(id)) {
      const had = this.sent.get(c);
      const n = had?.id === id ? had.count : 0;
      // What it has is still the start of the transcript: only what follows, and nothing when nothing does.
      if (n > 0 && n <= items.length && uuidOf(items[n - 1]) === had!.last) {
        if (n < items.length) this.deps.send(c, id, items.slice(n), n);
      } else this.deps.send(c, id, items);
      this.has(c, id, items);
    }
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

const uuidOf = (item: unknown): string | undefined => (item && typeof item === 'object' && typeof (item as { uuid?: unknown }).uuid === 'string' ? (item as { uuid: string }).uuid : undefined);

/** `<project>/<session id>.jsonl` → the session id; subagent and other files → null. */
export function sessionOfFile(file: string): string | null {
  const parts = file.split(/[\\/]/);
  if (parts.length !== 2) return null;
  const m = /^([0-9a-f-]{36})\.jsonl$/i.exec(parts[1]);
  return m ? m[1] : null;
}
