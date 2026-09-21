import { describe, expect, test } from "bun:test";
import {
  EMPTY_SESSION,
  applyDelta,
  isEmptySession,
  sessionDelta,
  sessionHeaders,
  type SessionState
} from "./session";

const headers = (entries: [string, string][]) => new Headers(entries);

describe("sessionDelta", () => {
  test("nothing session-shaped is null", () => {
    expect(sessionDelta(headers([["content-type", "application/json"]]))).toBeNull();
  });

  test("USE sets catalog and schema", () => {
    const delta = sessionDelta(
      headers([
        ["x-trino-set-catalog", "tpch"],
        ["x-trino-set-schema", "tiny"]
      ])
    );
    expect(delta).toMatchObject({ catalog: "tpch", schema: "tiny", set: {}, clear: [] });
  });

  test("several Set-Session headers arrive joined, values URL-decoded", () => {
    // fetch joins repeated headers with ", "; Trino URL-encodes each value.
    const delta = sessionDelta(
      headers([
        ["x-trino-set-session", "query_max_run_time=1h"],
        ["x-trino-set-session", "hive.insert_existing_partitions_behavior=OVERWRITE"],
        ["x-trino-set-session", "note=a%2Cb+c"]
      ])
    );
    expect(delta?.set).toEqual({
      query_max_run_time: "1h",
      "hive.insert_existing_partitions_behavior": "OVERWRITE",
      note: "a,b c"
    });
  });

  test("Clear-Session names keys; Added-Prepare carries the SQL", () => {
    const delta = sessionDelta(
      headers([
        ["x-trino-clear-session", "a"],
        ["x-trino-clear-session", "b"],
        ["x-trino-added-prepare", "q=SELECT+%2A+FROM+t+WHERE+x+%3D+%3F"]
      ])
    );
    expect(delta?.clear).toEqual(["a", "b"]);
    expect(delta?.prepared).toEqual({ q: "SELECT * FROM t WHERE x = ?" });
  });

  test("path and time zone are carried", () => {
    const delta = sessionDelta(
      headers([
        ["x-trino-set-path", "a.b"],
        ["x-trino-set-time-zone", "Europe/Stockholm"]
      ])
    );
    expect(delta).toMatchObject({ path: "a.b", timeZone: "Europe/Stockholm" });
  });

  test("roles, authorization and transactions are reported as ignored, once each", () => {
    const delta = sessionDelta(
      headers([
        ["x-trino-set-role", "hive=ROLE{admin}"],
        ["x-trino-set-authorization-user", "bob"],
        ["x-trino-reset-authorization-user", "true"],
        ["x-trino-started-transaction-id", "abc"]
      ])
    );
    expect(delta?.ignored).toEqual(["role", "authorization", "transaction"]);
    expect(delta?.set).toEqual({});
  });
});

describe("applyDelta", () => {
  test("merges properties and clears named ones; a later USE replaces the earlier", () => {
    let state: SessionState = EMPTY_SESSION;
    state = applyDelta(state, sessionDelta(headers([["x-trino-set-session", "a=1"]]))!);
    state = applyDelta(state, sessionDelta(headers([["x-trino-set-session", "b=2"]]))!);
    state = applyDelta(
      state,
      sessionDelta(
        headers([
          ["x-trino-set-catalog", "tpch"],
          ["x-trino-set-schema", "tiny"]
        ])
      )!
    );
    state = applyDelta(state, sessionDelta(headers([["x-trino-set-schema", "sf1"]]))!);
    state = applyDelta(state, sessionDelta(headers([["x-trino-clear-session", "a"]]))!);
    expect(state).toEqual({
      catalog: "tpch",
      schema: "sf1",
      path: undefined,
      timeZone: undefined,
      properties: { b: "2" },
      prepared: {}
    });
  });

  test("deallocate drops a prepared statement", () => {
    let state = applyDelta(
      EMPTY_SESSION,
      sessionDelta(headers([["x-trino-added-prepare", "q=SELECT+1"]]))!
    );
    expect(state.prepared).toEqual({ q: "SELECT 1" });
    state = applyDelta(state, sessionDelta(headers([["x-trino-deallocated-prepare", "q"]]))!);
    expect(state.prepared).toEqual({});
  });

  test("does not mutate the state it was given", () => {
    const before = applyDelta(
      EMPTY_SESSION,
      sessionDelta(headers([["x-trino-set-session", "a=1"]]))!
    );
    const after = applyDelta(before, sessionDelta(headers([["x-trino-clear-session", "a"]]))!);
    expect(before.properties).toEqual({ a: "1" });
    expect(after.properties).toEqual({});
    expect(after).not.toBe(before);
  });
});

describe("sessionHeaders", () => {
  test("an empty session sends nothing", () => {
    expect(sessionHeaders(EMPTY_SESSION)).toEqual({});
    expect(isEmptySession(EMPTY_SESSION)).toBe(true);
  });

  test("properties and prepared statements go out comma-joined and URL-encoded", () => {
    const state: SessionState = {
      catalog: "tpch",
      schema: "tiny",
      path: "a.b",
      timeZone: "UTC",
      properties: { a: "1", note: "a,b c" },
      prepared: { q: "SELECT * FROM t" }
    };
    expect(sessionHeaders(state)).toEqual({
      "X-Trino-Catalog": "tpch",
      "X-Trino-Schema": "tiny",
      "X-Trino-Path": "a.b",
      "X-Trino-Time-Zone": "UTC",
      "X-Trino-Session": "a=1,note=a%2Cb%20c",
      "X-Trino-Prepared-Statement": "q=SELECT%20*%20FROM%20t"
    });
    expect(isEmptySession(state)).toBe(false);
  });

  test("what went out decodes back to what was set", () => {
    const state: SessionState = {
      ...EMPTY_SESSION,
      properties: { note: "a,b c=d&e" }
    };
    const sent = sessionHeaders(state)["X-Trino-Session"];
    // The server splits on the comma, then on the first `=`, then URL-decodes.
    const [key, value] = sent.split(",")[0].split(/=(.*)/s);
    expect(key).toBe("note");
    expect(decodeURIComponent(value)).toBe("a,b c=d&e");
  });
});
