import type { Database } from "bun:sqlite";

import type { SqliteSessionStoreConfig } from "../../config";
import { Sealer } from "../../Sealer";
import type { SessionData, SessionID, SessionStore } from "../../sessionStore";
import { migrate, openDatabase } from "./database";

const SCHEMA: string[][] = [
  [
    `CREATE TABLE sessions (
       id TEXT PRIMARY KEY,
       data TEXT NOT NULL,
       expires_at INTEGER NOT NULL
     )`,
    "CREATE INDEX sessions_expires_at ON sessions (expires_at)"
  ]
];

interface Row {
  data: string;
  expires_at: number;
}

/**
 * Sessions in a sqlite file, one row per session, sealed with a key derived
 * from the store's own secret the way the Valkey store seals them: the file
 * sits on a volume that gets snapshotted and backed up, and a refresh token
 * in plaintext there is a refresh token in every copy.
 *
 * Expired rows are swept on an interval, and a load checks the expiry itself
 * so the sweep is housekeeping rather than correctness.
 */
export class SqliteSessionStore implements SessionStore {
  #db: Database;
  #sealer: Sealer;
  #sweep: ReturnType<typeof setInterval>;
  #onUnreadable: (sessionId: SessionID, err: unknown) => void;

  private constructor(
    db: Database,
    sealer: Sealer,
    sweepIntervalMs: number,
    onUnreadable: (sessionId: SessionID, err: unknown) => void
  ) {
    this.#db = db;
    this.#sealer = sealer;
    this.#onUnreadable = onUnreadable;
    this.#sweep = setInterval(() => this.#sweepExpired(), sweepIntervalMs);
    if (this.#sweep.unref) this.#sweep.unref();
  }

  static async create(
    cfg: SqliteSessionStoreConfig,
    opts: {
      sweepIntervalMs?: number;
      onUnreadable?: (sessionId: SessionID, err: unknown) => void;
    } = {}
  ): Promise<SqliteSessionStore> {
    const sealer = await Sealer.create(cfg.secret, "SessionStore");
    const db = openDatabase(cfg.path);
    migrate(db, SCHEMA);
    return new SqliteSessionStore(
      db,
      sealer,
      opts.sweepIntervalMs ?? 60_000,
      opts.onUnreadable ?? (() => {})
    );
  }

  async load(sessionId: SessionID): Promise<SessionData | null> {
    const row = this.#db
      .query("SELECT data, expires_at FROM sessions WHERE id = ?")
      .get(sessionId) as Row | null;
    if (!row) return null;
    if (Date.now() > row.expires_at) {
      await this.destroy(sessionId);
      return null;
    }
    try {
      return JSON.parse(await this.#sealer.open(row.data));
    } catch (err) {
      // Written under another secret, or not by us at all. Either way it is
      // not this user's session, and starting them a fresh one is the only
      // honest answer.
      this.#onUnreadable(sessionId, err);
      await this.destroy(sessionId);
      return null;
    }
  }

  async save(sessionId: SessionID, data: SessionData, ttlSeconds: number): Promise<void> {
    const sealed = await this.#sealer.seal(JSON.stringify(data));
    this.#db
      .query(
        `INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`
      )
      .run(sessionId, sealed, Date.now() + ttlSeconds * 1000);
  }

  async destroy(sessionId: SessionID): Promise<void> {
    this.#db.query("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  #sweepExpired(): void {
    this.#db.query("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  }

  async ping(): Promise<void> {
    this.#db.query("SELECT 1").get();
  }

  async dispose(): Promise<void> {
    clearInterval(this.#sweep);
    this.#db.close();
  }
}
