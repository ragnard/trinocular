import type { RequestEvent } from "./$types";

import { config, type Connection } from "$lib/server/config";
import { error } from "$lib/server/errors";
import type { Identity } from "$lib/server/identity";
import { isTrinoHeader } from "$lib/trino";

const ALLOWED_PATH_PREFIXES = ["/v1/statement", "/v1/query/"];

/**
 * Resolves the upstream URL, enforcing the path allowlist.
 *
 * The allowlist has to be checked against `url.pathname` — that is, *after* the
 * URL parser has resolved dot segments — rather than against the raw parameter.
 * SvelteKit decodes a route param once, so a double-encoded traversal
 * (`%252e%252e`) arrives here as the literal text "%2e%2e": it slips past a
 * `startsWith("/v1/statement")` check on the raw string and is only then
 * normalised away by `new URL`, which would reach any upstream endpoint with
 * the caller's bearer token attached.
 */
function toTargetUrl(event: RequestEvent, target: Connection): string {
  const url = new URL("/" + (event.params.path ?? ""), target.uri);
  if (!ALLOWED_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    error(event.locals.logger, 400, "Invalid Trino API path", "invalid trino API path requested", {
      path: url.pathname
    });
  }
  // Preserve query string from the original request
  url.search = event.url.search;
  return url.toString();
}

function toProxyUrl(url: string, event: RequestEvent, target: Connection, id: string): string {
  const parsed = new URL(url);
  const targetBase = new URL(target.uri);

  // Only rewrite URLs that point to the target Trino server
  if (parsed.origin !== targetBase.origin) {
    return url;
  }

  const proxyBase = `${event.url.origin}/api/trino/${id}`;
  return proxyBase + parsed.pathname + parsed.search;
}

/**
 * The `X-Trino-*` request headers the browser is allowed to set — what shapes a
 * session, and nothing that says who is running the query.
 *
 * It has to be a list rather than the `X-Trino-` prefix test, because several
 * headers under that prefix are identity: `X-Trino-Authorization-User` and
 * `X-Trino-Original-User` are Trino's impersonation headers, `X-Trino-Role`
 * selects a role inside a catalog's access control, and
 * `X-Trino-Extra-Credential` hands credentials to connectors. Overriding
 * `X-Trino-User` server-side while forwarding those would settle who you are
 * and then let the request say who to act as; whether that escalated would
 * depend on the cluster's configuration rather than on anything here.
 *
 * The list is what `src/lib/trino` actually sends. A header the client learns
 * to send later has to be added here too.
 */
const FORWARDED_REQUEST_HEADERS = new Set([
  "x-trino-source",
  "x-trino-catalog",
  "x-trino-schema",
  "x-trino-session",
  "x-trino-prepared-statement"
]);

function createUpstreamHeaders(event: RequestEvent, identity: Identity) {
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  event.request.headers.forEach((value, name) => {
    if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) {
      headers[name] = value;
    }
  });
  // Server-side auth: the identity the gate established, never a client claim.
  headers["x-trino-user"] = identity.userId;
  if (event.locals.accessToken) {
    headers["authorization"] = "bearer " + event.locals.accessToken;
  }
  return headers;
}

function updateResponseBody(
  response: Record<string, unknown>,
  event: RequestEvent,
  target: Connection,
  id: string
) {
  for (const k of ["nextUri", "partialCancelUri"]) {
    if (typeof response[k] === "string") {
      response[k] = toProxyUrl(response[k] as string, event, target, id);
    }
  }
}

async function proxy(event: RequestEvent, target: Connection, id: string) {
  // The access gate in hooks.server.ts already refused an anonymous request.
  // Kept anyway: this route sends a user's name to a cluster, and it should not
  // be reachable without one just because a hook was reordered.
  const identity = event.locals.identity;
  if (!identity) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  event.locals.logger.debug({ id, target }, "proxying request");

  const url = toTargetUrl(event, target);
  const headers = createUpstreamHeaders(event, identity);

  const requestBody = event.request.body ? await event.request.blob() : null;

  let response: Response;
  try {
    response = await fetch(url, {
      method: event.request.method,
      headers: headers,
      body: requestBody,
    });
  } catch (err) {
    error(event.locals.logger, 502, "Failed to connect to upstream Trino server", "upstream request failed", { id, url, err });
  }

  if (response.status !== 200) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const responseBody = await response.json();

  updateResponseBody(responseBody, event, target, id);

  const responseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  // The response direction stays a prefix match: these are the cluster talking
  // back (Set-Catalog, Set-Session, Added-Prepare, the Clear-* pair), and the
  // client needs all of them to keep its session in step. Only the request
  // direction carries something a caller could assert about itself.
  response.headers.forEach((value, name) => {
    if (isTrinoHeader(name)) {
      responseHeaders[name] = value;
    }
  });

  return new Response(JSON.stringify(responseBody), {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

function getServer(event: RequestEvent): [Connection, string] {
  const id = event.params.id;
  const server = config.connections?.[id];
  if (!server) {
    error(event.locals.logger, 404, "Unknown server", "no server with requested id", { id });
  }
  return [server, id];
}

export function GET(event: RequestEvent) {
  return proxy(event, ...getServer(event));
}

export async function POST(event: RequestEvent) {
  return proxy(event, ...getServer(event));
}

export async function DELETE(event: RequestEvent) {
  return proxy(event, ...getServer(event));
}
