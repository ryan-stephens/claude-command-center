import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { Card } from '../shared/cards.ts';
import { DEFAULT_PROMPTS, type SavedPrompt } from '../shared/prompts.ts';
import type { CommandPack, Settings, Workspace } from '../shared/protocol.ts';
import { emptyPack, STARTER_PACK, validatePack } from './packs.ts';

// node:sqlite prints an ExperimentalWarning on load. It's built in and works; keep the console clean.
const defaultWarning = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  for (const l of defaultWarning) l(w);
});
const { DatabaseSync } = await import('node:sqlite');

export const DB_PATH = process.env.CC_CONTROL_DB || join(homedir(), '.cc-control', 'cc-control.db');

/** One SQLite file for everything cc-control owns: commands, settings, workspaces, per-session extra repos and Ticket Line cards. */
export class Store {
  private db: DatabaseSyncType;

  constructor(path = DB_PATH) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS command_groups (name TEXT PRIMARY KEY, position INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (
        group_name TEXT NOT NULL REFERENCES command_groups(name) ON DELETE CASCADE,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 9),
        label TEXT NOT NULL,
        body TEXT NOT NULL,
        mode TEXT NOT NULL,
        PRIMARY KEY (group_name, slot)
      );
      CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, position INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_commands (workspace_id TEXT PRIMARY KEY, pack TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS session_dirs (session_id TEXT PRIMARY KEY, dirs TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, created INTEGER NOT NULL, token TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS prompts (id TEXT PRIMARY KEY, position INTEGER NOT NULL, data TEXT NOT NULL);
    `);
    this.db.exec('PRAGMA foreign_keys = ON');
    if (!this.db.prepare("SELECT 1 FROM meta WHERE key = 'seeded'").get()) {
      this.saveGlobalPack(STARTER_PACK);
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', ?)").run(new Date().toISOString());
    }
    // The three starting prompts, written once so they are editable (and deletable) like any other.
    if (!this.getMeta('prompts.seeded')) {
      const now = Date.now();
      for (const p of DEFAULT_PROMPTS) this.savePrompt({ ...p, id: crypto.randomUUID(), updatedAt: now });
      this.setMeta('prompts.seeded', new Date(now).toISOString());
    }
    // §69: the defaults gained blank lines between their parts. A seeded prompt whose words are still the default's gets the new spacing, once; an edited one is left alone.
    if (!this.getMeta('prompts.spaced')) {
      const words = (s: string) => s.replace(/\s+/g, ' ').trim();
      for (const p of this.loadPrompts()) {
        const d = DEFAULT_PROMPTS.find((x) => x.name === p.name);
        if (d && words(d.body) === words(p.body) && d.body !== p.body) this.savePrompt({ ...p, body: d.body });
      }
      this.setMeta('prompts.spaced', new Date().toISOString());
    }
  }

  loadPrompts(): SavedPrompt[] {
    const rows = this.db.prepare('SELECT id, data FROM prompts ORDER BY position').all() as { id: string; data: string }[];
    return rows.flatMap((r) => {
      try { return [{ ...(JSON.parse(r.data) as Omit<SavedPrompt, 'id'>), id: r.id }]; } catch { return []; }
    });
  }

  /** Insert or replace; a new prompt goes to the end. */
  savePrompt(p: SavedPrompt): void {
    const { id, ...data } = p;
    const pos = (this.db.prepare('SELECT position FROM prompts WHERE id = ?').get(id) as { position: number } | undefined)?.position
      ?? ((this.db.prepare('SELECT MAX(position) AS m FROM prompts').get() as { m: number | null }).m ?? -1) + 1;
    this.db.prepare('INSERT INTO prompts (id, position, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
      .run(id, pos, JSON.stringify(data));
  }

  deletePrompt(id: string): void {
    this.db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }

  getMeta(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  loadSettings(): Settings {
    const settings: Record<string, unknown> = {};
    for (const row of this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]) {
      try { settings[row.key] = JSON.parse(row.value); } catch { /* skip a corrupt row */ }
    }
    return settings as Settings;
  }

  saveSettings(settings: Settings): void {
    const upsert = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [key, value] of Object.entries(settings)) upsert.run(key, JSON.stringify(value));
  }

  loadGlobalPack(): CommandPack {
    const groups = this.db.prepare('SELECT name FROM command_groups ORDER BY position').all() as { name: string }[];
    const rows = this.db.prepare('SELECT group_name, slot, label, body, mode FROM commands ORDER BY slot').all() as {
      group_name: string; slot: number; label: string; body: string; mode: string;
    }[];
    const pack = emptyPack();
    for (const g of groups) {
      pack.groups.push({
        name: g.name,
        commands: rows.filter((r) => r.group_name === g.name).map((r) => ({ slot: r.slot, label: r.label, body: r.body, mode: r.mode as never })),
      });
    }
    return validatePack(pack);
  }

  /** Replace the whole global scope. It's a few dozen rows, so rewriting is simpler than diffing. */
  saveGlobalPack(pack: CommandPack): void {
    const insertGroup = this.db.prepare('INSERT INTO command_groups (name, position) VALUES (?, ?)');
    const insertCommand = this.db.prepare('INSERT INTO commands (group_name, slot, label, body, mode) VALUES (?, ?, ?, ?, ?)');
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM commands; DELETE FROM command_groups;');
      pack.groups.forEach((g, i) => {
        insertGroup.run(g.name, i);
        for (const c of g.commands) insertCommand.run(g.name, c.slot, c.label, c.body, c.mode ?? 'send');
      });
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  loadWorkspaces(): Workspace[] {
    const rows = this.db.prepare('SELECT id, data FROM workspaces ORDER BY position').all() as { id: string; data: string }[];
    return rows.flatMap((r) => {
      try { return [{ ...(JSON.parse(r.data) as Omit<Workspace, 'id'>), id: r.id }]; } catch { return []; }
    });
  }

  /** Insert or replace; a new workspace goes to the end. */
  saveWorkspace(w: Workspace): void {
    const { id, ...data } = w;
    const pos = (this.db.prepare('SELECT position FROM workspaces WHERE id = ?').get(id) as { position: number } | undefined)?.position
      ?? ((this.db.prepare('SELECT MAX(position) AS m FROM workspaces').get() as { m: number | null }).m ?? -1) + 1;
    this.db.prepare('INSERT INTO workspaces (id, position, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
      .run(id, pos, JSON.stringify(data));
  }

  deleteWorkspace(id: string): void {
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM workspace_commands WHERE workspace_id = ?').run(id);
  }

  loadWorkspacePack(id: string): CommandPack | null {
    const row = this.db.prepare('SELECT pack FROM workspace_commands WHERE workspace_id = ?').get(id) as { pack: string } | undefined;
    if (!row) return null;
    try { return validatePack(JSON.parse(row.pack)); } catch { return null; }
  }

  saveWorkspacePack(id: string, pack: CommandPack): void {
    this.db.prepare('INSERT INTO workspace_commands (workspace_id, pack) VALUES (?, ?) ON CONFLICT(workspace_id) DO UPDATE SET pack = excluded.pack')
      .run(id, JSON.stringify(pack));
  }

  /** Extra repos a session works in, kept so a resume (even after a restart) gets them back. */
  sessionDirs(id: string): string[] {
    const row = this.db.prepare('SELECT dirs FROM session_dirs WHERE session_id = ?').get(id) as { dirs: string } | undefined;
    try { return row ? (JSON.parse(row.dirs) as string[]) : []; } catch { return []; }
  }

  setSessionDirs(id: string, dirs: string[]): void {
    if (!dirs.length) this.db.prepare('DELETE FROM session_dirs WHERE session_id = ?').run(id);
    else this.db.prepare('INSERT INTO session_dirs (session_id, dirs) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET dirs = excluded.dirs').run(id, JSON.stringify(dirs));
  }

  librarySources(): string[] {
    try { return JSON.parse(this.getMeta('library.sources') ?? '[]') as string[]; } catch { return []; }
  }

  setLibrarySources(sources: string[]): void {
    this.setMeta('library.sources', JSON.stringify(sources));
  }

  loadCards(): Card[] {
    const rows = this.db.prepare('SELECT id, data FROM cards ORDER BY created').all() as { id: string; data: string }[];
    return rows.flatMap((r) => {
      try { return [{ ...(JSON.parse(r.data) as Card), id: r.id }]; } catch { return []; }
    });
  }

  /** Insert or update. The token (what the card's hook proves itself with) is set once, on insert. */
  saveCard(card: Card, token?: string): void {
    const { id, ...data } = card;
    this.db.prepare('INSERT INTO cards (id, created, token, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
      .run(id, card.createdAt, token ?? crypto.randomUUID(), JSON.stringify(data));
  }

  cardToken(id: string): string | undefined {
    return (this.db.prepare('SELECT token FROM cards WHERE id = ?').get(id) as { token: string } | undefined)?.token;
  }

  deleteCard(id: string): void {
    this.db.prepare('DELETE FROM cards WHERE id = ?').run(id);
  }

  /** CARD-1, CARD-2 …: never reused, even after a card is deleted. */
  nextCardKey(): string {
    const n = Number(this.getMeta('cards.next') ?? '1');
    this.setMeta('cards.next', String(n + 1));
    return `CARD-${n}`;
  }
}
