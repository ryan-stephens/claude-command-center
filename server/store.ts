import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { CommandPack, Settings } from '../shared/protocol.ts';
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

/** One SQLite file for everything cc-control owns. Today: the global command groups. */
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
    `);
    this.db.exec('PRAGMA foreign_keys = ON');
    if (!this.db.prepare("SELECT 1 FROM meta WHERE key = 'seeded'").get()) {
      this.saveGlobalPack(STARTER_PACK);
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', ?)").run(new Date().toISOString());
    }
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
}
