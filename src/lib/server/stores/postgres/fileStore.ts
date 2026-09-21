import type { FileRecord, StoredFile, StoredUi } from "$lib/workspaceRecord";

import type { PostgresFileStoreConfig } from "../../config";
import type { FileStore, PutResult } from "../../fileStore";
import { migrate, openClient, type Client, type Log } from "./client";

const SCHEMA: string[][] = [
  [
    `CREATE TABLE files (
       user_id TEXT NOT NULL,
       id TEXT NOT NULL,
       name TEXT NOT NULL,
       content TEXT NOT NULL,
       view_formats TEXT NOT NULL,
       version BIGINT NOT NULL,
       updated_at TIMESTAMPTZ NOT NULL,
       PRIMARY KEY (user_id, id)
     )`,
    "CREATE SEQUENCE file_versions",
    `CREATE TABLE workspace_ui (
       user_id TEXT PRIMARY KEY,
       active_file_id TEXT,
       "order" TEXT NOT NULL,
       connection_id TEXT,
       updated_at TIMESTAMPTZ NOT NULL
     )`
  ]
];

interface FileRow {
  id: string;
  name: string;
  content: string;
  view_formats: string;
  /** A bigint, which the driver hands over as a string. */
  version: string;
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
 * Files in Postgres, which any number of replicas can share. A document is a
 * row, and versions come from one sequence rather than the row, as in the
 * Valkey store: a document removed and made again never repeats one, so a
 * write against the old copy still meets a conflict. The compare-and-set is
 * a transaction — the row locked `FOR UPDATE` for an update, and an insert
 * that does nothing on conflict for a create, since an upsert would let the
 * second of two concurrent creates through as an update. Not sealed: the SQL
 * text is what an operator restores a backup of this database for.
 */
export class PostgresFileStore implements FileStore {
  #sql: Client;

  private constructor(sql: Client) {
    this.#sql = sql;
  }

  static async create(cfg: PostgresFileStoreConfig, log: Log): Promise<PostgresFileStore> {
    const sql = await openClient(cfg, log);
    await migrate(sql, "files", SCHEMA);
    return new PostgresFileStore(sql);
  }

  async list(userId: string) {
    const [rows, [ui]] = await Promise.all([
      this.#sql<FileRow[]>`
        SELECT id, name, content, view_formats, version
        FROM files WHERE user_id = ${userId}`,
      this.#sql<UiRow[]>`
        SELECT active_file_id, "order", connection_id
        FROM workspace_ui WHERE user_id = ${userId}`
    ]);
    return {
      files: rows.map(toRecord),
      ui: ui
        ? {
            activeFileId: ui.active_file_id ?? undefined,
            order: JSON.parse(ui.order),
            connectionId: ui.connection_id ?? undefined
          }
        : null
    };
  }

  async put(userId: string, file: StoredFile, expected: string | null): Promise<PutResult> {
    const viewFormats = JSON.stringify(file.viewFormats);
    return this.#sql.begin(async (tx): Promise<PutResult> => {
      const current = async () =>
        (
          await tx<FileRow[]>`
            SELECT id, name, content, view_formats, version
            FROM files WHERE user_id = ${userId} AND id = ${file.id} FOR UPDATE`
        )[0] ?? null;
      const held = await current();
      if ((held ? String(held.version) : null) !== expected) {
        return { status: "conflict", current: held && toRecord(held) };
      }
      const [saved] = held
        ? await tx<{ version: string }[]>`
            UPDATE files SET
              name = ${file.name}, content = ${file.content}, view_formats = ${viewFormats},
              version = nextval('file_versions'), updated_at = now()
            WHERE user_id = ${userId} AND id = ${file.id}
            RETURNING version`
        : await tx<{ version: string }[]>`
            INSERT INTO files (user_id, id, name, content, view_formats, version, updated_at)
            VALUES (${userId}, ${file.id}, ${file.name}, ${file.content}, ${viewFormats},
                    nextval('file_versions'), now())
            ON CONFLICT (user_id, id) DO NOTHING
            RETURNING version`;
      if (!saved) {
        // Somebody created it between our look and our insert.
        const other = await current();
        return { status: "conflict", current: other && toRecord(other) };
      }
      return { status: "saved", version: String(saved.version) };
    });
  }

  async remove(userId: string, fileId: string): Promise<void> {
    await this.#sql`DELETE FROM files WHERE user_id = ${userId} AND id = ${fileId}`;
  }

  async putUi(userId: string, ui: StoredUi): Promise<void> {
    await this.#sql`
      INSERT INTO workspace_ui (user_id, active_file_id, "order", connection_id, updated_at)
      VALUES (${userId}, ${ui.activeFileId ?? null}, ${JSON.stringify(ui.order)},
              ${ui.connectionId ?? null}, now())
      ON CONFLICT (user_id) DO UPDATE SET
        active_file_id = excluded.active_file_id, "order" = excluded."order",
        connection_id = excluded.connection_id, updated_at = excluded.updated_at`;
  }

  async ping(): Promise<void> {
    await this.#sql`SELECT 1`;
  }

  async dispose(): Promise<void> {
    await this.#sql.end({ timeout: 5 });
  }
}
