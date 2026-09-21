import { type Handle, type HandleServerError } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";

import {
  config,
  forbiddenPath,
  isAuthPath,
  loginPath,
  logoutPath,
  type Config
} from "$lib/server/config";
import { env } from "$env/dynamic/private";
import { SessionHandler } from "$lib/server/session";
import { createSessionStore } from "$lib/server/sessionStore";
import { fileStore } from "$lib/server/fileStore";
import { OIDCHandler } from "$lib/server/oidc";
import { PasswordAuthnHandler } from "$lib/server/passwordAuthn";
import { LoggingHandler } from "$lib/server/logging";
import { SecurityHeadersHandler } from "$lib/server/securityHeaders";
import { ProbeHandler } from "$lib/server/probes";
import { AccessHandler, createAuthorizer } from "$lib/server/authz";
import { logConnectionAuthz } from "$lib/server/connectionAuthz";
import { logger } from "$lib/server/logging";
import { type Claims } from "$lib/server/identity";

const NoAuthnHandler = (opts: { user: string; claims: Claims }): Handle => {
  return async ({ event, resolve }) => {
    event.locals.identity = { userId: opts.user, claims: opts.claims };
    return resolve(event);
  };
};

const authnHandler = async (config: Config) => {
  let authn = config.authn;

  switch (authn.kind) {
    case "none":
      return NoAuthnHandler({ user: authn.user, claims: authn.claims });
    case "password":
      // logoutPath is a string whenever the kind is password; the type does
      // not narrow across modules.
      return PasswordAuthnHandler({ users: authn.users, logoutPath: logoutPath! });
    case "oidc":
      return await OIDCHandler({
        issuer: new URL(authn.issuer),
        clientId: authn.clientId,
        clientSecret: authn.clientSecret,
        scope: authn.scope,
        userIdClaim: authn.userIdClaim,
        claimsFrom: authn.claimsFrom,
        paths: authn.paths
      });
  }
};

const createHandle = async () => {
  const sessionStore = await createSessionStore(config.session.store);
  process.once("sveltekit:shutdown", () => {
    sessionStore
      .dispose?.()
      .catch((err) => logger.warn({ err }, "session store did not close cleanly"));
    fileStore?.dispose?.().catch((err) => logger.warn({ err }, "file store did not close cleanly"));
  });
  const authz = createAuthorizer(config.authz, {
    defaultClient: config.authn.kind === "oidc" ? config.authn.clientId : undefined,
    where: "authz"
  });
  logger.info({ authn: config.authn.kind, authz: authz.name }, "auth configured");
  // How the proxy authenticates to each cluster: the kind and, for a service
  // account, its name — never the password.
  logger.info(
    {
      connections: Object.fromEntries(
        Object.entries(config.connections ?? {}).map(([id, c]) => [
          id,
          c.auth.kind === "basic" ? `basic as ${c.auth.username}` : c.auth.kind
        ])
      )
    },
    "connection auth configured"
  );
  // Also builds the per-connection authorizers, so a policy that cannot be
  // built exits here rather than on whichever request first reaches it.
  logConnectionAuthz();

  return sequence(
    // Outermost, so the headers reach every response the rest of the chain
    // returns, refusals included.
    SecurityHeadersHandler(),
    // Before logging and before the session: a probe is not traffic, and must
    // not be issued a cookie or have the store read on its behalf.
    ProbeHandler(sessionStore, fileStore),
    LoggingHandler(),
    await SessionHandler(sessionStore, {
      cookieName: config.session.cookie.name,
      cookieSecret: config.session.cookie.secret,
      maxLifetimeSeconds: config.session.maxLifetimeSeconds,
      cookieOptions: {
        path: config.session.cookie.path ?? "/",
        httpOnly: config.session.cookie.httpOnly ?? true,
        secure: config.session.cookie.secure ?? env.ORIGIN?.startsWith("https") ?? true,
        sameSite: config.session.cookie.sameSite ?? "lax",
        ...(config.session.cookie.domain && { domain: config.session.cookie.domain }),
        ...(config.session.cookie.maxAge && { maxAge: config.session.cookie.maxAge })
      }
    }),
    await authnHandler(config),
    AccessHandler(authz, { isExempt: isAuthPath, loginPath, forbiddenPath })
  );
};

export const handle: Handle = await createHandle();

/**
 * Where a server error actually surfaces.
 *
 * An exception thrown by a route or a load never reaches the `catch` in
 * `LoggingHandler`: SvelteKit catches it inside `resolve`, calls this, and
 * turns it into a 500 response — so without this hook the only trace of a
 * crashed endpoint was an unstructured stack on stderr and a "request
 * completed" line at info. Alerting on level >= error saw nothing.
 *
 * What is returned becomes the body the client is shown, so it carries the
 * request id and nothing else: the message and stack are for the log, and the
 * id is what lets somebody quoting an error be found in it.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const child = event.locals.logger ?? logger;
  // SvelteKit calls this for a 404 as well as for a crash, so the severity has
  // to come from the status. Logging "no such route" at error level would put
  // every bot probing for /wp-admin in front of whoever watches for real
  // failures, which is the same way round as the problem this hook fixes.
  const log = status >= 500 ? child.error.bind(child) : child.warn.bind(child);
  log(
    { err: error, status, method: event.request.method, url: event.request.url },
    status >= 500 ? "unhandled server error" : "request failed"
  );
  return { message, requestId: event.locals.requestId };
};
