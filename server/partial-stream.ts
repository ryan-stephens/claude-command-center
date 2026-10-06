// What Claude is writing right now, to the pages that show it (PLAN §97). The session manager reports
// the whole reply so far on every token; sending that to every page was O(n²) bytes per reply and a
// store update per token on pages that didn't show it. Here each page gets only the session it has
// open (its last session.open), only what it hasn't got yet (`from`: where the new text goes), and
// at most one message per `every` ms per session: the first token at once, the rest coalesced.

export interface PartialMsg {
  id: string;
  text: string;
  /** Append `text` at this offset of what the page has; absent: `text` is all of it. */
  from?: number;
}

type Timer = unknown;

export class PartialFanout<C> {
  /** The reply so far, per session. */
  private text = new Map<string, string>();
  /** The session each client shows, and how much of its reply that client has. */
  private watching = new Map<C, { id: string; sent: number }>();
  /** Sessions whose next send waits for the window to pass. */
  private due = new Map<string, Timer>();
  private send: (c: C, msg: PartialMsg) => void;
  private every: number;
  private later: (fn: () => void, ms: number) => Timer;
  private cancel: (t: Timer) => void;

  constructor(send: (c: C, msg: PartialMsg) => void, every = 30, later: (fn: () => void, ms: number) => Timer = setTimeout, cancel: (t: Timer) => void = (t) => clearTimeout(t as NodeJS.Timeout)) {
    this.send = send;
    this.every = every;
    this.later = later;
    this.cancel = cancel;
  }

  /**
   * The client opened this session: from now on it gets its reply, starting with all of it so far
   * (even none: what the page kept from before may have landed while it looked elsewhere).
   */
  watch(c: C, id: string): void {
    const text = this.text.get(id) ?? '';
    this.watching.set(c, { id, sent: text.length });
    this.send(c, { id, text });
  }

  forget(c: C): void {
    this.watching.delete(c);
  }

  /** The session moved to a new id (/clear, a fork): whoever showed it shows the new one. */
  rename(oldId: string, newId: string): void {
    for (const w of this.watching.values()) if (w.id === oldId) { w.id = newId; w.sent = 0; }
    const t = this.text.get(oldId);
    if (t !== undefined) { this.text.delete(oldId); this.text.set(newId, ''); }
  }

  /** The reply so far ('' when a message landed or a new one starts). */
  update(id: string, text: string): void {
    this.text.set(id, text);
    if (!text) {
      // A clear goes at once: the message is landing, and the page must not show both.
      const t = this.due.get(id);
      if (t !== undefined) { this.cancel(t); this.due.delete(id); }
      for (const [c, w] of this.watching) if (w.id === id && w.sent) { w.sent = 0; this.send(c, { id, text: '' }); }
      return;
    }
    if (this.due.has(id)) return; // within the window: the timer sends it
    this.flush(id);
    this.arm(id);
  }

  private arm(id: string): void {
    this.due.set(id, this.later(() => {
      this.due.delete(id);
      // Something came in the window: send it and keep coalescing; nothing did: the next token goes at once.
      if (this.flush(id)) this.arm(id);
    }, this.every));
  }

  /** Send each watcher what it hasn't got. True when anything was sent. */
  private flush(id: string): boolean {
    const text = this.text.get(id) ?? '';
    let any = false;
    for (const [c, w] of this.watching) {
      if (w.id !== id || text.length === w.sent) continue;
      // The reply only grows between clears; shorter means the page's copy is from before one, so it gets all of it.
      this.send(c, text.length > w.sent ? { id, from: w.sent, text: text.slice(w.sent) } : { id, text });
      w.sent = text.length;
      any = true;
    }
    return any;
  }
}
