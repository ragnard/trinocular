import fs from "fs";
import postgres, { type Sql } from "postgres";

import type { PostgresConnectionConfig, TlsConfig } from "../../config";
import type { Log } from "../log";

export type { Log };

/** A pool, and what a store gets to hold. */
export type Client = Sql;

const tlsOptions = (tls: TlsConfig): false | object => {
  if (tls === false) return false;
  if (tls === true) return {};
  return tls.ca ? { ca: fs.readFileSync(tls.ca) } : {};
};

/** The connection as it is safe to log: never the URL itself, which carries
 *  the password. */
export const describe = (cfg: PostgresConnectionConfig) => {
  const url = new URL(cfg.url);
  return {
    host: url.hostname,
    port: url.port || "5432",
    database: url.pathname.slice(1),
    schema: cfg.schema
  };
};

/** A schema name as `search_path` wants it: quoted, so one with a capital or
 *  a dash survives. */
const quoteIdentifier = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/**
 * Pinged before it is handed over, so an unreachable store fails at startup
 * and not on the first request. A query while the server is away is bound to
 * a connection before that connection is made, so it rejects when the connect
 * times out rather than queueing until the outage ends; `statement_timeout`
 * bounds the other half, once connected. Notices go to the log, since the
 * driver would otherwise print them to the console itself.
 */
export async function openClient(cfg: PostgresConnectionConfig, log: Log): Promise<Client> {
  const sql = postgres(cfg.url, {
    max: cfg.poolSize,
    connect_timeout: cfg.connectTimeoutMs / 1000,
    ...(cfg.tls !== undefined && { ssl: tlsOptions(cfg.tls) }),
    connection: {
      application_name: "trinocular",
      search_path: quoteIdentifier(cfg.schema),
      statement_timeout: cfg.statementTimeoutMs
    },
    onnotice: (notice) => log.debug({ notice }, "postgres notice")
  });
  try {
    await sql`SELECT 1`;
  } catch (err) {
    await sql.end({ timeout: 1 }).catch(() => {});
    throw err;
  }
  return sql;
}

/**
 * Brings a store's tables up to date. `steps[i]` takes the schema from version
 * i to version i + 1, and the version reached is kept in `schema_version`
 * under the store's name, since the session and file stores may share a
 * schema. Each step is its own transaction under one advisory lock (one for
 * every store, since the version table itself is shared), and the version is
 * re-read inside it: two replicas starting together then take turns, and the
 * second finds each step already done rather than racing the first's
 * `CREATE TABLE`. A step that fails leaves the version where it was.
 */
export async function migrate(sql: Client, store: string, steps: string[][]): Promise<void> {
  for (let version = 0; version < steps.length; version++) {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('trinocular:migrate'))`;
      await tx`CREATE TABLE IF NOT EXISTS schema_version (
        store TEXT PRIMARY KEY,
        version INTEGER NOT NULL
      )`;
      const [row] = await tx<{ version: number }[]>`
        SELECT version FROM schema_version WHERE store = ${store}`;
      if ((row?.version ?? 0) !== version) return;
      for (const statement of steps[version]) await tx.unsafe(statement);
      await tx`INSERT INTO schema_version (store, version) VALUES (${store}, ${version + 1})
        ON CONFLICT (store) DO UPDATE SET version = excluded.version`;
    });
  }
}
