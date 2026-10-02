// The way into a card's terminal when channels aren't allowed (PLAN §87): the launcher that runs
// in each card's tab (hooks/cc-control-launch.ps1) polls here while `claude` runs, and types what
// it is handed into that console's input buffer, the way a person at the keyboard would. Each
// poll says the tab is alive; a message waits here until a poll takes it.

/** What the launcher types: a message (then Enter), or keys for a prompt (allow: 1; deny: Escape). */
export type Typed = { kind: 'text'; text: string } | { kind: 'keys'; keys: string[] };

/** A launcher that hasn't polled for this long is gone (its poll waits 25 s at most). */
const STALE_MS = 45_000;

export class Typist {
  private queues = new Map<string, { item: Typed; done: () => void }[]>();
  private polls = new Map<string, Set<(item: Typed | null) => void>>();
  private seen = new Map<string, number>();
  private wakers = new Map<string, Set<() => void>>();
  private state: (cardId: string, on: boolean) => void;
  private sweeper: NodeJS.Timeout | null = null;

  /** `state`: the card's tab can (or can no longer) be typed into from here. */
  constructor(state: (cardId: string, on: boolean) => void) {
    this.state = state;
  }

  /** Watch for launchers that stopped polling (the tab closed, claude exited). */
  start(): void {
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const [id, at] of this.seen) if (now - at > STALE_MS) { this.seen.delete(id); this.state(id, false); }
    }, 10_000);
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const set of this.polls.values()) for (const answer of set) answer(null);
    this.polls.clear();
  }

  /** Has the card's launcher polled lately? */
  alive(cardId: string): boolean {
    const at = this.seen.get(cardId);
    return at !== undefined && Date.now() - at <= STALE_MS;
  }

  /**
   * The launcher asks for the next thing to type: answered at once when something waits, else
   * when something arrives or after `waitMs`, with nothing. Every poll marks the tab alive.
   */
  poll(cardId: string, waitMs: number): Promise<Typed | null> {
    const first = !this.alive(cardId);
    this.seen.set(cardId, Date.now());
    if (first) this.state(cardId, true);
    for (const wake of this.wakers.get(cardId) ?? []) wake();
    this.wakers.delete(cardId);
    const q = this.queues.get(cardId);
    if (q?.length) { const { item, done } = q.shift()!; done(); return Promise.resolve(item); }
    return new Promise((resolve) => {
      const set = this.polls.get(cardId) ?? new Set<(item: Typed | null) => void>();
      const timer = setTimeout(() => { set.delete(answer); resolve(null); }, waitMs);
      const answer = (item: Typed | null) => { clearTimeout(timer); set.delete(answer); resolve(item); };
      set.add(answer);
      this.polls.set(cardId, set);
    });
  }

  /** Hand the launcher something to type; resolves once a poll took it, or rejects after `ms`. */
  send(cardId: string, item: Typed, ms = 20_000): Promise<void> {
    const waiting = this.polls.get(cardId);
    const taker = waiting && [...waiting][0];
    if (taker) { taker(item); return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const q = this.queues.get(cardId) ?? [];
      const entry = { item, done: () => { clearTimeout(timer); resolve(); } };
      const timer = setTimeout(() => {
        const list = this.queues.get(cardId) ?? [];
        const i = list.indexOf(entry);
        if (i >= 0) list.splice(i, 1);
        reject(new Error('Its tab didn’t take the message: the launcher there isn’t answering. Look at the tab (g).'));
      }, ms);
      q.push(entry);
      this.queues.set(cardId, q);
    });
  }

  /** Resolves once the card's launcher polls (at once if it is alive), or rejects after `ms`. */
  waitFor(cardId: string, ms: number): Promise<void> {
    if (this.alive(cardId)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.wakers.get(cardId)?.delete(wake); reject(new Error('The tab opened, but nothing in it answered. Look at the tab (g).')); }, ms);
      const wake = () => { clearTimeout(timer); resolve(); };
      const set = this.wakers.get(cardId) ?? new Set<() => void>();
      set.add(wake);
      this.wakers.set(cardId, set);
    });
  }

  /** The server is going away: every card is told its tab can't be typed into. */
  forgetAll(): void {
    for (const id of this.seen.keys()) this.state(id, false);
    this.seen.clear();
  }
}
