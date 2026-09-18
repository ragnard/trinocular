import type { Database } from "bun:sqlite";

import type { FileRecord, StoredFile, StoredUi } from "$lib/workspaceRecord";

import type { SqliteFileStoreConfig } from "../../config";
import type { FileStore, PutResult } from "../../fileStore";
import { migrate, openDatabase } from "./database";

const SCHEMA: string[][] = [
  [
    `CREATE TABLE files (
       user_id TEXT NOT NULL,
       id TEXT NOT NULL,
       name TEXT NOT NULL,
       content TEXT NOT NULL,
       view_formats TEXT NOT NULL,
       version INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (user_id, id)
     )`,
    `CREATE TABLE workspace_ui (
       user_id TEXT PRIMARY KEY,
       active_file_id TEXT,
       "order" TEXT NOT NULL,
       connection_id TEXT,
       updated_at INTEGER NOT NULL
     )`
  ]
];

interface FileRow {
  id: string;
  name: string;
  content: string;
  view_formats: string;
  version: number;
}

interface UiRow {
  active_file_id: string | null;
  order: string;
  connection_id: string | null;
}

const toRecord = (row: FileRow): FileRecord => ({
  id: row.id,
  name: row.name,
  content: row.content,
  viewFormats: JSON.parse(row.view_formats),
  version: String(row.version)
});

/**
 * Files in a sqlite database on a volume of this one replica. A document is a
 * row with an integer version that a write compares and bumps inside one
 * transaction, which is what makes the compare-and-set a property of the
 * store rather than of whoever calls it. Not sealed: the SQL text is what an
 * operator restores a backup of this file for.
 */
export class SqliteFileStore implements FileStore {
  #db: Database;

  private constructor(db: Database) {
    this.#db = db;
  }

  static create(cfg: SqliteFileStoreConfig): SqliteFileStore {
    const db = openDatabase(cfg.path);
    migrate(db, SCHEMA);
    return new SqliteFileStore(db);
  }

  async list(userId: string) {
    const rows = this.#db
      .query(
        `SELECT id, name, content, view_formats, version
         FROM files WHERE user_id = ?`
      )
      .all(userId) as FileRow[];
    const ui = this.#db
      .query(`SELECT active_file_id, "order", connection_id FROM workspace_ui WHERE user_id = ?`)
      .get(userId) as UiRow | null;
    return {
      files: rows.map(toRecord),
      ui: ui && {
        activeFileId: ui.active_file_id ?? undefined,
        order: JSON.parse(ui.order),
        connectionId: ui.connection_id ?? undefined
      }
    };
  }

  async put(userId: string, file: StoredFile, expected: string | null): Promise<PutResult> {
    return this.#db.transaction((): PutResult => {
      const current = this.#db
        .query(
          `SELECT id, name, content, view_formats, version
           FROM files WHERE user_id = ? AND id = ?`
        )
        .get(userId, file.id) as FileRow | null;
      if ((current ? String(current.version) : null) !== expected) {
        return { status: "conflict", current: current && toRecord(current) };
      }
      const version = (current?.version ?? 0) + 1;
      this.#db
        .query(
          `INSERT INTO files (user_id, id, name, content, view_formats, version, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, id) DO UPDATE SET
             name = excluded.name, content = excluded.content,
             view_formats = excluded.view_formats,
             version = excluded.version, updated_at = excluded.updated_at`
        )
        .run(
          userId,
          file.id,
          file.name,
          file.content,
          JSON.stringify(file.viewFormats),
          version,
          Date.now()
        );
      return { status: "saved", version: String(version) };
    })();
  }

  async remove(userId: string, fileId: string): Promise<void> {
    this.#db.query("DELETE FROM files WHERE user_id = ? AND id = ?").run(userId, fileId);
  }

  async putUi(userId: string, ui: StoredUi): Promise<void> {
    this.#db
      .query(
        `INSERT INTO workspace_ui (user_id, active_file_id, "order", connection_id, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           active_file_id = excluded.active_file_id, "order" = excluded."order",
           connection_id = excluded.connection_id, updated_at = excluded.updated_at`
      )
      .run(
        userId,
        ui.activeFileId ?? null,
        JSON.stringify(ui.order),
        ui.connectionId ?? null,
        Date.now()
      );
  }

  async ping(): Promise<void> {
    this.#db.query("SELECT 1").get();
  }

  async dispose(): Promise<void> {
    this.#db.close();
  }
}
