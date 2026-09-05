import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { config } from "$lib/server/config";

/** Auth pages (login, error) must render for a signed-out user — see `load`. */
const authPrefix = config.authn.kind === "oidc" ? config.authn.paths.prefix : "/auth";

const isAuthPage = (pathname: string) =>
  pathname === authPrefix || pathname.startsWith(authPrefix + "/");

export const load: LayoutServerLoad = async ({ locals, url }) => {
  // The auth pages are exempt from the gate. Gating them sends a signed-out
  // visitor of /auth/error to /auth/login, which the OIDC handler forwards
  // straight back to the provider — so the error page was never reachable.
  if (config.authn.kind !== "none" && !locals.userId && !isAuthPage(url.pathname)) {
    const returnTo = url.pathname + url.search;
    redirect(303, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  const connections = Object.entries(config.connections ?? {}).map(
    ([id, conn]) => ({ id, name: conn.name })
  );
  return {
    claims: locals.claims,
    userId: locals.userId,
    connections,
  };
};
