import type { PageServerLoad } from "./$types";
import { authPrefix, config } from "$lib/server/config";

export const load: PageServerLoad = async ({ locals }) => {
  return {
    userId: locals.identity?.userId,
    // Signing out is the only move a refused user has: the account is wrong,
    // not the request. With no provider there is nothing to sign out of.
    logoutPath:
      config.authn.kind === "oidc" ? `${authPrefix}/${config.authn.paths.logout}` : undefined
  };
};
