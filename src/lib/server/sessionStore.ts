import type { StoreConfig } from "./config";
import { logger } from "./logging";
import { InMemoryStore, type SessionStore } from "./session";

/** A store that cannot be reached exits the process: the same policy as a
 *  config that will not validate, since a server that came up without its
 *  session store would answer every request with a 500. */
export const createSessionStore = async (
  cfg: StoreConfig,
  cookieSecret: string
): Promise<SessionStore> => {
  switch (cfg.kind) {
    case "memory":
      logger.info({ store: "memory" }, "session store configured");
      return new InMemoryStore();
    case "valkey": {
      const { ValkeyStore, describe } = await import("./valkeyStore");
      const where = describe(cfg);
      try {
        const store = await ValkeyStore.create(cfg, cookieSecret);
        logger.info({ store: "valkey", ...where }, "session store configured");
        return store;
      } catch (err) {
        logger.error({ err, ...where }, "failed to connect to the session store");
        process.exit(1);
      }
    }
  }
};
