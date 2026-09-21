import fs from "fs";
import type { ConnectionOptions } from "tls";
import { Cluster, Redis as Valkey, type RedisOptions } from "iovalkey";

import type { ValkeyConnectionConfig } from "../../config";
import type { Log } from "../log";

export type { Log };

/** The subset both `Valkey` and `Cluster` provide, so a store never learns
 *  which it holds. Everything on it works on keys of one slot. */
export interface Client {
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, field: string): Promise<number>;
  defineCommand(name: string, definition: { numberOfKeys: number; lua: string }): void;
  quit(): Promise<unknown>;
}

const tlsOptions = (tls: ValkeyConnectionConfig["tls"]): ConnectionOptions | undefined => {
  if (tls === false) return undefined;
  if (tls === true) return {};
  return tls.ca ? { ca: fs.readFileSync(tls.ca) } : {};
};

const createClient = (cfg: ValkeyConnectionConfig): Valkey | Cluster => {
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

export const describe = (cfg: ValkeyConnectionConfig) => {
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

/** Pinged before it is handed over, so an unreachable store fails at startup
 *  and not on the first request. The `error` event has to have a listener or
 *  iovalkey prints to stderr itself. */
export async function openClient(cfg: ValkeyConnectionConfig, log: Log): Promise<Client> {
  const client = createClient(cfg);
  client.on("error", (err: Error) => log.warn({ err }, "valkey error"));
  client.on("reconnecting", () => log.info("reconnecting to valkey"));
  client.on("end", () => log.info("valkey connection closed"));
  await client.connect();
  await client.ping();
  return client;
}
