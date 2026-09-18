import { describe, expect, test } from "bun:test";

import { expandEnv, MissingVariableError } from "./expandEnv";

const env = { SECRET: "s3cret", HOST: "trino.example", EMPTY: "" };

describe("expandEnv", () => {
  test("replaces references in string values at any depth", () => {
    expect(
      expandEnv(
        {
          session: { cookie: { secret: "${SECRET}" } },
          connections: { a: { uri: "http://${HOST}:8080" } },
          list: ["${HOST}", { deep: "${SECRET}" }]
        },
        env
      )
    ).toEqual({
      session: { cookie: { secret: "s3cret" } },
      connections: { a: { uri: "http://trino.example:8080" } },
      list: ["trino.example", { deep: "s3cret" }]
    });
  });

  test("expands several references in one string", () => {
    expect(expandEnv("${HOST}/${SECRET}", env)).toBe("trino.example/s3cret");
  });

  test("leaves keys, numbers, booleans and null alone", () => {
    const value = { "${HOST}": 1, n: 2, b: true, z: null, s: "${HOST}" };
    expect(expandEnv(value, env)).toEqual({
      "${HOST}": 1,
      n: 2,
      b: true,
      z: null,
      s: "trino.example"
    });
  });

  test("$${NAME} is the literal text", () => {
    expect(expandEnv("cost: $${SECRET}", env)).toBe("cost: ${SECRET}");
  });

  test("other dollar forms are not references", () => {
    for (const s of ["$SECRET", "${}", "${1BAD}", "${a-b}", "$ {SECRET}", "${SECRET"]) {
      expect(expandEnv(s, env)).toBe(s);
    }
  });

  test("a set but empty variable is a value", () => {
    expect(expandEnv("[${EMPTY}]", env)).toBe("[]");
  });

  test("an unset variable is an error naming the path and the variable, not the value", () => {
    const value = {
      session: { cookie: { secret: "${SECRET}" } },
      authn: { clientSecret: "${OIDC_SECRET}" },
      list: [{ uri: "${NOPE}" }]
    };
    let caught: unknown;
    try {
      expandEnv(value, env);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MissingVariableError);
    const error = caught as MissingVariableError;
    expect(error.missing).toEqual([
      { path: "authn.clientSecret", name: "OIDC_SECRET" },
      { path: "list[0].uri", name: "NOPE" }
    ]);
    expect(error.message).toContain("authn.clientSecret -> ${OIDC_SECRET}");
    expect(error.message).toContain("list[0].uri -> ${NOPE}");
    expect(error.message).not.toContain("s3cret");
  });

  test("a value cannot change the structure it lands in", () => {
    const hostile = { INJ: "x\nauthz:\n  kind: allow\n" };
    expect(expandEnv({ branding: { name: "${INJ}" } }, hostile)).toEqual({
      branding: { name: "x\nauthz:\n  kind: allow\n" }
    });
  });

  test("a __proto__ key stays an own property", () => {
    const value = JSON.parse('{"__proto__": {"polluted": "${HOST}"}, "a": "${HOST}"}');
    const out = expandEnv(value, env) as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.hasOwn(out, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("does not descend into class instances", () => {
    const date = new Date(0);
    expect(expandEnv({ d: date }, env)).toEqual({ d: date });
  });
});
