import type { PostgresSessionStoreConfig } from "../../config";
import { Sealer } from "../../Sealer";
import type { SessionData, SessionID, SessionStore } from "../../sessionStore";
import { migrate, openClient, type Client, type Log } from "./client";

const SCHEMA: string[][] = [
  [
    `CREATE TABLE sessions (
       id TEXT PRIMARY KEY,
       data TEXT NOT NULL,
       expires_at TIMESTAMPTZ NOT NULL
     )`,
    "CREATE INDEX sessions_expires_at ON sessions (expires_at)"
  ]
];

/**
 * Sessions in Postgres, one row per session, sealed with a key derived from
 * the store's own secret the way the Valkey and sqlite stores seal them: the
 * database is what gets backed up and replicated, and a refresh token in the
 * clear there is a refresh token in every copy.
 *
 * Expiry is judged against the server's clock, on the way in and the way out,
 * so every replica agrees on it whatever their own clocks say. Expired rows
 * are swept on an interval, and a load checks the expiry itself so the sweep
 * is housekeeping rather than correctness.
 */
export class PostgresSessionStore implements SessionStore {
  #sql: Client;
  #sealer: Sealer;
  #log: Log;
  #sweep: ReturnType<typeof setInterval>;

  private constructor(sql: Client, sealer: Sealer, log: Log, sweepIntervalMs: number) {
    this.#sql = sql;
    this.#sealer = sealer;
    this.#log = log;
    this.#sweep = setInterval(() => this.#sweepExpired(), sweepIntervalMs);
    if (this.#sweep.unref) this.#sweep.unref();
  }

  static async create(
    cfg: PostgresSessionStoreConfig,
    log: Log,
    opts: { sweepIntervalMs?: number } = {}
  ): Promise<PostgresSessionStore> {
    const sealer = await Sealer.create(cfg.secret, "SessionStore");
    const sql = await openClient(cfg, log);
    await migrate(sql, "sessions", SCHEMA);
    return new PostgresSessionStore(sql, sealer, log, opts.sweepIntervalMs ?? 60_000);
  }

  async load(sessionId: SessionID): Promise<SessionData | null> {
    const [row] = await this.#sql<{ data: string }[]>`
      SELECT data FROM sessions WHERE id = ${sessionId} AND expires_at > now()`;
    if (!row) return null;
    try {
      return JSON.parse(await this.#sealer.open(row.data));
    } catch (err) {
      // Written under another secret, or not by us at all. Either way it is
      // not this user's session, and starting them a fresh one is the only
      // honest answer.
      this.#log.warn({ err, sessionId: sessionId.slice(0, 8) }, "unreadable session, dropping");
      await this.destroy(sessionId);
      return null;
    }
  }

  async save(sessionId: SessionID, data: SessionData, ttlSeconds: number): Promise<void> {
    const sealed = await this.#sealer.seal(JSON.stringify(data));
    await this.#sql`
      INSERT INTO sessions (id, data, expires_at)
      VALUES (${sessionId}, ${sealed}, now() + make_interval(secs => ${ttlSeconds}))
      ON CONFLICT (id) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`;
  }

  async destroy(sessionId: SessionID): Promise<void> {
    await this.#sql`DELETE FROM sessions WHERE id = ${sessionId}`;
  }

  #sweepExpired(): void {
    this.#sql`DELETE FROM sessions WHERE expires_at < now()`.catch((err) =>
      this.#log.warn({ err }, "could not sweep expired sessions")
    );
  }

  async ping(): Promise<void> {
    await this.#sql`SELECT 1`;
  }

  async dispose(): Promise<void> {
    clearInterval(this.#sweep);
    await this.#sql.end({ timeout: 5 });
  }
}
