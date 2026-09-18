import { afterAll, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import type { SessionStore } from "../sessionStore";
import { InMemorySessionStore } from "./memory/sessionStore";
import { SqliteSessionStore } from "./sqlite/sessionStore";
import { silent, testValkey } from "./testValkey";
import { ValkeySessionStore } from "./valkey/sessionStore";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trinette-sessions-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const secret = "0123456789abcdef0123456789abcdef";

/** What every store has to agree on. `open` hands back a fresh store each
 *  time, or the same one: the ids are unique either way. */
const contract = (name: string, open: () => Promise<SessionStore>) => {
  describe(name, () => {
    test("saves, loads and destroys", async () => {
      const store = await open();
      const id = crypto.randomUUID();
      await store.save(id, { user: "alice" }, 60);
      expect(await store.load(id)).toEqual({ user: "alice" });
      await store.destroy(id);
      expect(await store.load(id)).toBeNull();
    });

    test("what was never saved reads as none", async () => {
      expect(await (await open()).load(crypto.randomUUID())).toBeNull();
    });
  });
};

const memory = new InMemorySessionStore();
afterAll(() => memory.dispose());
contract("memory", async () => memory);

const openSqlite = (name: string, s = secret) =>
  SqliteSessionStore.create({ kind: "sqlite", path: path.join(dir, name), secret: s });

let sqlite: SqliteSessionStore | undefined;
contract("sqlite", async () => (sqlite ??= await openSqlite("contract.sqlite")));
afterAll(() => sqlite?.dispose());

describe("sqlite", () => {
  test("an expired session reads as none", async () => {
    const store = await openSqlite("expiry.sqlite");
    await store.save("s1", { user: "alice" }, -1);
    expect(await store.load("s1")).toBeNull();
    await store.dispose();
  });

  test("is sealed: the file never holds the session in the clear", async () => {
    const file = path.join(dir, "sealed.sqlite");
    const store = await openSqlite("sealed.sqlite");
    await store.save("s1", { refreshToken: "very-secret-token" }, 60);
    await store.dispose();
    expect(fs.readFileSync(file, "latin1")).not.toContain("very-secret-token");
  });

  test("a session sealed under another secret is dropped", async () => {
    const one = await openSqlite("rotate.sqlite");
    await one.save("s1", { user: "alice" }, 60);
    await one.dispose();
    let unreadable = 0;
    const two = await SqliteSessionStore.create(
      { kind: "sqlite", path: path.join(dir, "rotate.sqlite"), secret: secret + "-rotated" },
      { onUnreadable: () => unreadable++ }
    );
    expect(await two.load("s1")).toBeNull();
    expect(unreadable).toBe(1);
    await two.dispose();
  });
});

const valkey = testValkey();
describe.skipIf(valkey === null)("valkey", () => {
  const openValkey = (s = secret) =>
    ValkeySessionStore.create(
      { kind: "valkey", ...valkey!.connection, keyPrefix: valkey!.keyPrefix, secret: s },
      silent
    );

  let store: ValkeySessionStore | undefined;
  contract("valkey", async () => (store ??= await openValkey()));
  afterAll(() => store?.dispose());

  test("a session sealed under another secret is dropped", async () => {
    const one = await openValkey();
    await one.save("s1", { user: "alice" }, 60);
    await one.dispose();
    const two = await openValkey(secret + "-rotated");
    expect(await two.load("s1")).toBeNull();
    await two.dispose();
  });
});
