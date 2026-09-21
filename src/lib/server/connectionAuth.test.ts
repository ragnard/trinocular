import { describe, expect, test } from "bun:test";

import { upstreamAuthHeaders } from "./connectionAuth";

describe("upstreamAuthHeaders", () => {
  test("none sends no credential, token or not", () => {
    expect(upstreamAuthHeaders({ kind: "none" }, undefined)).toEqual({});
    expect(upstreamAuthHeaders({ kind: "none" }, "tok")).toEqual({});
  });

  test("basic is the service account, base64 of user:password", () => {
    expect(
      upstreamAuthHeaders({ kind: "basic", username: "svc", password: "p@ss:word" }, "tok")
    ).toEqual({ authorization: "Basic " + Buffer.from("svc:p@ss:word").toString("base64") });
  });

  test("basic encodes a password beyond latin1", () => {
    const headers = upstreamAuthHeaders(
      { kind: "basic", username: "svc", password: "pässwörd" },
      undefined
    );
    expect(headers).not.toBe("unauthenticated");
    const encoded = (headers as Record<string, string>).authorization.replace(/^Basic /, "");
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe("svc:pässwörd");
  });

  test("user-token is the user's bearer, and nothing without one", () => {
    expect(upstreamAuthHeaders({ kind: "user-token" }, "tok")).toEqual({
      authorization: "Bearer tok"
    });
    expect(upstreamAuthHeaders({ kind: "user-token" }, undefined)).toBe("unauthenticated");
  });
});
