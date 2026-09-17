import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import type { FileStore, PutResult } from "./fileStore";
import { InMemoryFileStore } from "./memoryFileStore";
import { SqliteFileStore } from "./sqliteFileStore";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trinette-files-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const file = (id: string, content = "select 1") => ({
  id,
  name: `${id}.sql`,
  content,
  connectionId: "warehouse",
  viewFormats: { payload: "json" }
});

/** The version a put produced, failing the test if it did not save. */
const saved = async (put: Promise<PutResult>): Promise<string> => {
  const result = await put;
  expect(result.status).toBe("saved");
  return (result as { version: string }).version;
};

/** What every store has to agree on, whatever it is made of. */
const contract = (name: string, open: () => FileStore | Promise<FileStore>) => {
  describe(name, () => {
    let store: FileStore;
    let user: string;
    let n = 0;
    beforeEach(async () => {
      store = await open();
      user = `user-${n++}`;
    });

    test("an empty workspace lists nothing", async () => {
      expect(await store.list(user)).toEqual({ files: [], ui: null });
    });

    test("a created document comes back with its version", async () => {
      const version = await saved(store.put(user, file("a"), null));
      expect((await store.list(user)).files).toEqual([{ ...file("a"), version }]);
    });

    test("creating an existing document is a conflict carrying it", async () => {
      const version = await saved(store.put(user, file("a"), null));
      expect(await store.put(user, file("a", "select 2"), null)).toEqual({
        status: "conflict",
        current: { ...file("a"), version }
      });
    });

    test("an update against the right version moves it", async () => {
      const first = await saved(store.put(user, file("a"), null));
      const second = await saved(store.put(user, file("a", "select 2"), first));
      expect(second).not.toBe(first);
      expect((await store.list(user)).files[0].content).toBe("select 2");
    });

    test("an update against a stale version is a conflict carrying the newer one", async () => {
      const first = await saved(store.put(user, file("a"), null));
      const second = await saved(store.put(user, file("a", "select 2"), first));
      expect(await store.put(user, file("a", "select 3"), first)).toEqual({
        status: "conflict",
        current: { ...file("a", "select 2"), version: second }
      });
    });

    test("an update to a removed document is a conflict with nothing", async () => {
      const first = await saved(store.put(user, file("a"), null));
      await store.remove(user, "a");
      expect(await store.put(user, file("a"), first)).toEqual({
        status: "conflict",
        current: null
      });
    });

    test("removing what is not there is fine", async () => {
      await store.remove(user, "nope");
      expect((await store.list(user)).files).toEqual([]);
    });

    test("users do not see each other", async () => {
      await store.put(user, file("a"), null);
      expect((await store.list("somebody-else")).files).toEqual([]);
    });

    test("the ui record is last writer wins", async () => {
      await store.putUi(user, { activeFileId: "a", order: ["a", "b"] });
      await store.putUi(user, { order: ["b"] });
      expect((await store.list(user)).ui).toEqual({ activeFileId: undefined, order: ["b"] });
    });
  });
};

contract("memory", () => new InMemoryFileStore());

let sqlite: SqliteFileStore | undefined;
contract("sqlite", () => {
  sqlite ??= SqliteFileStore.create({ kind: "sqlite", path: path.join(dir, "files.sqlite") });
  return sqlite;
});

describe("sqlite", () => {
  test("a second process cannot open the same file", () => {
    const own = path.join(dir, "exclusive.sqlite");
    const first = SqliteFileStore.create({ kind: "sqlite", path: own });
    expect(() => SqliteFileStore.create({ kind: "sqlite", path: own })).toThrow(/locked/);
    return first.dispose();
  });

  test("what was written survives reopening", async () => {
    const own = path.join(dir, "reopen.sqlite");
    const first = SqliteFileStore.create({ kind: "sqlite", path: own });
    await first.put("u", file("a"), null);
    await first.dispose();
    const second = SqliteFileStore.create({ kind: "sqlite", path: own });
    expect((await second.list("u")).files.map((f) => f.id)).toEqual(["a"]);
    await second.dispose();
  });
});
