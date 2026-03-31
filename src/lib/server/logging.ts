import { isHttpError, isRedirect, type Handle } from "@sveltejs/kit";
import { pino, type Logger } from "pino";

export const logger = pino({
  level: 'debug',
  formatters: {
    level(label, _number) {
      return { level: label };
    }
  }
});

logger.info("initialized");

export const createLogger = logger.child;

export const LoggingHandler: () => Promise<Handle> = async () => {
  return async ({ event, resolve }) => {
    const requestId = crypto.randomUUID();
    const requestIdLogger: Logger = logger.child({ request_id: requestId });

    event.locals.logger = requestIdLogger;

    try {
      const res = await resolve(event);

      requestIdLogger.info(
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
        requestIdLogger.info(
          {
            method: event.request.method,
            url: event.request.url,
            err: err
          },
          "unknown error"
        );
      }

      throw err;
    }
  };
};
