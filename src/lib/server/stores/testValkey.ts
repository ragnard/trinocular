import type { ValkeyConnectionConfig } from "../config";
import type { Log } from "./valkey/client";

/** The Valkey the contracts run against, from `TRINOCULAR_TEST_VALKEY` as
 *  `host:port`, or null to skip those suites. Each run keys under its own
 *  prefix, so a long-lived server never shows one run another's leftovers. */
export const testValkey = (): { connection: ValkeyConnectionConfig; keyPrefix: string } | null => {
  const at = process.env.TRINOCULAR_TEST_VALKEY;
  if (!at) return null;
  const [host, port] = at.split(":");
  return {
    connection: {
      mode: "single",
      host,
      port: Number(port ?? 6379),
      db: 0,
      tls: false,
      connectTimeoutMs: 5_000,
      commandTimeoutMs: 2_000
    },
    keyPrefix: `trinocular-test:${crypto.randomUUID()}:`
  };
};

export const silent: Log = { debug: () => {}, info: () => {}, warn: () => {} } as unknown as Log;
