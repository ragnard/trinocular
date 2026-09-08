import { redirect, type Handle, type RequestEvent } from "@sveltejs/kit";

import { claim, formatClaimPath, stringList, type ClaimPath, type Identity } from "./identity";

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
export const RequireRole = (opts: { role: string; claimPath: ClaimPath }): Authorizer => {
  const path = formatClaimPath(opts.claimPath);
  return {
    name: `require-role(${path} contains "${opts.role}")`,
    authorize(identity) {
      const roles = stringList(claim(identity.claims, opts.claimPath));
      if (roles.includes(opts.role)) return { allowed: true };
      return {
        allowed: false,
        reason: `identity has no "${opts.role}" in ${path} (found: ${
          roles.length ? roles.join(", ") : "nothing"
        })`
      };
    }
  };
};

interface AccessOptions {
  /** Paths that must stay reachable to a signed-out or refused user — the
   *  login, error and forbidden pages, and logout above all: a user who cannot
   *  get past authz must still be able to sign out and come back as somebody
   *  else. */
  isExempt: (pathname: string) => boolean;
  loginPath: string;
  forbiddenPath: string;
}

/** Whether a refusal should be a page the user can read or a status code the
 *  caller can act on. A data request is a client-side navigation: SvelteKit
 *  turns a redirect thrown here into one its router follows. */
const isNavigation = (event: RequestEvent): boolean =>
  event.isDataRequest || (event.request.headers.get("accept")?.includes("text/html") ?? false);

/** Where to send the user back to once they have signed in. A data request
 *  asks for `/some/page/__data.json`, which is not a page anyone can return to
 *  — and carries SvelteKit's own invalidation parameter, which is noise in a
 *  bookmarkable URL. Both have to come off. */
const returnTo = (event: RequestEvent): string => {
  const pathname = event.isDataRequest
    ? event.url.pathname.replace(/\/__data\.json$/, "") || "/"
    : event.url.pathname;
  const params = new URLSearchParams(event.url.searchParams);
  params.delete("x-sveltekit-invalidated");
  const query = params.toString();
  return pathname + (query ? `?${query}` : "");
};

/** A refusal a program can read. Thrown SvelteKit errors render the fallback
 *  HTML error page even for a JSON caller, which the Trino client would meet as
 *  a parse failure rather than a status. */
const refuse = (status: number, error: string): Response =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" }
  });

/** The whole gate, in one place and after authn: is there an identity, and may
 *  it do this?
 *
 *  Both halves live here rather than the authn half sitting in a layout load,
 *  because a layout only guards what renders under it. An API route added
 *  tomorrow would inherit nothing from it and serve anonymous traffic until
 *  somebody remembered to write its own check — the failure the Trino proxy's
 *  hand-rolled 401 exists to patch. Default-deny with a named list of
 *  exemptions is the only arrangement where forgetting is safe. */
export const AccessHandler = (authorizer: Authorizer, opts: AccessOptions): Handle => {
  return async ({ event, resolve }) => {
    if (opts.isExempt(event.url.pathname)) return await resolve(event);

    const identity = event.locals.identity;

    if (!identity) {
      if (isNavigation(event)) {
        redirect(303, `${opts.loginPath}?returnTo=${encodeURIComponent(returnTo(event))}`);
      }
      return refuse(401, "unauthorized");
    }

    const decision = authorizer.authorize(identity);
    if (!decision.allowed) {
      event.locals.logger.warn(
        { userId: identity.userId, authorizer: authorizer.name, reason: decision.reason },
        "authz denied"
      );
      if (isNavigation(event)) {
        redirect(303, opts.forbiddenPath);
      }
      return refuse(403, "forbidden");
    }

    return await resolve(event);
  };
};
