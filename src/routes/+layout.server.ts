import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { authPrefix, config } from "$lib/server/config";

/** Auth pages (login, error, forbidden) must render for a signed-out user — see `load`. */
const isAuthPage = (pathname: string) =>
  pathname === authPrefix || pathname.startsWith(authPrefix + "/");

export const load: LayoutServerLoad = async ({ locals, url }) => {
  // The auth pages are exempt from the gate. Gating them sends a signed-out
  // visitor of /auth/error to /auth/login, which the OIDC handler forwards
  // straight back to the provider — so the error page was never reachable.
  if (config.authn.kind !== "none" && !locals.identity && !isAuthPage(url.pathname)) {
    const returnTo = url.pathname + url.search;
    redirect(303, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  const connections = Object.entries(config.connections ?? {}).map(
    ([id, conn]) => ({ id, name: conn.name })
  );
  return {
    // Only the userId reaches the browser. The rest of the claims are what
    // authz judges on and have no reader on the client; shipping a whole token
    // payload to the page would be exposure bought for nothing.
    userId: locals.identity?.userId,
    connections,
  };
};
