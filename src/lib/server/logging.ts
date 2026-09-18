import { isHttpError, isRedirect, type Handle } from "@sveltejs/kit";
import { pino, type Logger } from "pino";

import { env } from "$env/dynamic/private";

const LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"];

/**
 * From the environment rather than the config file, for two reasons: it has to
 * apply before the config is read — loading the config is itself something
 * worth logging, including the failures that exit the process — and it is the
 * one setting an operator wants to turn up on a running deployment without
 * editing the file that defines its security policy.
 *
 * `info` by default. It was pinned to `debug`, which meant a production
 * deployment wrote a line per proxied request whether or not anyone wanted
 * them. An unrecognised level is refused here rather than by pino, which
 * throws: a typo in a log level should not be the thing that stops the server
 * starting.
 */
const level = (() => {
  const configured = env.LOG_LEVEL?.trim().toLowerCase();
  if (!configured) return "info";
  if (LEVELS.includes(configured)) return configured;
  console.warn(`LOG_LEVEL "${configured}" is not one of ${LEVELS.join(", ")}; using info`);
  return "info";
})();

export const logger = pino({
  level,
  formatters: {
    level(label, _number) {
      return { level: label };
    }
  }
});

// `logLevel`, not `level`: the formatter above already emits a `level` field,
// and a second one in the same object makes a duplicate JSON key that a parser
// resolves to whichever it reads last — the line would report its own severity
// as whatever the configured level happens to be.
logger.info({ logLevel: level }, "initialized");

export const LoggingHandler = (): Handle => {
  return async ({ event, resolve }) => {
    const requestId = crypto.randomUUID();
    const requestIdLogger: Logger = logger.child({ request_id: requestId });

    event.locals.logger = requestIdLogger;
    // Carried explicitly rather than read back out of the logger's bindings:
    // the binding is named request_id, and anything user-facing that quotes an
    // id (the auth error page) needs the same value the logs are tagged with.
    event.locals.requestId = requestId;

    try {
      const res = await resolve(event);

      // A 5xx is a failure whatever produced it, and this line is the one thing
      // that sees every response. It has to carry the severity because most
      // server errors never reach the `catch` below: SvelteKit catches an
      // exception thrown by a route or a load *inside* `resolve`, hands it to
      // `handleError`, and returns a 500 response — so from here a crashed
      // endpoint is indistinguishable from a served page except by its status.
      const log = (res?.status ?? 0) >= 500 ? requestIdLogger.error.bind(requestIdLogger) : requestIdLogger.info.bind(requestIdLogger);
      log(
        {
          method: event.request.method,
          url: event.request.url,
          status: res?.status
        },
        "request completed"
      );

      return res;
    } catch (err) {
      if (isHttpError(err)) {
        requestIdLogger.info(
          {
            method: event.request.method,
            url: event.request.url,
            err: err
          },
          "request error"
        );
      } else if (isRedirect(err)) {
        requestIdLogger.info(
          {
            method: event.request.method,
            url: event.request.url,
            status: err.status,
            location: err.location
          },
          "redirect"
        );
      } else {
        // `error`, unlike the two branches above. This is the one that was not
        // thrown deliberately: an HttpError has already been logged, at the
        // level its status earns, by the `error()` helper that threw it, and a
        // redirect is not a failure at all. Reached only by something thrown by
        // a handler in the sequence itself — a route's own exception is caught
        // by SvelteKit before it gets here, which is what `handleError` is for.
        requestIdLogger.error(
          {
            method: event.request.method,
            url: event.request.url,
            err: err
          },
          "unhandled error"
        );
      }

      throw err;
    }
  };
};
