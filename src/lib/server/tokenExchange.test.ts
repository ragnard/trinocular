import { describe, expect, test } from "bun:test";

import { TokenExchanger, type ExchangeOutcome, type ExchangeRequest } from "./tokenExchange";

/** A provider whose every answer is a promise the test settles by hand. */
class FakeProvider {
  calls: { request: ExchangeRequest; settle: (o: ExchangeOutcome) => void }[] = [];
  exchange = (request: ExchangeRequest): Promise<ExchangeOutcome> =>
    new Promise((settle) => this.calls.push({ request, settle }));
  /** Answers the latest call with a token. */
  issue(token: string, expiresIn = 300) {
    this.calls[this.calls.length - 1].settle({ kind: "token", token, expiresIn });
  }
}

const trino = { audience: "trino" };

function setup(start = 1_000_000) {
  const provider = new FakeProvider();
  let now = start;
  const exchanger = new TokenExchanger(provider.exchange, { now: () => now });
  return { provider, exchanger, advance: (seconds: number) => (now += seconds) };
}

describe("TokenExchanger", () => {
  test("asks the provider once and serves the token from cache after", async () => {
    const { provider, exchanger } = setup();
    const first = exchanger.token("subject", "w", { audience: "trino", scope: "trino" });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].request).toEqual({
      subjectToken: "subject",
      audience: "trino",
      scope: "trino"
    });
    provider.issue("exchanged");
    expect(await first).toMatchObject({ kind: "token", token: "exchanged" });

    expect(await exchanger.token("subject", "w", trino)).toMatchObject({ token: "exchanged" });
    expect(provider.calls).toHaveLength(1);
  });

  test("a different subject token or connection is a different entry", async () => {
    const { provider, exchanger } = setup();
    const a = exchanger.token("subject", "w", trino);
    provider.issue("for-w");
    await a;
    const b = exchanger.token("subject", "finance", trino);
    expect(provider.calls).toHaveLength(2);
    provider.issue("for-finance");
    expect(await b).toMatchObject({ token: "for-finance" });
    const c = exchanger.token("refreshed-subject", "w", trino);
    expect(provider.calls).toHaveLength(3);
    provider.issue("for-w-again");
    expect(await c).toMatchObject({ token: "for-w-again" });
    expect(exchanger.size).toBe(3);
  });

  test("concurrent misses on one key share one call", async () => {
    const { provider, exchanger } = setup();
    const a = exchanger.token("subject", "w", trino);
    const b = exchanger.token("subject", "w", trino);
    expect(provider.calls).toHaveLength(1);
    provider.issue("shared");
    expect(await a).toMatchObject({ token: "shared" });
    expect(await b).toMatchObject({ token: "shared" });
  });

  test("exchanges again inside the margin before expiry, and never hands out an expired token", async () => {
    const { provider, exchanger, advance } = setup();
    const a = exchanger.token("subject", "w", trino);
    provider.issue("first", 300);
    await a;
    advance(260);
    expect(await exchanger.token("subject", "w", trino)).toMatchObject({ token: "first" });
    expect(provider.calls).toHaveLength(1);
    advance(15); // 275s in: inside the 30s margin
    const b = exchanger.token("subject", "w", trino);
    expect(provider.calls).toHaveLength(2);
    provider.issue("second", 300);
    expect(await b).toMatchObject({ token: "second" });
  });

  test("a refusal and an outage are reported and not remembered", async () => {
    const { provider, exchanger } = setup();
    const a = exchanger.token("subject", "w", trino);
    provider.calls[0].settle({ kind: "refused", error: "access_denied" });
    expect(await a).toEqual({ kind: "refused", error: "access_denied" });

    const b = exchanger.token("subject", "w", trino);
    expect(provider.calls).toHaveLength(2);
    provider.calls[1].settle({ kind: "unavailable", message: "connect ECONNREFUSED" });
    expect(await b).toMatchObject({ kind: "unavailable" });

    const c = exchanger.token("subject", "w", trino);
    expect(provider.calls).toHaveLength(3);
    provider.issue("eventually");
    expect(await c).toMatchObject({ token: "eventually" });
    expect(exchanger.size).toBe(1);
  });

  test("a token that would expire inside the margin is used once and not cached", async () => {
    const { provider, exchanger } = setup();
    const a = exchanger.token("subject", "w", trino);
    provider.issue("brief", 10);
    expect(await a).toMatchObject({ token: "brief" });
    expect(exchanger.size).toBe(0);
    exchanger.token("subject", "w", trino);
    expect(provider.calls).toHaveLength(2);
  });

  test("expired entries are swept, a minute apart at most", async () => {
    const { provider, exchanger, advance } = setup();
    const a = exchanger.token("s1", "w", trino);
    provider.issue("one", 100);
    await a;
    advance(200);
    // The sweep runs when an exchange settles; s1 is long gone by then.
    const b = exchanger.token("s2", "w", trino);
    provider.issue("two", 300);
    await b;
    expect(exchanger.size).toBe(1);
  });
});
