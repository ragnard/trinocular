import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { config } from "$lib/server/config";

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (config.authn.kind !== "none" && !locals.userId) {
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
