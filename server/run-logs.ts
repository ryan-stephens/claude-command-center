// Try it's output on disk, for the card's Claude to read (PLAN §117). Each run of a card's app or
// of a stack's service writes its output, as it comes, to <runs>/logs/<card key>/<service>.log; the
// run before is kept as <service>.prev.log. The card's session in the app can read that folder (it
// is one of its directories) and its system prompt says where it is, so Claude can look through the
// API's or the UI's output while you debug, without you pasting it.

import { appendFile, appendFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A file grown past this starts over, the full one kept as .prev (the run before is then gone). */
export const LOG_FILE_MAX = 10 * 1024 * 1024;

/** A card's logs folder: by its key (SHOP-155), which is what people and Claude know it by. */
export function cardLogsDir(runsDir: string, key: string): string {
  return join(runsDir, 'logs', key.replace(/[^A-Za-z0-9._-]+/g, '_') || 'card');
}

/** The file a service writes: an API by its repo name, the UI as ui, a card's own app as app. */
export function logName(service?: string): string {
  return (service ?? 'app').replace(/[^A-Za-z0-9._-]+/g, '_');
}

/** HH:MM:SS.mmm in local time: what a person lines up with what they did. */
function stamp(t: number): string {
  const d = new Date(t);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/**
 * One run's log file. Opened when the run starts (the last run's file becomes .prev), written in
 * small batches so a chatty server doesn't write per line, and closed with the run.
 */
export class RunLogFile {
  readonly path: string;
  private buf: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private bytes = 0;

  constructor(dir: string, service: string | undefined, header: string) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, `${logName(service)}.log`);
    const prev = join(dir, `${logName(service)}.prev.log`);
    if (existsSync(this.path)) { rmSync(prev, { force: true }); renameSync(this.path, prev); }
    const first = `# ${header} · started ${new Date().toISOString()}\n`;
    writeFileSync(this.path, first);
    this.bytes = Buffer.byteLength(first);
  }

  /** A line of the run's output: `$ command` where a step starts, the step's number before each. */
  line(t: number, step: number, text: string): void {
    this.buf.push(`${stamp(t)} [${step + 1}] ${text}\n`);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 250);
  }

  /** Write what is waiting; `sync` when the run ends (the server may be going away, and the last lines say how it ended). */
  flush(sync = false): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.buf.length) return;
    const text = this.buf.join('');
    this.buf = [];
    this.bytes += Buffer.byteLength(text);
    if (this.bytes > LOG_FILE_MAX) {
      // Too big: the full one becomes .prev, and this run carries on in a fresh file.
      const prev = this.path.replace(/\.log$/, '.prev.log');
      try { rmSync(prev, { force: true }); renameSync(this.path, prev); writeFileSync(this.path, `# continued (the earlier part is in ${prev})\n`); } catch { /* keep appending */ }
      this.bytes = Buffer.byteLength(text);
    }
    if (sync) { try { appendFileSync(this.path, text); } catch { /* the run is over either way */ } } else appendFile(this.path, text, () => {});
  }
}
