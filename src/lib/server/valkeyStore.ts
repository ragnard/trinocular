import fs from "fs";
import type { ConnectionOptions } from "tls";
import { Cluster, Redis as Valkey, type RedisOptions } from "iovalkey";

import type { ValkeyStoreConfig } from "./config";
import { Sealer } from "./Sealer";
import { logger } from "./logging";
import type { SessionData, SessionID, SessionStore } from "./session";

/** The single-key subset of the client that the store needs, which both
 *  `Valkey` and `Cluster` provide, so the store never learns which it holds. */
interface Client {
  connect(): Promise<void>;
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
  quit(): Promise<unknown>;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

const tlsOptions = (tls: ValkeyStoreConfig["tls"]): ConnectionOptions | undefined => {
  if (tls === false) return undefined;
  if (tls === true) return {};
  return tls.ca ? { ca: fs.readFileSync(tls.ca) } : {};
};

const createClient = (cfg: ValkeyStoreConfig): Client => {
  const common: RedisOptions = {
    username: cfg.username,
    password: cfg.password,
    tls: tlsOptions(cfg.tls),
    connectTimeout: cfg.connectTimeoutMs,
    commandTimeout: cfg.commandTimeoutMs,
    // A command outlives at most one reconnect attempt: together with the
    // timeout this bounds how long a request waits on an unreachable store,
    // rather than queueing until whenever it comes back.
    maxRetriesPerRequest: 1,
    lazyConnect: true
  };
  switch (cfg.mode) {
    case "single":
      return new Valkey({ ...common, host: cfg.host, port: cfg.port, db: cfg.db });
    case "sentinel":
      return new Valkey({
        ...common,
        sentinels: cfg.sentinels,
        name: cfg.name,
        db: cfg.db,
        sentinelUsername: cfg.sentinelUsername,
        sentinelPassword: cfg.sentinelPassword,
        enableTLSForSentinelMode: cfg.tls !== false
      });
    case "cluster": {
      const { lazyConnect, ...redisOptions } = common;
      return new Cluster(cfg.nodes, { redisOptions, lazyConnect });
    }
  }
};

export const describe = (cfg: ValkeyStoreConfig) => {
  switch (cfg.mode) {
    case "single":
      return { mode: cfg.mode, hosts: [`${cfg.host}:${cfg.port}`], db: cfg.db };
    case "sentinel":
      return {
        mode: cfg.mode,
        hosts: cfg.sentinels.map((n) => `${n.host}:${n.port}`),
        name: cfg.name,
        db: cfg.db
      };
    case "cluster":
      return { mode: cfg.mode, hosts: cfg.nodes.map((n) => `${n.host}:${n.port}`) };
  }
};

/** Sessions in Valkey (or Redis), one key per session, sealed with a key
 *  derived from the cookie secret so a dump of the store yields nothing. */
export class ValkeyStore implements SessionStore {
  #client: Client;
  #prefix: string;
  #sealer: Sealer;
  #log = logger.child({ component: "valkey-store" });

  private constructor(client: Client, prefix: string, sealer: Sealer) {
    this.#client = client;
    this.#prefix = prefix;
    this.#sealer = sealer;
    client.on("error", (err: Error) => this.#log.warn({ err }, "valkey error"));
    client.on("reconnecting", () => this.#log.info("reconnecting to valkey"));
    client.on("end", () => this.#log.info("valkey connection closed"));
  }

  /** Connects and pings before returning, so a store that cannot be reached
   *  fails here, at startup, rather than on the first request. */
  static async create(cfg: ValkeyStoreConfig, cookieSecret: string): Promise<ValkeyStore> {
    const sealer = await Sealer.create(cookieSecret, "SessionStore");
    const client = createClient(cfg);
    const store = new ValkeyStore(client, cfg.keyPrefix, sealer);
    await client.connect();
    await client.ping();
    return store;
  }

  #key(sessionId: SessionID): string {
    return this.#prefix + sessionId;
  }

  async load(sessionId: SessionID): Promise<SessionData | null> {
    const sealed = await this.#client.get(this.#key(sessionId));
    if (sealed === null) return null;
    try {
      return JSON.parse(await this.#sealer.open(sealed));
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
    await this.#client.set(this.#key(sessionId), sealed, "EX", ttlSeconds);
  }

  async destroy(sessionId: SessionID): Promise<void> {
    await this.#client.del(this.#key(sessionId));
  }

  async ping(): Promise<void> {
    await this.#client.ping();
  }

  async dispose(): Promise<void> {
    await this.#client.quit();
  }
}
