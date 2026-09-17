import type { RequestHandler } from "./$types";

import { FileSchema, expectedVersion, json, readBody, workspaceOf } from "$lib/server/workspaceApi";

/**
 * Writes one document against the version the caller expects. A wrong guess
 * is a 412 carrying what the store holds — or `null` when the document has
 * gone — so the browser can decide whose copy wins without asking again.
 */
export const PUT: RequestHandler = async (event) => {
  const workspace = workspaceOf(event);
  if (workspace instanceof Response) return workspace;
  const { store, userId } = workspace;

  const expected = expectedVersion(event);
  if (expected === undefined) {
    return json(428, { error: "a write says which version it replaces" });
  }
  const file = await readBody(event, FileSchema);
  if (file instanceof Response) return file;
  if (file.id !== event.params.id) return json(400, { error: "id does not match the path" });

  const result = await store.put(userId, file, expected);
  if (result.status === "conflict")
    return json(412, { error: "conflict", current: result.current });
  return json(200, { version: result.version });
};

export const DELETE: RequestHandler = async (event) => {
  const workspace = workspaceOf(event);
  if (workspace instanceof Response) return workspace;
  const { store, userId } = workspace;
  await store.remove(userId, event.params.id);
  return json(204);
};
