import { error as svelteError } from "@sveltejs/kit";
import type { Logger } from "pino";

/**
 * Logs and throws an HTTP error. The level follows the status, as it does in
 * `handleError` and the request-completed line: a 4xx is the caller's mistake
 * (a bad proxy path, an unknown connection) and belongs at warn, or every bot
 * probing the API stands in front of whoever watches for real failures.
 */
export function error(
  logger: Logger,
  status: number,
  clientMessage: string,
  logMessage: string,
  context?: Record<string, unknown>
): never {
  if (status >= 500) logger.error(context ?? {}, logMessage);
  else logger.warn(context ?? {}, logMessage);
  svelteError(status, clientMessage);
}
