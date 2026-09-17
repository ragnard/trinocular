import type { RequestEvent } from "@sveltejs/kit";
import { z } from "zod";

import { config } from "./config";
import { fileStore, type FileStore } from "./fileStore";

/** Always JSON: the only caller is the browser's store, and a thrown SvelteKit
 *  error would render the fallback HTML page at it. */
export const json = (status: number, body: unknown = null): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });

/**
 * The store and whose files, or the refusal. The user id is the gate's and
 * never the request's: the gate has already run, so a missing identity here
 * is a route the exempt list has grown to cover by mistake, and 401 is the
 * honest answer to that too.
 */
export const workspaceOf = (
  event: RequestEvent
): { store: FileStore; userId: string } | Response => {
  if (!fileStore) return json(404, { error: "files are kept in the browser" });
  const identity = event.locals.identity;
  if (!identity) return json(401, { error: "unauthorized" });
  return { store: fileStore, userId: identity.userId };
};

/** What the browser may hand over. Ids are what `crypto.randomUUID()` mints
 *  and nothing else, so a key is never a client's choice of length. */
export const FileSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(255),
  content: z.string(),
  connectionId: z.string().max(255),
  viewFormats: z.record(z.string().max(1024), z.string().max(64))
});

export const UiSchema = z.object({
  activeFileId: z.uuid().optional(),
  order: z.array(z.uuid()).max(10_000)
});

/** The body, parsed against a schema, or the refusal: 413 over the cap and
 *  400 for anything that is not the record it claims to be. */
export const readBody = async <T>(
  event: RequestEvent,
  schema: z.ZodType<T>
): Promise<T | Response> => {
  const tooBig = json(413, { error: `over the ${config.files.maxBytes} byte limit` });
  if (Number(event.request.headers.get("content-length") ?? 0) > config.files.maxBytes) {
    return tooBig;
  }
  let raw: string;
  try {
    raw = await event.request.text();
  } catch {
    // adapter-node's own BODY_SIZE_LIMIT, which fails the body stream rather
    // than the request, and would otherwise surface as a 500.
    return tooBig;
  }
  if (Buffer.byteLength(raw) > config.files.maxBytes) return tooBig;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return json(400, { error: "not JSON" });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) return json(400, { error: "not a valid record" });
  return parsed.data;
};

/**
 * The version a write expects, from the conditional request headers: an
 * `If-Match` with the version quoted as an ETag, or `If-None-Match: *` for a
 * document being created. A write that says neither is refused, since an
 * unconditional write is the thing the versions exist to rule out.
 */
export const expectedVersion = (event: RequestEvent): string | null | undefined => {
  const headers = event.request.headers;
  if (headers.get("if-none-match") === "*") return null;
  const match = headers.get("if-match");
  if (match === null) return undefined;
  const version = /^"(.*)"$/.exec(match.trim())?.[1];
  return version === undefined ? undefined : version;
};
