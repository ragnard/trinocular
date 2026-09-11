import type { LayoutServerLoad } from "./$types";
import { visibleConnections } from "$lib/server/connectionAuthz";
import { authPrefix, config } from "$lib/server/config";

// The authn/authz gate used to live here, as a redirect for a missing userId.
// It is `AccessHandler` in hooks.server.ts now: a layout only guards what
// renders under it, so an API route inherited nothing from this check.

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    branding: config.branding,
    // Only the userId reaches the browser. The rest of the claims are what
    // authz judges on and have no reader on the client; shipping a whole token
    // payload to the page would be exposure bought for nothing.
    userId: locals.identity?.userId,
    // Only the clusters this user may actually query. The proxy checks the
    // same thing again per request — this list is what the switcher draws, not
    // what enforces anything.
    connections: visibleConnections(locals.identity),
    // Where the account menu's `Sign out` posts. Undefined with no provider to
    // sign out of, which is what makes the item disappear rather than offer a
    // way out of a session `authn: none` never opened.
    logoutPath:
      config.authn.kind === "oidc" ? `${authPrefix}/${config.authn.paths.logout}` : undefined
  };
};
