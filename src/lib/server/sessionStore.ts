import type { StoreConfig } from "./config";
import { logger } from "./logging";
import { InMemorySessionStore } from "./stores/memory/sessionStore";

export type SessionID = string;
export type SessionData = Record<string, unknown>;

/**
 * Where sessions are kept. One document per session under a TTL, and nothing
 * else: no listing, no scan, so every implementation is single-key and the
 * swap between them is small.
 */
export interface SessionStore {
  load(sessionId: SessionID): Promise<SessionData | null>;
  save(sessionId: SessionID, data: SessionData, ttlSeconds: number): Promise<void>;
  destroy(sessionId: SessionID): Promise<void>;
  /** Rejects if the store cannot currently be reached. Absent means the store
   *  has nothing to reach, and reads as always ready. */
  ping?(): Promise<void>;
  dispose?(): Promise<void>;
}

/** A store that cannot be reached exits the process: the same policy as a
 *  config that will not validate, since a server that came up without its
 *  session store would answer every request with a 500. The sqlite and Valkey
 *  stores are imported lazily so a memory deployment never evaluates them. */
export const createSessionStore = async (cfg: StoreConfig): Promise<SessionStore> => {
  switch (cfg.kind) {
    case "memory":
      logger.info({ store: "memory" }, "session store configured");
      return new InMemorySessionStore();
    case "sqlite": {
      const { SqliteSessionStore } = await import("./stores/sqlite/sessionStore");
      try {
        const store = await SqliteSessionStore.create(cfg, {
          onUnreadable: (sessionId, err) =>
            logger.warn({ err, sessionId: sessionId.slice(0, 8) }, "unreadable session, dropping")
        });
        logger.info({ store: "sqlite", path: cfg.path }, "session store configured");
        return store;
      } catch (err) {
        logger.error({ err, path: cfg.path }, "failed to open the session store");
        process.exit(1);
      }
    }
    case "valkey": {
      const { ValkeySessionStore } = await import("./stores/valkey/sessionStore");
      const { describe } = await import("./stores/valkey/client");
      const where = describe(cfg);
      try {
        const store = await ValkeySessionStore.create(
          cfg,
          logger.child({ component: "valkey-session-store" })
        );
        logger.info({ store: "valkey", ...where }, "session store configured");
        return store;
      } catch (err) {
        logger.error({ err, ...where }, "failed to connect to the session store");
        process.exit(1);
      }
    }
  }
};
