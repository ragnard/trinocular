import { type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";

import { Config, getConfig } from "$lib/server/config.ts";
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
        redirectPath: authn.redirectPath,
        scope: authn.scope,
        userIdClaim: authn.userIdClaim
      });
    default:
      throw new Error("unimplemented authentication kind: " + authn.kind);
  }
};

const createHandle = async () => {
  const config = getConfig();
  const sessionStore = new InMemoryStore();

  return sequence(
    await LoggingHandler(),
    await SessionHandler(sessionStore, {
      cookieName: config.session.cookieName,
      cookieSecret: config.session.cookieSecret,
      cookieOptions: {
        path: "/"
      }
    }),
    await authnHandler(config)
  );
};

export const handle: Handle = await createHandle();
