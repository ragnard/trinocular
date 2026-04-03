import { error as svelteError } from "@sveltejs/kit";
import type { Logger } from "pino";

export function error(
  logger: Logger,
  status: number,
  clientMessage: string,
  logMessage: string,
  context?: Record<string, unknown>
): never {
  logger.error(context ?? {}, logMessage);
  svelteError(status, clientMessage);
}
