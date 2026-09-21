import { describe, expect, test } from "bun:test";

import { EnvSubstitutionError, substituteEnv } from "./configEnv";

const env = { SECRET: "s3cret", HOST: "valkey.example", EMPTY: "" };

describe("substituteEnv", () => {
  test("replaces a variable, whole or embedded, anywhere in the tree", () => {
    expect(
      substituteEnv(
        {
          session: { cookie: { secret: "${SECRET}" } },
          store: { url: "redis://${HOST}:6379" },
          list: ["${HOST}", 1, true, null]
        },
        env
      )
    ).toEqual({
      session: { cookie: { secret: "s3cret" } },
      store: { url: "redis://valkey.example:6379" },
      list: ["valkey.example", 1, true, null]
    });
  });

  test("an empty variable is set, and substitutes to nothing", () => {
    expect(substituteEnv("a${EMPTY}b", env)).toBe("ab");
  });

  test("an unset variable is an error naming the path", () => {
    expect(() =>
      substituteEnv({ authn: { users: { alice: { password: "${NOPE}" } } } }, env)
    ).toThrow(new EnvSubstitutionError("NOPE", "config.authn.users.alice.password"));
    expect(() => substituteEnv({ list: ["ok", "${NOPE}"] }, env)).toThrow(/config\.list\[1\]/);
  });

  test("$${ is a literal ${, and other dollars are left alone", () => {
    expect(substituteEnv("$${SECRET}", env)).toBe("${SECRET}");
    expect(substituteEnv("$2y$10$abc", env)).toBe("$2y$10$abc");
    expect(substituteEnv("cost $1 ${SECRET}", env)).toBe("cost $1 s3cret");
    expect(substituteEnv("${not-a-name}", env)).toBe("${not-a-name}");
  });

  test("leaves what is not a string as it is", () => {
    expect(substituteEnv(42, env)).toBe(42);
    expect(substituteEnv(null, env)).toBe(null);
    expect(substituteEnv(undefined, env)).toBe(undefined);
  });
});
