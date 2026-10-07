// Local ports for Try it, picked per run (PLAN §54): every API a stack starts, and the UI, get a
// port of their own from a range, so two cards can run the same stack at once. A port is skipped
// while another run holds it or something on this machine already listens on it, and given back
// when the run stops. The range is CC_CONTROL_PORTS ("18000-18999" by default).

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

export class PortPool {
  readonly range: [number, number];
  private held = new Set<number>();

  constructor(range: [number, number] = parseRange(undefined)) {
    this.range = range;
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

  free(ports: number[]): void {
    for (const p of ports) this.held.delete(p);
  }
}
