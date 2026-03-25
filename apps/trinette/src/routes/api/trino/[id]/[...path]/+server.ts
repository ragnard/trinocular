import { error } from "@sveltejs/kit";

import type { RequestEvent } from "./$types";

import type { Connection } from "$lib/server/config.ts";


import { env } from "$env/dynamic/private";

const LOCAL_URL = "http://localhost:5173"; //env.TRINETTE_ORIGIN;

function toTargetUrl(request: Request, target: Connection): string {
  return request.url.replace(`${LOCAL_URL}/api/trino/${target.id}`, target.uri);
}

function toProxyUrl(url: string, target: Connection) {
  return url.replace(target.uri, `${LOCAL_URL}/api/trino/${target.id}`);
}

function createUpstreamHeaders(event: RequestEvent) {
  return {
    accept: "application/json",
    'x-trino-user': 'ragge',
    // authorization: "bearer " + event.locals.accessToken
  };
}

function updateResponseBody(response: Record<any, any>, target: Connection) {
  ["nextUri", "partialCancelUri"].forEach((k) => {
    if (response[k]) {
      response[k] = toProxyUrl(response[k], target);
    }
  });
}

async function proxy(event: RequestEvent, target: Connection) {
  // event.locals.logger.debug("proxying request", target);
  console.log("proxying request", target);
  const request = event.request;

  const url = toTargetUrl(request, target);
  const headers = createUpstreamHeaders(event);

  // console.log("url", url);

  const requestBody = request.body ? await request.blob() : null;
  // let requestBody = request.body;

  const response = await fetch(url, {
    method: request.method,
    headers: headers,
    body: requestBody
    //duplex: 'half',
  });

  if (response.status != 200) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }
  // console.log(response.headers);

  const responseBody = await response.json();

  updateResponseBody(responseBody, target);

  // console.log(responseBody);

  return new Response(JSON.stringify(responseBody), {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function getServer(event: RequestEvent): Connection {
  // const serverId = event.params.id;
  // const server = getConfig().connections.find((s) => s.id == serverId);
  // if (!server) {
  //   error(404, `No server with id ${serverId}`);
  // }
  // return server;
  return {
    "id": "test",
    "name": "test",
    "uri": "http://localhost:8080",
  }
}

export function GET(event: RequestEvent) {
  return proxy(event, getServer(event));
}

export async function POST(event: RequestEvent) {
  return proxy(event, getServer(event));
}

export async function DELETE(event: RequestEvent) {
  return proxy(event, getServer(event));
}
