import type { LayoutServerLoad } from "./$types";
import { visibleConnections } from "$lib/server/connectionAuthz";
import { config, loginPath, logoutPath } from "$lib/server/config";

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
    // Where the browser keeps the documents: its own localStorage, or the
    // server's file store behind /api/workspace.
    fileStorage: config.files.store.kind === "browser" ? "browser" : "server",
    // The most a run may bring into the browser; enforced there, by `Result`.
    results: config.results,
    // Where the browser goes when a request answers 401 (`signedOut`): the
    // gate's own login path, which under OIDC is the trigger under
    // `paths.prefix` and not the password form's route.
    loginPath,
    // Where the account menu's — and the forbidden page's — `Sign out` posts.
    logoutPath
  };
};
