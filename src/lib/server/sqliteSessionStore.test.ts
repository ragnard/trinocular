import { afterAll, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import { SqliteSessionStore } from "./sqliteSessionStore";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trinette-sessions-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const secret = "0123456789abcdef0123456789abcdef";
const open = (name: string, s = secret) =>
  SqliteSessionStore.create({ kind: "sqlite", path: path.join(dir, name), secret: s });

describe("sqlite session store", () => {
  test("saves, loads and destroys", async () => {
    const store = await open("basic.sqlite");
    await store.save("s1", { user: "alice" }, 60);
    expect(await store.load("s1")).toEqual({ user: "alice" });
    await store.destroy("s1");
    expect(await store.load("s1")).toBeNull();
    await store.dispose();
  });

  test("an expired session reads as none", async () => {
    const store = await open("expiry.sqlite");
    await store.save("s1", { user: "alice" }, -1);
    expect(await store.load("s1")).toBeNull();
    await store.dispose();
  });

  test("is sealed: the file never holds the session in the clear", async () => {
    const file = path.join(dir, "sealed.sqlite");
    const store = await open("sealed.sqlite");
    await store.save("s1", { refreshToken: "very-secret-token" }, 60);
    await store.dispose();
    expect(fs.readFileSync(file, "latin1")).not.toContain("very-secret-token");
  });

  test("a session sealed under another secret is dropped", async () => {
    const one = await open("rotate.sqlite");
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
