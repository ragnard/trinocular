import { describe, expect, test } from "bun:test";

import {
  authenticate,
  FORGET_MS,
  FREE_FAILURES,
  LoginThrottle,
  MAX_DELAY_SECONDS,
  type PasswordUsers
} from "./passwordAuthn";

const users: PasswordUsers = {
  alice: { password: "correct horse", claims: { groups: ["admin"] } },
  bob: { password: "", claims: {} }
};

describe("authenticate", () => {
  test("the right password names the user", () => {
    expect(authenticate(users, "alice", "correct horse")).toBe("alice");
  });

  test("a wrong password, an unknown name, or a prototype key does not", () => {
    expect(authenticate(users, "alice", "correct horse ")).toBeUndefined();
    expect(authenticate(users, "alice", "")).toBeUndefined();
    expect(authenticate(users, "carol", "correct horse")).toBeUndefined();
    expect(authenticate(users, "constructor", "")).toBeUndefined();
    expect(authenticate(users, "__proto__", "")).toBeUndefined();
  });

  test("an empty configured password still has to be matched, and never by an unknown name", () => {
    // The schema refuses an empty password; this is the module holding its
    // own line should that change, since the dummy digest is of "".
    expect(authenticate(users, "bob", "")).toBe("bob");
    expect(authenticate(users, "nobody", "")).toBeUndefined();
  });
});

describe("LoginThrottle", () => {
  const clock = (start = 0) => {
    let now = start;
    return { now: () => now, advance: (ms: number) => (now += ms) };
  };

  test("the first failures are free, and the delay then doubles to the cap", () => {
    const c = clock();
    const t = new LoginThrottle(c.now);
    for (let i = 0; i < FREE_FAILURES; i++) {
      expect(t.allows("alice")).toBe(true);
      t.failed("alice");
    }
    expect(t.allows("alice")).toBe(true);
    let expected = 1;
    for (let i = 0; i < 8; i++) {
      t.failed("alice");
      expect(t.allows("alice")).toBe(false);
      c.advance(expected * 1000 - 1);
      expect(t.allows("alice")).toBe(false);
      c.advance(1);
      expect(t.allows("alice")).toBe(true);
      expected = Math.min(expected * 2, MAX_DELAY_SECONDS);
    }
    expect(expected).toBe(MAX_DELAY_SECONDS);
  });

  test("names are independent, and a success clears one", () => {
    const t = new LoginThrottle(clock().now);
    for (let i = 0; i <= FREE_FAILURES; i++) t.failed("alice");
    expect(t.allows("alice")).toBe(false);
    expect(t.allows("bob")).toBe(true);
    t.succeeded("alice");
    expect(t.allows("alice")).toBe(true);
    t.failed("alice");
    expect(t.allows("alice")).toBe(true);
  });

  test("a name left alone long enough is forgotten, and starts from free again", () => {
    const c = clock();
    const t = new LoginThrottle(c.now);
    for (let i = 0; i <= FREE_FAILURES; i++) t.failed("alice");
    expect(t.allows("alice")).toBe(false);
    // Served its second's wait, but still remembered: the next failure waits.
    c.advance(FORGET_MS - 1);
    expect(t.allows("alice")).toBe(true);
    t.failed("alice");
    expect(t.allows("alice")).toBe(false);
    c.advance(FORGET_MS);
    expect(t.allows("alice")).toBe(true);
    t.failed("alice");
    expect(t.allows("alice")).toBe(true);
  });
});
