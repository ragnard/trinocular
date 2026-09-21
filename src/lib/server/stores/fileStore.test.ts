import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import type { FileStore, PutResult } from "../fileStore";
import { InMemoryFileStore } from "./memory/fileStore";
import { PostgresFileStore } from "./postgres/fileStore";
import { SqliteFileStore } from "./sqlite/fileStore";
import { testPostgres } from "./testPostgres";
import { silent, testValkey } from "./testValkey";
import { ValkeyFileStore } from "./valkey/fileStore";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trinocular-files-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const file = (id: string, content = "select 1") => ({
  id,
  name: `${id}.sql`,
  content,
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
      await store.putUi(user, { activeFileId: "a", order: ["a", "b"], connectionId: "warehouse" });
      await store.putUi(user, { order: ["b"] });
      expect((await store.list(user)).ui).toEqual({
        activeFileId: undefined,
        order: ["b"],
        connectionId: undefined
      });
    });

    test("the ui record carries the connection", async () => {
      await store.putUi(user, { order: [], connectionId: "finance" });
      expect((await store.list(user)).ui?.connectionId).toBe("finance");
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

const valkey = testValkey();
describe.skipIf(valkey === null)("valkey", () => {
  let store: ValkeyFileStore | undefined;
  const open = async () =>
    (store ??= await ValkeyFileStore.create(
      { kind: "valkey", ...valkey!.connection, keyPrefix: valkey!.keyPrefix },
      silent
    ));
  afterAll(() => store?.dispose());

  contract("valkey", open);

  test("versions are never reused once a document is removed", async () => {
    const s = await open();
    const first = await saved(s.put("u", file("a"), null));
    await s.remove("u", "a");
    const again = await saved(s.put("u", file("a"), null));
    expect(again).not.toBe(first);
    expect(await s.put("u", file("a", "stale"), first)).toMatchObject({ status: "conflict" });
  });
});

const pg = testPostgres();
describe.skipIf(pg === null)("postgres", () => {
  let store: PostgresFileStore | undefined;
  const open = async () =>
    (store ??= await PostgresFileStore.create({ kind: "postgres", ...pg!.connection }, silent));
  beforeAll(() => pg!.setup());
  afterAll(async () => {
    await store?.dispose();
    await pg!.teardown();
  });

  contract("postgres", open);

  test("versions are never reused once a document is removed", async () => {
    const s = await open();
    const first = await saved(s.put("u", file("a"), null));
    await s.remove("u", "a");
    const again = await saved(s.put("u", file("a"), null));
    expect(again).not.toBe(first);
    expect(await s.put("u", file("a", "stale"), first)).toMatchObject({ status: "conflict" });
  });

  test("of two concurrent creates, exactly one is saved", async () => {
    const s = await open();
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => s.put("race", file("a", `select ${i}`), null))
    );
    expect(results.filter((r) => r.status === "saved")).toHaveLength(1);
    expect(results.filter((r) => r.status === "conflict")).toHaveLength(3);
  });

  test("of two concurrent updates against one version, exactly one is saved", async () => {
    const s = await open();
    const version = await saved(s.put("race2", file("a"), null));
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => s.put("race2", file("a", `select ${i}`), version))
    );
    expect(results.filter((r) => r.status === "saved")).toHaveLength(1);
    expect(results.filter((r) => r.status === "conflict")).toHaveLength(3);
  });

  test("a second store on the same schema finds the tables already made", async () => {
    const s = await open();
    await s.put("u2", file("a"), null);
    const other = await PostgresFileStore.create({ kind: "postgres", ...pg!.connection }, silent);
    expect((await other.list("u2")).files.map((f) => f.id)).toEqual(["a"]);
    await other.dispose();
  });
});
