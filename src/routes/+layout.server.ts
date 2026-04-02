import type { LayoutServerLoad } from "./$types";
import { config } from "$lib/server/config";

export const load: LayoutServerLoad = async ({ locals }) => {
  const connections = Object.entries(config.connections ?? {}).map(
    ([id, conn]) => ({ id, name: conn.name })
  );
  return {
    claims: locals.claims,
    userId: locals.userId,
    connections,
  };
};
