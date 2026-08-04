import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * Thin persistence wrapper around SQLite (better-sqlite3, synchronous).
 *
 * We persist *room metadata + last known video state* so that rooms survive a
 * server restart (bonus: "Persistent rooms"). Live participant lists are
 * intentionally NOT persisted — presence is ephemeral and rebuilt from live
 * socket connections.
 *
 * Passing ":memory:" gives an isolated in-memory DB, which the tests use.
 */
export interface RoomRow {
  id: string;
  created_at: number;
  expires_at: number;
  host_token_hash: string;
  video_id: string | null;
  play_state: string;
  // NB: named `position_seconds`, not `current_time`, because `CURRENT_TIME`
  // is a reserved SQLite keyword that shadows a bare column of that name.
  position_seconds: number;
  last_updated_at: number;
}

export class RoomStore {
  private db: Database.Database;

  constructor(filename: string) {
    if (filename !== ":memory:") {
      mkdirSync(dirname(filename), { recursive: true });
    }
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id               TEXT PRIMARY KEY,
        created_at       INTEGER NOT NULL,
        expires_at       INTEGER NOT NULL,
        host_token_hash  TEXT NOT NULL,
        video_id         TEXT,
        play_state       TEXT NOT NULL DEFAULT 'paused',
        position_seconds REAL NOT NULL DEFAULT 0,
        last_updated_at  INTEGER NOT NULL
      );
    `);

    // Existing local databases predate host capabilities and room expiry.
    // Keep the migration intentionally small because SQLite does not support
    // adding multiple columns in one ALTER TABLE statement.
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(rooms)").all() as Array<{ name: string }>).map((column) => column.name)
    );
    if (!columns.has("expires_at")) {
      this.db.exec("ALTER TABLE rooms ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0");
      this.db.exec("UPDATE rooms SET expires_at = created_at + 86400000 WHERE expires_at = 0");
    }
    if (!columns.has("host_token_hash")) {
      // Legacy rooms deliberately have no valid host credential. They remain
      // viewable until expiry, but cannot accidentally grant host access.
      this.db.exec("ALTER TABLE rooms ADD COLUMN host_token_hash TEXT NOT NULL DEFAULT ''");
    }
  }

  insertRoom(row: RoomRow): void {
    this.db
      .prepare(
        `INSERT INTO rooms (id, created_at, expires_at, host_token_hash, video_id, play_state, position_seconds, last_updated_at)
         VALUES (@id, @created_at, @expires_at, @host_token_hash, @video_id, @play_state, @position_seconds, @last_updated_at)`
      )
      .run(row);
  }

  getRoom(id: string): RoomRow | undefined {
    return this.db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(id) as
      | RoomRow
      | undefined;
  }

  updateVideoState(
    id: string,
    state: { video_id: string | null; play_state: string; position_seconds: number; last_updated_at: number }
  ): void {
    this.db
      .prepare(
        `UPDATE rooms SET video_id = @video_id, play_state = @play_state,
           position_seconds = @position_seconds, last_updated_at = @last_updated_at
         WHERE id = @id`
      )
      .run({ id, ...state });
  }

  updateHostTokenHash(id: string, hostTokenHash: string): void {
    this.db.prepare("UPDATE rooms SET host_token_hash = ? WHERE id = ?").run(hostTokenHash, id);
  }

  deleteRoom(id: string): void {
    this.db.prepare(`DELETE FROM rooms WHERE id = ?`).run(id);
  }

  deleteExpired(before: number): number {
    return this.db.prepare("DELETE FROM rooms WHERE expires_at <= ?").run(before).changes;
  }

  countRooms(): number {
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM rooms`).get() as { n: number };
    return r.n;
  }

  close(): void {
    this.db.close();
  }
}
