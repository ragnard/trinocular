import { afterEach, describe, expect, test } from "bun:test";

import Trino, { HttpError } from "./index";

const realFetch = globalThis.fetch;

/** Makes every request answer with this response. */
function answer(status: number, body: string | null, statusText = "") {
  globalThis.fetch = (async () =>
    new Response(body, {
      status,
      statusText,
      headers: { "content-type": "application/json" }
    })) as unknown as typeof fetch;
}

async function failure(): Promise<HttpError> {
  const trino = Trino.create({ server: "/api/trino/x" });
  try {
    await trino.request({ url: "/v1/statement" });
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  throw new Error("expected the request to fail");
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("HttpError", () => {
  test("carries the proxy's message, with the status after it", async () => {
    answer(502, JSON.stringify({ message: "Failed to connect to upstream Trino server" }));
    const e = await failure();
    expect(e.message).toBe("Failed to connect to upstream Trino server (HTTP 502)");
    expect(e.status).toBe(502);
  });

  test("carries the gate's refusal", async () => {
    answer(403, JSON.stringify({ error: "forbidden" }), "Forbidden");
    const e = await failure();
    expect(e.message).toBe("forbidden (HTTP 403 Forbidden)");
    expect(e.status).toBe(403);
  });

  test("keeps the status on a 401 so the sign-out check still sees it", async () => {
    answer(401, JSON.stringify({ error: "unauthorized" }));
    expect((await failure()).status).toBe(401);
  });

  test("falls back to the status and its text when the body says nothing", async () => {
    answer(502, null, "Bad Gateway");
    expect((await failure()).message).toBe("HTTP 502 Bad Gateway");
  });

  test("falls back to the status alone under HTTP/2, where statusText is empty", async () => {
    answer(502, null);
    expect((await failure()).message).toBe("HTTP 502");
  });

  test("ignores a body that is not JSON, or JSON with nothing to say", async () => {
    answer(500, "<html>Internal Server Error</html>");
    expect((await failure()).message).toBe("HTTP 500");
    answer(500, JSON.stringify({ message: "", requestId: "abc" }));
    expect((await failure()).message).toBe("HTTP 500");
    answer(500, JSON.stringify({ error: { message: "nested" } }));
    expect((await failure()).message).toBe("HTTP 500");
  });
});
