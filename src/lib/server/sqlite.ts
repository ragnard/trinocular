import { Database } from "bun:sqlite";

/** How long a statement waits on a lock before failing. With one process
 *  holding the file this only ever applies to a second one trying to. */
const BUSY_TIMEOUT_MS = 5_000;

/**
 * Opens a database file as this process's own.
 *
 * The locking mode is EXCLUSIVE before the journal mode is WAL, which is the
 * order that matters: a connection that enters WAL while exclusive keeps the
 * lock for good and never uses shared memory, so a second process opening the
 * same file — a second replica pointed at a shared volume — fails on its first
 * read with "database is locked" instead of sharing a file sqlite cannot share
 * over a network filesystem. Read `user_version` at once to take the lock
 * here, at startup, rather than on the first request.
 */
export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA locking_mode = EXCLUSIVE");
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.query("PRAGMA user_version").get();
  return db;
}

/**
 * Brings the schema up to date. `steps[i]` takes the database from version i
 * to version i + 1, and the version reached is kept in `user_version`, so a
 * file written by an older build gets only the steps it is missing. Each step
 * is its own transaction: a step that fails leaves the version where it was.
 */
export function migrate(db: Database, steps: string[][]): void {
  const current = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let version = current; version < steps.length; version++) {
    db.transaction(() => {
      for (const statement of steps[version]) db.run(statement);
      db.run(`PRAGMA user_version = ${version + 1}`);
    })();
  }
}
