import type { LayoutServerLoad } from "./$types";
import { config } from "$lib/server/config";

// The authn/authz gate used to live here, as a redirect for a missing userId.
// It is `AccessHandler` in hooks.server.ts now: a layout only guards what
// renders under it, so an API route inherited nothing from this check.

export const load: LayoutServerLoad = async ({ locals }) => {
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
