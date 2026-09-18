import type { RequestHandler } from "./$types";

import { json, workspaceOf } from "$lib/server/workspaceApi";

/** Every document of the signed-in user, with the version each is held
 *  under, and the ui record if there is one. Ordering is the browser's job. */
export const GET: RequestHandler = async (event) => {
  const workspace = workspaceOf(event);
  if (workspace instanceof Response) return workspace;
  const { store, userId } = workspace;
  return json(200, await store.list(userId));
};
