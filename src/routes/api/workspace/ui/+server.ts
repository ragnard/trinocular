import type { RequestHandler } from "./$types";

import { UiSchema, json, readBody, workspaceOf } from "$lib/server/workspaceApi";

/** The active document and the listing order. Advisory, so the last writer
 *  wins and there is no version to get wrong. */
export const PUT: RequestHandler = async (event) => {
  const workspace = workspaceOf(event);
  if (workspace instanceof Response) return workspace;
  const { store, userId } = workspace;
  const ui = await readBody(event, UiSchema);
  if (ui instanceof Response) return ui;
  await store.putUi(userId, ui);
  return json(204);
};
