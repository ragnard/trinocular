import { type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";

import { config, forbiddenPath, isAuthPath, loginPath, type Config } from "$lib/server/config";
import { env } from "$env/dynamic/private";
import { SessionHandler, InMemoryStore } from "$lib/server/session";
import { OIDCHandler } from "$lib/server/oidc";
import { LoggingHandler } from "$lib/server/logging";
import { AccessHandler, createAuthorizer } from "$lib/server/authz";
import { logConnectionAuthz } from "$lib/server/connectionAuthz";
import { logger } from "$lib/server/logging";
import { type Claims } from "$lib/server/identity";

const NoAuthnHandler = async (opts: { user: string; claims: Claims }): Promise<Handle> => {
  return async ({ event, resolve }) => {
    event.locals.identity = { userId: opts.user, claims: opts.claims };
    return resolve(event);
  };
};

const authnHandler = async (config: Config) => {
  let authn = config.authn;

  switch (authn.kind) {
    case "none":
      return await NoAuthnHandler({ user: authn.user, claims: authn.claims });
    case "oidc":
      return await OIDCHandler({
        issuer: new URL(authn.issuer),
        clientId: authn.clientId,
        clientSecret: authn.clientSecret,
        scope: authn.scope,
        userIdClaim: authn.userIdClaim,
        claimsFrom: authn.claimsFrom,
        paths: authn.paths,
      });
  }
};

const createHandle = async () => {
  const sessionStore = new InMemoryStore();
  const authz = createAuthorizer(config.authz, {
    defaultClient: config.authn.kind === "oidc" ? config.authn.clientId : undefined,
    where: "authz"
  });
  logger.info({ authn: config.authn.kind, authz: authz.name }, "auth configured");
  // Also builds the per-connection authorizers, so a policy that cannot be
  // built exits here rather than on whichever request first reaches it.
  logConnectionAuthz();

  return sequence(
    await LoggingHandler(),
    await SessionHandler(sessionStore, {
      cookieName: config.session.cookie.name,
      cookieSecret: config.session.cookie.secret,
      maxLifetimeSeconds: config.session.maxLifetimeSeconds,
      cookieOptions: {
        path: config.session.cookie.path ?? "/",
        httpOnly: config.session.cookie.httpOnly ?? true,
        secure: config.session.cookie.secure ?? (env.ORIGIN?.startsWith("https") ?? true),
        sameSite: config.session.cookie.sameSite ?? "lax",
        ...(config.session.cookie.domain && { domain: config.session.cookie.domain }),
        ...(config.session.cookie.maxAge && { maxAge: config.session.cookie.maxAge }),
      }
    }),
    await authnHandler(config),
    AccessHandler(authz, { isExempt: isAuthPath, loginPath, forbiddenPath })
  );
};

export const handle: Handle = await createHandle();
