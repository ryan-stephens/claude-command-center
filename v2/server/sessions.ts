// v2's sessions, kept in one JSON file (~/.cc-control/v2/sessions.json, or CCV2_DIR). Each has a
// token the session's hooks and tools send back, so only that session can report or act as itself.
// The page never sees a token. Written whole through a temporary file and a rename.

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '../shared/types.ts';

export const V2_DIR = process.env.CCV2_DIR || join(homedir(), '.cc-control', 'v2');

interface Stored { session: Session; token: string }

export class SessionStore {
  private file: string;
  private items = new Map<string, Stored>();
  private changed: (s?: Session) => void;

  constructor(dir = V2_DIR, changed: (s?: Session) => void = () => {}) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'sessions.json');
    this.changed = changed;
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { sessions?: Stored[] };
        for (const s of raw.sessions ?? []) if (s?.session?.id && s.token) this.items.set(s.session.id, s);
      } catch (e) {
        // A broken file is kept as it is (renamed aside), never silently overwritten.
        renameSync(this.file, `${this.file}.broken-${Date.now()}`);
        console.error(`v2: sessions.json couldn't be read (${(e as Error).message}); started empty, the old file kept beside it.`);
      }
    }
  }

  list(): Session[] {
    return [...this.items.values()].map((s) => s.session).sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): Session | undefined {
    return this.items.get(id)?.session;
  }

  byKey(key: string): Session | undefined {
    return this.list().find((s) => s.key.toLowerCase() === key.toLowerCase());
  }

  /** Add a session; its id and token are made here. */
  add(s: Omit<Session, 'id'>): { session: Session; token: string } {
    const session: Session = { ...s, id: randomUUID() };
    const token = randomBytes(24).toString('hex');
    this.items.set(session.id, { session, token });
    this.save();
    this.changed(session);
    return { session, token };
  }

  token(id: string): string | undefined {
    return this.items.get(id)?.token;
  }

  /** Does this token belong to this session? */
  check(id: string, token: string): boolean {
    const t = this.items.get(id)?.token;
    if (!t || !token || t.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(t), Buffer.from(token));
  }

  update(id: string, change: (s: Session) => Session): Session | undefined {
    const it = this.items.get(id);
    if (!it) return undefined;
    it.session = change(it.session);
    this.save();
    this.changed(it.session);
    return it.session;
  }

  remove(id: string): void {
    if (!this.items.delete(id)) return;
    this.save();
    this.changed();
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ sessions: [...this.items.values()] }, null, 2));
    renameSync(tmp, this.file);
  }
}
