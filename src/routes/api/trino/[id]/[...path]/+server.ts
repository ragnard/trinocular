import { error } from "@sveltejs/kit";

import type { RequestEvent } from "./$types";

import { config, type Connection } from "$lib/server/config";
import { isTrinoHeader } from "$lib/trino";

const ALLOWED_PATH_PREFIXES = ["/v1/statement", "/v1/query/"];

function getTrinoPath(event: RequestEvent): string {
  const path = "/" + (event.params.path ?? "");
  if (!ALLOWED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    error(400, `Invalid Trino API path: ${path}`);
  }
  return path;
}

function toTargetUrl(event: RequestEvent, target: Connection): string {
  const path = getTrinoPath(event);
  const url = new URL(path, target.uri);
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

function createUpstreamHeaders(event: RequestEvent) {
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  event.request.headers.forEach((value, name) => {
    if (isTrinoHeader(name)) {
      headers[name] = value;
    }
  });
  // Override with server-side auth — takes precedence over client-sent values
  headers["x-trino-user"] = event.locals.userId;
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
  event.locals.logger.debug({ id, target }, "proxying request");

  const url = toTargetUrl(event, target);
  const headers = createUpstreamHeaders(event);

  const requestBody = event.request.body ? await event.request.blob() : null;

  let response: Response;
  try {
    response = await fetch(url, {
      method: event.request.method,
      headers: headers,
      body: requestBody,
    });
  } catch (err) {
    event.locals.logger.error({ id, url, err }, "upstream request failed");
    error(502, `Failed to connect to upstream Trino server: ${err instanceof Error ? err.message : err}`);
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
    error(404, `No server with id ${id}`);
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
