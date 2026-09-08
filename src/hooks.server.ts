import { type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";

import { config, forbiddenPath, isAuthPath, loginPath, type Config } from "$lib/server/config";
import { env } from "$env/dynamic/private";
import { SessionHandler, InMemoryStore } from "$lib/server/session";
import { OIDCHandler } from "$lib/server/oidc";
import { LoggingHandler } from "$lib/server/logging";
import { AccessHandler, AllowAll, RequireRole, type Authorizer } from "$lib/server/authz";
import { logger } from "$lib/server/logging";
import { parseClaimPath, type Claims } from "$lib/server/identity";

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

/** Turns the configured policy into an authorizer. The one thing authz borrows
 *  from authn is the default client for a role lookup: "the role I granted
 *  Trinette" means the roles of the client Trinette signs in as. */
const authorizer = (config: Config): Authorizer => {
  const authz = config.authz;

  switch (authz.kind) {
    case "allow":
      return AllowAll();
    case "require-role": {
      if (authz.claim) {
        return RequireRole({ role: authz.role, claimPath: parseClaimPath(authz.claim) });
      }
      const client =
        authz.client ?? (config.authn.kind === "oidc" ? config.authn.clientId : undefined);
      if (!client) {
        logger.error(
          "authz require-role needs a `client` or `claim`: there is no OIDC clientId to default to"
        );
        process.exit(1);
      }
      // Segments, not `resource_access.${client}.roles`: a clientId may itself
      // contain a dot, and interpolating one into a dotted path would send the
      // lookup down levels that do not exist.
      return RequireRole({ role: authz.role, claimPath: ["resource_access", client, "roles"] });
    }
  }
};

const createHandle = async () => {
  const sessionStore = new InMemoryStore();
  const authz = authorizer(config);
  logger.info({ authn: config.authn.kind, authz: authz.name }, "auth configured");

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
