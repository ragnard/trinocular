import type { Logger } from "pino";

/** Handed in rather than imported: the app's logger reads the environment,
 *  which only vite resolves, and the stores are what the tests import. */
export type Log = Pick<Logger, "debug" | "info" | "warn">;
