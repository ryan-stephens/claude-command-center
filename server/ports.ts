// Local ports for Try it, picked per run (PLAN §54): every API a stack starts, and the UI, get a
// port of their own from a range, so two cards can run the same stack at once. A port is skipped
// while another run holds it or something on this machine already listens on it, and given back
// when the run stops. The range is CC_CONTROL_PORTS ("18000-18999" by default). A UI keeps its own
// port when it can, or takes one of CC_CONTROL_UI_PORTS, the ports registered for its sign-in (§122).

import { connect } from 'node:net';

export const DEFAULT_PORTS = '18000-18999';

/** "18000-18999" → [18000, 18999]. Anything else is the default. */
export function parseRange(s: string | undefined): [number, number] {
  const m = /^\s*(\d{2,5})\s*-\s*(\d{2,5})\s*$/.exec(s ?? '');
  const lo = m ? Number(m[1]) : 0;
  const hi = m ? Number(m[2]) : 0;
  if (!m || lo < 1024 || hi > 65535 || hi < lo + 9) return parseRange(DEFAULT_PORTS);
  return [lo, hi];
}

/** Is something listening on this port on this machine? */
export function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port });
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(500, () => done(false));
  });
}

/**
 * "4202, 4203-4204,4209" → [4202, 4203, 4204, 4209]: the ports a UI can sign in on (CC_CONTROL_UI_PORTS,
 * §122), in order, each once. Anything that isn't a port is left out; a range adds at most 50.
 */
export function parsePortList(s: string | undefined): number[] {
  const out: number[] = [];
  for (const part of (s ?? '').split(/[\s,;]+/)) {
    const m = /^(\d{2,5})(?:-(\d{2,5}))?$/.exec(part);
    if (!m) continue;
    const lo = Number(m[1]);
    const hi = Math.min(Number(m[2] ?? m[1]), lo + 49);
    for (let p = lo; p <= hi; p++) if (p >= 1024 && p <= 65535 && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Where the UI's port came from: its own (the project's), CC_CONTROL_UI_PORTS, or the range. */
export interface UiPortPick {
  port: number;
  from: 'home' | 'list' | 'range';
  /** What the run's output should say about it; none when the UI is on its own port. */
  note?: string;
  /** The front door it is behind (§123): the UI's own port, which cc-control holds. */
  door?: number;
}

export class PortPool {
  readonly range: [number, number];
  /** The ports a UI can sign in on besides its own (§122). */
  readonly uiPorts: number[];
  private held = new Set<number>();
  /** Who holds a UI's port (a card's key), to say so when none is left. */
  private holders = new Map<number, string>();

  constructor(range: [number, number] = parseRange(undefined), uiPorts: number[] = []) {
    this.range = range;
    this.uiPorts = uiPorts;
  }

  /** The ports runs hold right now. */
  taken(): number[] {
    return [...this.held].sort((a, b) => a - b);
  }

  /** `n` free ports, held until given back. Throws when the range has no room. */
  async take(n: number): Promise<number[]> {
    const out: number[] = [];
    for (let p = this.range[0]; p <= this.range[1] && out.length < n; p++) {
      // Held is checked again after the wait: another take running at once may have got it meanwhile (§114).
      if (this.held.has(p) || await listening(p) || this.held.has(p)) continue;
      this.held.add(p);
      out.push(p);
    }
    if (out.length < n) {
      this.free(out);
      throw new Error(`No free port left in ${this.range[0]}-${this.range[1]} (CC_CONTROL_PORTS): stop a run, or widen the range.`);
    }
    return out;
  }

  /**
   * The UI's port for a run (§122). A sign-in provider only sends you back to the addresses
   * registered with it, so a port from the range can't sign in. In order: the UI's own port (`home`,
   * the project's) when it's free; else the first free one of CC_CONTROL_UI_PORTS; else, when that
   * list is set, an error naming who holds each; else a port from the range, with a note saying
   * sign-in may refuse it. `who` (a card's key) is named when another card wants one it holds.
   */
  async takeUi(home: number | undefined, who: string): Promise<UiPortPick> {
    const wanted = [...new Set([...(home ? [home] : []), ...this.uiPorts])];
    const busy: number[] = [];
    for (const p of wanted) {
      // Held is checked again after the wait, as in take.
      if (this.held.has(p) || await listening(p) || this.held.has(p)) { busy.push(p); continue; }
      this.held.add(p);
      this.holders.set(p, who);
      if (p === home) return { port: p, from: 'home' };
      return { port: p, from: 'list', note: `(The UI’s own port, ${home ? `${home}, is in use by ${this.by(home)}` : 'isn’t known'}, so it runs on ${p} from CC_CONTROL_UI_PORTS.)` };
    }
    if (this.uiPorts.length) {
      throw new Error(`No sign-in port free for the UI: ${busy.map((p) => `${p} (${this.by(p)})`).join(', ')}. Stop one, or add one to CC_CONTROL_UI_PORTS.`);
    }
    const [port] = await this.take(1);
    const note = home
      ? `(The UI’s own port, ${home}, is in use by ${this.by(home)}, so it runs on ${port}. If the app signs in, its provider may refuse that port: list ports registered for sign-in in CC_CONTROL_UI_PORTS.)`
      : undefined;
    return { port, from: 'range', ...(note ? { note } : {}) };
  }

  /** Who holds a port, as takeUi says it. */
  private by(port: number): string {
    return this.holders.get(port) ?? 'something else on this machine';
  }

  free(ports: number[]): void {
    for (const p of ports) { this.held.delete(p); this.holders.delete(p); }
  }
}
