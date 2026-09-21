import { describe, expect, test } from "bun:test";

import { CelAuthorizer, ExpressionError, RequireKeycloakClientRole } from "./celAuthz";
import type { Identity } from "./identity";

const alice: Identity = {
  userId: "alice",
  claims: {
    sub: "alice",
    email_verified: true,
    groups: ["staff", "analysts"],
    resource_access: {
      trinocular: { roles: ["user"] },
      "com.example.finance": { roles: ["analyst"] }
    }
  }
};

const bob: Identity = { userId: "bob", claims: { sub: "bob" } };

const decide = (expression: string, identity: Identity) =>
  CelAuthorizer(expression).authorize(identity);

describe("CelAuthorizer", () => {
  test("the Keycloak role check, spelled out", () => {
    const expression = `"user" in claims.resource_access.trinocular.roles`;
    expect(decide(expression, alice).allowed).toBe(true);
    const refused = decide(expression, bob);
    // Bob has no resource_access at all. CEL calls that an error, and an
    // error is a refusal — not an accidental "no roles, so anything goes".
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.reason).toMatch(/No such key: resource_access/);
  });

  test("a client id with dots in it is an ordinary map key", () => {
    expect(
      decide(`"analyst" in claims.resource_access["com.example.finance"].roles`, alice).allowed
    ).toBe(true);
  });

  test("has() makes the missing claim a plain false", () => {
    const expression = `has(claims.groups) && "staff" in claims.groups`;
    expect(decide(expression, alice).allowed).toBe(true);
    const refused = decide(expression, bob);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.reason).toBe("expression evaluated to false");
  });

  test("userId is in the environment beside the claims", () => {
    const expression = `userId in ["alice", "carol"]`;
    expect(decide(expression, alice).allowed).toBe(true);
    expect(decide(expression, bob).allowed).toBe(false);
  });

  test("macros over a list claim", () => {
    expect(decide(`claims.groups.exists(g, g.endsWith("s"))`, alice).allowed).toBe(true);
    expect(decide(`claims.groups.all(g, g == "staff")`, alice).allowed).toBe(false);
  });

  test("only exactly true is allowed", () => {
    // A bare claim checks as dyn, so it gets as far as evaluation.
    expect(decide("claims.email_verified", alice).allowed).toBe(true);
    const string = decide("claims.sub", alice);
    expect(string.allowed).toBe(false);
    if (!string.allowed)
      expect(string.reason).toBe("expression evaluated to a string, not a boolean");
    const list = decide("claims.groups", alice);
    expect(list.allowed).toBe(false);
    if (!list.allowed) expect(list.reason).toBe("expression evaluated to a list, not a boolean");
  });

  test("a syntax error is refused at construction", () => {
    expect(() => CelAuthorizer(`claims.sub == "alice" ||`)).toThrow(ExpressionError);
  });

  test("a variable that is not claims or userId is refused at construction", () => {
    expect(() => CelAuthorizer(`"staff" in groups`)).toThrow(/Unknown variable: groups/);
  });

  test("an expression that can never be a boolean is refused at construction", () => {
    expect(() => CelAuthorizer("1 + 2")).toThrow(/type int/);
    expect(() => CelAuthorizer(`"admin"`)).toThrow(/type string/);
  });

  test("the name is the expression, for the startup log", () => {
    expect(CelAuthorizer("userId == 'alice'").name).toBe("cel(userId == 'alice')");
  });
});

describe("RequireKeycloakClientRole", () => {
  test("is the expression it is sugar for, name and all", () => {
    const rule = RequireKeycloakClientRole({ role: "user", client: "trinocular" });
    expect(rule.name).toBe(`cel("user" in claims.resource_access.trinocular.roles)`);
    expect(rule.authorize(alice).allowed).toBe(true);
    expect(
      RequireKeycloakClientRole({ role: "admin", client: "trinocular" }).authorize(alice)
    ).toEqual({ allowed: false, reason: "expression evaluated to false" });
  });

  test("a client id that is not identifier-shaped is indexed, not selected", () => {
    const rule = RequireKeycloakClientRole({ role: "analyst", client: "com.example.finance" });
    expect(rule.name).toBe(`cel("analyst" in claims.resource_access["com.example.finance"].roles)`);
    expect(rule.authorize(alice).allowed).toBe(true);
  });

  test("a user with no roles for the client is refused", () => {
    const refused = RequireKeycloakClientRole({ role: "user", client: "trinocular" }).authorize(
      bob
    );
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.reason).toMatch(/No such key/);
  });

  test("a quote in a role or client cannot break out of the literal", () => {
    const rule = RequireKeycloakClientRole({ role: `us"er`, client: `tri"no` });
    expect(rule.name).toBe(`cel("us\\"er" in claims.resource_access["tri\\"no"].roles)`);
    expect(rule.authorize(alice).allowed).toBe(false);
  });
});
