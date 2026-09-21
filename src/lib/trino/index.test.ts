import { afterEach, describe, expect, test } from "bun:test";

import Trino, { HttpError, retryDelay, type Retry, type RetryPolicy } from "./index";

const realFetch = globalThis.fetch;

function response(status: number, body: string | null, statusText = ""): Response {
  return new Response(body, {
    status,
    statusText,
    headers: { "content-type": "application/json" }
  });
}

/** Makes every request answer with this response. */
function answer(status: number, body: string | null, statusText = "") {
  globalThis.fetch = (async () => response(status, body, statusText)) as unknown as typeof fetch;
}

/**
 * One answer per request, in order — a status, or `"network"` for a `fetch`
 * that rejects the way a dropped connection does — and the last one for
 * every request after. Returns the requests made, method and URL.
 */
function answers(...sequence: (number | "network")[]): { method: string; url: string }[] {
  const requests: { method: string; url: string }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ method: init?.method ?? "GET", url });
    const step = sequence[Math.min(requests.length, sequence.length) - 1];
    if (step === "network") throw new TypeError("Failed to fetch");
    return response(step, step < 400 ? JSON.stringify({ id: "q", data: [[1]] }) : null);
  }) as unknown as typeof fetch;
  return requests;
}

/** Fast enough for a test, and every delay is still a distinct number. */
const QUICK: RetryPolicy = { initialDelayMs: 1, maxDelayMs: 4, windowMs: 5_000 };

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

describe("retrying a poll", () => {
  const rejected = async (p: Promise<unknown>): Promise<Error> => {
    try {
      await p;
    } catch (e) {
      return e as Error;
    }
    throw new Error("expected the request to fail");
  };

  test("retries a nextUri GET through 502, 503 and 504", async () => {
    const requests = answers(502, 503, 504, 200);
    const trino = Trino.create({ server: "/api/trino/x", retry: QUICK });
    const chunk = await trino.nextChunk("/v1/statement/queued/q/1");
    expect(chunk.data).toEqual([[1]]);
    expect(requests.length).toBe(4);
    expect(requests.every((r) => r.method === "GET")).toBe(true);
  });

  test("retries a dropped connection", async () => {
    const requests = answers("network", "network", 200);
    const trino = Trino.create({ server: "/api/trino/x", retry: QUICK });
    expect((await trino.nextChunk("/next")).data).toEqual([[1]]);
    expect(requests.length).toBe(3);
  });

  test("does not retry a 4xx: a 401 must reach the sign-out check as itself", async () => {
    for (const status of [401, 403, 404]) {
      const requests = answers(status, 200);
      const trino = Trino.create({ server: "/api/trino/x", retry: QUICK });
      const e = await rejected(trino.nextChunk("/next"));
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(status);
      expect(requests.length).toBe(1);
    }
  });

  test("does not retry a 500", async () => {
    const requests = answers(500, 200);
    const trino = Trino.create({ server: "/api/trino/x", retry: QUICK });
    expect(((await rejected(trino.nextChunk("/next"))) as HttpError).status).toBe(500);
    expect(requests.length).toBe(1);
  });

  test("never retries the POST that starts a query", async () => {
    const requests = answers(503, 200);
    const trino = Trino.create({ server: "/api/trino/x", retry: QUICK });
    expect(((await rejected(trino.query("select 1"))) as HttpError).status).toBe(503);
    expect(requests).toEqual([{ method: "POST", url: "/api/trino/x/v1/statement" }]);
  });

  test("announces each retry with a doubling delay, capped", async () => {
    answers(503, 503, 503, 503, 200);
    const retries: Retry[] = [];
    const trino = Trino.create({
      server: "/api/trino/x",
      retry: QUICK,
      onRetry: (retry) => void retries.push(retry)
    });
    await trino.nextChunk("/next");
    expect(retries.map((r) => r.attempts)).toEqual([1, 2, 3, 4]);
    expect(retries.map((r) => r.delayMs)).toEqual([1, 2, 4, 4]);
    expect(retries[0].error).toBeInstanceOf(HttpError);
  });

  test("stops when the retry is declined, throwing the failure as it is", async () => {
    const requests = answers(503, 503, 200);
    const trino = Trino.create({
      server: "/api/trino/x",
      retry: QUICK,
      onRetry: ({ attempts }) => attempts < 2
    });
    const e = await rejected(trino.nextChunk("/next"));
    expect((e as HttpError).status).toBe(503);
    expect(requests.length).toBe(2);
  });

  test("gives up once the window has passed, saying so", async () => {
    answer(502, JSON.stringify({ message: "Failed to connect to upstream Trino server" }));
    const trino = Trino.create({
      server: "/api/trino/x",
      retry: { ...QUICK, windowMs: 0 }
    });
    const e = await rejected(trino.nextChunk("/next"));
    expect(e.message).toBe(
      "Failed to connect to upstream Trino server (HTTP 502) — gave up after 1 attempts over 0 s"
    );
    expect(e.cause).toBeInstanceOf(HttpError);
  });

  test("retryDelay doubles from the first delay up to the cap", () => {
    const policy = { initialDelayMs: 100, maxDelayMs: 2_000, windowMs: 120_000 };
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => retryDelay(n, policy))).toEqual([
      100, 200, 400, 800, 1600, 2000, 2000
    ]);
  });
});
