import postgres from "postgres";

import type { PostgresConnectionConfig } from "../config";

/** The Postgres the contracts run against, from `TRINOCULAR_TEST_POSTGRES` as
 *  a URL, or null to skip those suites. Each run gets a schema of its own,
 *  made by `setup` and dropped by `teardown`, so a long-lived server never
 *  shows one run another's leftovers. */
export const testPostgres = (): {
  connection: PostgresConnectionConfig;
  setup: () => Promise<void>;
  teardown: () => Promise<void>;
} | null => {
  const url = process.env.TRINOCULAR_TEST_POSTGRES;
  if (!url) return null;
  const schema = `trinocular_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = async (statement: string) => {
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe(statement);
    } finally {
      await sql.end();
    }
  };
  return {
    connection: {
      url,
      schema,
      poolSize: 2,
      connectTimeoutMs: 5_000,
      statementTimeoutMs: 5_000
    },
    setup: () => admin(`CREATE SCHEMA "${schema}"`),
    teardown: () => admin(`DROP SCHEMA "${schema}" CASCADE`)
  };
};
