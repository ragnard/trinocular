import type { LayoutServerLoad } from "./$types";

import { getConfig } from "$lib/server/config";

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    config: { ...getConfig() },
    claims: locals.claims,
    userId: locals.userId
  };
};
