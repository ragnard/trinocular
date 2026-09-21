import type { RequestEvent } from "./$types";

import { config, type Connection } from "$lib/server/config";
import { error } from "$lib/server/errors";
import type { Identity } from "$lib/server/identity";
import { isTrinoHeader } from "$lib/trino";
import { mayUseConnection, connectionDenialReason } from "$lib/server/connectionAuthz";
import { upstreamAuthHeaders } from "$lib/server/connectionAuth";
import { refuse } from "$lib/server/authz";

const ALLOWED_PATH_PREFIXES = ["/v1/statement", "/v1/query/"];

/**
 * Resolves the upstream URL, enforcing that it is still *this connection's*
 * Trino, at a path Trino's client protocol actually uses.
 *
 * Both halves are checked against the parsed `url`, not the raw parameter,
 * because `new URL` is what decides where the request finally goes:
 *
 *  - the path, because SvelteKit decodes a route param once, so a double-encoded
 *    traversal (`%252e%252e`) arrives as the literal text "%2e%2e". That slips
 *    past a `startsWith("/v1/statement")` test on the raw string and is only
 *    then normalised away by the URL parser.
 *  - the origin, because a parameter beginning with `/` makes `"/" + path` a
 *    protocol-relative URL: `//evil.example/v1/statement` resolves to a
 *    different *host* while leaving `pathname` as `/v1/statement`, so the path
 *    allowlist waves it through. The request would then carry `X-Trino-User`
 *    and the caller's bearer token to whatever host the path named — reachable
 *    from a plain link, since a top-level GET navigation sends a SameSite=Lax
 *    cookie. Checking the path without the origin is checking the half that
 *    was never in doubt.
 */
function toTargetUrl(event: RequestEvent, target: Connection): string {
  const url = new URL("/" + (event.params.path ?? ""), target.uri);
  if (url.origin !== new URL(target.uri).origin) {
    error(
      event.locals.logger,
      400,
      "Invalid Trino API path",
      "trino API path left the target origin",
      {
        origin: url.origin
      }
    );
  }
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
  "x-trino-path",
  "x-trino-time-zone",
  "x-trino-session",
  "x-trino-prepared-statement"
]);

/**
 * What the request carries upstream: the session headers the browser sent,
 * then who the query runs as, then the credential the cluster authenticates.
 *
 * The two identity halves are decided by different things on purpose.
 * `X-Trino-User` is the gate's identity, always, never a client claim and
 * never configurable — a cluster that sees a different user than the one who
 * signed in here would be one whose audit log lies. The credential is the
 * connection's `auth`: nothing, a service account the cluster then lets
 * impersonate that user, or the user's own token. It used to be the token
 * whenever there was one, to every connection alike, which sent a bearer to
 * clusters that were never going to check it.
 */
function createUpstreamHeaders(
  event: RequestEvent,
  identity: Identity,
  target: Connection
): Record<string, string> | "unauthenticated" {
  const headers: Record<string, string> = {
    accept: "application/json"
  };
  event.request.headers.forEach((value, name) => {
    if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) {
      headers[name] = value;
    }
  });
  headers["x-trino-user"] = identity.userId;
  const auth = upstreamAuthHeaders(target.auth, event.locals.accessToken);
  if (auth === "unauthenticated") return auth;
  return { ...headers, ...auth };
}

/**
 * The headers of the cluster's answer that are allowed back to the browser.
 *
 * The `X-Trino-` prefix match is deliberate here where the request direction
 * needs a list: these are the cluster talking back (Set-Catalog, Set-Session,
 * Added-Prepare, the Clear-* pair), and the client needs all of them to keep
 * its session in step. Only the request direction carries something a caller
 * could assert about itself.
 *
 * Everything else is dropped, and that has to hold on *every* path out —
 * including an upstream error, which is where it used to be skipped. Whatever
 * answers at the connection URI is not necessarily Trino, and `Set-Cookie` from
 * it lands on this app's origin: a 401 carrying one overwrote the session
 * cookie, which is session fixation handed over by the proxy. `content-type`
 * is kept because the body is passed through unread and is meaningless without
 * it; `content-length` and `content-encoding` are not, since fetch has already
 * decoded the body and both would then describe something else.
 */
function downstreamHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  const contentType = response.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  response.headers.forEach((value, name) => {
    if (isTrinoHeader(name)) headers[name] = value;
  });
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
  if (!identity) return refuse(401, "unauthorized");

  // The application-wide policy passed at the gate; this cluster may still
  // have one of its own. Checked here rather than in the hook because the hook
  // runs before routing and has no connection id to check against, and checked
  // even though the connection list the browser was given is already filtered
  // — that list is a menu, not a lock, and this route takes its id from the
  // URL.
  if (!mayUseConnection(identity, id)) {
    event.locals.logger.warn(
      { userId: identity.userId, connection: id, reason: connectionDenialReason(identity, id) },
      "connection authz denied"
    );
    return refuse(403, "forbidden");
  }

  // The id, not the whole connection: `target` carries the cluster's `authz`
  // policy now, and the request's own URL is already on the completion line
  // that LoggingHandler writes.
  event.locals.logger.debug({ id }, "proxying request");

  const url = toTargetUrl(event, target);
  const headers = createUpstreamHeaders(event, identity, target);
  // A `user-token` connection with no token to send. Not reachable through the
  // OIDC handler, which sets both together; answered as signed out, which the
  // client turns into a trip to the login page, rather than sent on bare.
  if (headers === "unauthenticated") return refuse(401, "unauthorized");

  const requestBody = event.request.body ? await event.request.blob() : null;

  let response: Response;
  try {
    response = await fetch(url, {
      method: event.request.method,
      headers: headers,
      body: requestBody
    });
  } catch (err) {
    error(
      event.locals.logger,
      502,
      "Failed to connect to upstream Trino server",
      "upstream request failed",
      { id, url, err }
    );
  }

  // Only a 200 JSON answer has URIs to rewrite. Everything else — a HEAD's
  // answer (a JSON content-type and no body, which `json()` would choke on),
  // an upstream error, a body of some other type — is passed through unread,
  // under the same header allowlist.
  const contentType = response.headers.get("content-type") ?? "";
  const passThrough =
    event.request.method === "HEAD" ||
    response.status !== 200 ||
    !contentType.includes("application/json");
  if (passThrough) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: downstreamHeaders(response)
    });
  }

  const responseBody = await response.json();

  updateResponseBody(responseBody, event, target, id);

  const responseHeaders = downstreamHeaders(response);
  responseHeaders["Content-Type"] = "application/json";

  return new Response(JSON.stringify(responseBody), {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
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

const handle = (event: RequestEvent) => proxy(event, ...getServer(event));

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const DELETE = handle;
