import type { FileRecord, StoredFile, StoredUi } from "$lib/workspaceRecord";

import { config, type FileStoreConfig } from "./config";
import { logger } from "./logging";
import { InMemoryFileStore } from "./stores/memory/fileStore";

export type PutResult =
  | { status: "saved"; version: string }
  /** The store holds a different version, or none where one was expected, or
   *  one where none was. `current` is what it holds now. */
  | { status: "conflict"; current: FileRecord | null };

/**
 * A user's query files, as the server keeps them. The user id is the partition
 * and comes from the gate's identity, never from the request. A write says
 * which version it expects to replace — `null` for a document it is creating
 * — and a store answers a wrong guess with what it holds, so two tabs or two
 * browsers cannot revert each other without one of them being told. Removals
 * and the ui record are unconditional: both are advisory in spirit, and a
 * stale one costs nothing that the next write does not put right.
 */
export interface FileStore {
  list(userId: string): Promise<{ files: FileRecord[]; ui: StoredUi | null }>;
  put(userId: string, file: StoredFile, expected: string | null): Promise<PutResult>;
  remove(userId: string, fileId: string): Promise<void>;
  putUi(userId: string, ui: StoredUi): Promise<void>;
  /** Rejects if the store cannot currently be reached. */
  ping?(): Promise<void>;
  dispose?(): Promise<void>;
}

/** Null when the files stay in the browser. A store that cannot be opened
 *  exits the process, the same policy as the session store and the config.
 *  The sqlite and Valkey stores are imported lazily so a deployment without
 *  them never evaluates them. */
export const createFileStore = async (cfg: FileStoreConfig): Promise<FileStore | null> => {
  switch (cfg.kind) {
    case "browser":
      logger.info({ store: "browser" }, "files stay in the browser");
      return null;
    case "memory":
      logger.info({ store: "memory" }, "file store configured");
      return new InMemoryFileStore();
    case "sqlite": {
      const { SqliteFileStore } = await import("./stores/sqlite/fileStore");
      try {
        const store = SqliteFileStore.create(cfg);
        logger.info({ store: "sqlite", path: cfg.path }, "file store configured");
        return store;
      } catch (err) {
        logger.error({ err, path: cfg.path }, "failed to open the file store");
        process.exit(1);
      }
    }
    case "valkey": {
      const { ValkeyFileStore } = await import("./stores/valkey/fileStore");
      const { describe } = await import("./stores/valkey/client");
      const where = describe(cfg);
      try {
        const store = await ValkeyFileStore.create(
          cfg,
          logger.child({ component: "valkey-file-store" })
        );
        logger.info({ store: "valkey", ...where }, "file store configured");
        return store;
      } catch (err) {
        logger.error({ err, ...where }, "failed to connect to the file store");
        process.exit(1);
      }
    }
  }
};

/** Built once at startup: the routes import it, and the hook sequence imports
 *  it for the readiness probe and to close it on shutdown. */
export const fileStore: FileStore | null = await createFileStore(config.files.store);
