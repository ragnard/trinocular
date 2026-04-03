import { type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";

import { config, type Config } from "$lib/server/config";
import { env } from "$env/dynamic/private";
import { SessionHandler, InMemoryStore } from "$lib/server/session";
import { OIDCHandler } from "$lib/server/oidc";
import { LoggingHandler } from "$lib/server/logging";

const NoAuthnHandler = async (opts: { user: string }): Promise<Handle> => {
  return async ({ event, resolve }) => {
    event.locals.userId = opts.user;
    return resolve(event);
  };
};

const authnHandler = async (config: Config) => {
  let authn = config.authn;

  switch (authn.kind) {
    case "none":
      return await NoAuthnHandler({ user: authn.user });
    case "oidc":
      return await OIDCHandler({
        issuer: new URL(authn.issuer),
        clientId: authn.clientId,
        clientSecret: authn.clientSecret,
        scope: authn.scope,
        userIdClaim: authn.userIdClaim,
        paths: authn.paths,
      });
  }
};

const createHandle = async () => {
  const sessionStore = new InMemoryStore();

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
    await authnHandler(config)
  );
};

export const handle: Handle = await createHandle();
