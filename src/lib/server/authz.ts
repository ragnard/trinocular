import { redirect, type Handle } from "@sveltejs/kit";

import { claim, stringList, type Identity } from "./identity";
import { error } from "./errors";

/** Why a request was refused. The reason is written to the log and never to
 *  the response: it names claims the user cannot change and would only tell an
 *  attacker which role to go and ask for. */
export type Decision = { allowed: true } | { allowed: false; reason: string };

export interface Authorizer {
  /** For the startup log, so a deployment can be read back from its logs. */
  readonly name: string;
  authorize(identity: Identity): Decision;
}

/** Every authenticated identity passes. The default, and the whole policy for
 *  a deployment whose authn mechanism is already the gate it wants. */
export const AllowAll = (): Authorizer => ({
  name: "allow",
  authorize: () => ({ allowed: true })
});

/** Requires a role granted to a specific OIDC client — Keycloak writes those to
 *  `resource_access.<client>.roles`, distinct from the realm-wide roles in
 *  `realm_access.roles`, so a user can be an admin of one application without
 *  being one everywhere. The claim path is configurable because only the
 *  default is Keycloak's; the shape (a list of strings under a path) is what
 *  every provider has in common. */
export const RequireRole = (opts: { role: string; claimPath: string }): Authorizer => ({
  name: `require-role(${opts.claimPath} contains "${opts.role}")`,
  authorize(identity) {
    const roles = stringList(claim(identity.claims, opts.claimPath));
    if (roles.includes(opts.role)) return { allowed: true };
    return {
      allowed: false,
      reason: `identity has no "${opts.role}" in ${opts.claimPath} (found: ${
        roles.length ? roles.join(", ") : "nothing"
      })`
    };
  }
});

interface AuthzOptions {
  /** Paths that must stay reachable to a refused user — the login, error and
   *  forbidden pages, and logout above all: a user who cannot get past authz
   *  must still be able to sign out and come back as somebody else. */
  isExempt: (pathname: string) => boolean;
  forbiddenPath: string;
}

/** Runs after authn, on the identity authn established.
 *
 *  An unauthenticated request is not this handler's business: it has no
 *  identity to judge, and the layout's own gate already sends it to the login
 *  page. Refusing it here instead would answer "who are you?" with "not you",
 *  and a signed-out visitor would meet the forbidden page rather than a login
 *  button. */
export const AuthzHandler = (authorizer: Authorizer, opts: AuthzOptions): Handle => {
  return async ({ event, resolve }) => {
    const identity = event.locals.identity;

    if (identity && !opts.isExempt(event.url.pathname)) {
      const decision = authorizer.authorize(identity);
      if (!decision.allowed) {
        event.locals.logger.warn(
          { userId: identity.userId, authorizer: authorizer.name, reason: decision.reason },
          "authz denied"
        );
        // A navigation gets a page that explains itself; anything else — the
        // Trino proxy, a fetch — gets the status code it can act on.
        if (event.isDataRequest || event.request.headers.get("accept")?.includes("text/html")) {
          redirect(303, opts.forbiddenPath);
        }
        error(event.locals.logger, 403, "Not authorized", "authz denied", {
          userId: identity.userId
        });
      }
    }

    return await resolve(event);
  };
};
