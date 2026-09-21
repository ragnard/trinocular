import { describe, expect, test } from "bun:test";

import type { FileRecord, StoredFile, StoredUi } from "./workspaceRecord";
import { WorkspaceSaver, type SaverHooks } from "./workspaceSaver";
import type { PutOutcome, WorkspaceStore, WriteOptions } from "./workspaceStore";

/** A store whose every write is a promise the test settles by hand, so the
 *  order in which saves go out and come back is the test's to choose. */
class FakeStore implements WorkspaceStore {
  puts: {
    file: StoredFile;
    expected: string | null;
    opts?: WriteOptions;
    settle: (o: PutOutcome) => void;
    fail: (e: unknown) => void;
  }[] = [];
  removed: string[] = [];
  uis: StoredUi[] = [];

  async load() {
    return { files: [] };
  }
  put(file: StoredFile, expected: string | null, opts?: WriteOptions): Promise<PutOutcome> {
    return new Promise((settle, fail) => this.puts.push({ file, expected, opts, settle, fail }));
  }
  async remove(fileId: string) {
    this.removed.push(fileId);
  }
  async putUi(ui: StoredUi) {
    this.uis.push(ui);
  }
  watch() {
    return () => {};
  }
}

const file = (id: string, content: string): StoredFile => ({
  id,
  name: `${id}.sql`,
  content,
  viewFormats: {}
});
const ui: StoredUi = { order: [] };
const tick = () => new Promise((r) => setTimeout(r, 0));
/** The failure the hooks recognise as the session being gone. */
const SIGNED_OUT = new Error("unauthorized (HTTP 401)");

const setup = (active = "a") => {
  const store = new FakeStore();
  const applied: FileRecord[] = [];
  const removed: string[] = [];
  const reports: string[] = [];
  let trouble = false;
  let signedOut = 0;
  const hooks: SaverHooks = {
    isActive: (id) => id === active,
    applyRemote: (f) => applied.push(f),
    applyRemoved: (id) => removed.push(id),
    onTrouble: (f) => (trouble = f),
    signedOut: (e) => e === SIGNED_OUT && ++signedOut > 0,
    report: (m) => reports.push(m)
  };
  const saver = new WorkspaceSaver(store, hooks);
  return {
    store,
    saver,
    applied,
    removed,
    reports,
    trouble: () => trouble,
    signedOut: () => signedOut
  };
};

describe("WorkspaceSaver", () => {
  test("writes only what changed, and nothing it merely loaded", async () => {
    const { store, saver } = setup();
    saver.seed([
      { ...file("a", "one"), version: "1" },
      { ...file("b", "two"), version: "1" }
    ]);
    saver.update([file("a", "one"), file("b", "two")], ui);
    expect(store.puts).toHaveLength(0);

    saver.update([file("a", "changed"), file("b", "two")], ui);
    expect(store.puts.map((p) => [p.file.id, p.expected])).toEqual([["a", "1"]]);
  });

  test("a new document is created against no version", () => {
    const { store, saver } = setup();
    saver.update([file("a", "one")], ui);
    expect(store.puts[0].expected).toBeNull();
  });

  test("one request in flight per document; a change meanwhile is sent after", async () => {
    const { store, saver } = setup();
    saver.update([file("a", "one")], ui);
    saver.update([file("a", "two")], ui);
    saver.update([file("a", "three")], ui);
    expect(store.puts).toHaveLength(1);

    store.puts[0].settle({ status: "saved", version: "1" });
    await tick();
    expect(store.puts).toHaveLength(2);
    expect(store.puts[1].file.content).toBe("three");
    expect(store.puts[1].expected).toBe("1");
  });

  test("the active document wins a conflict and is sent again", async () => {
    const { store, saver, applied } = setup("a");
    saver.update([file("a", "mine")], ui);
    store.puts[0].settle({ status: "conflict", current: { ...file("a", "theirs"), version: "7" } });
    await tick();
    expect(applied).toHaveLength(0);
    expect(store.puts).toHaveLength(2);
    expect(store.puts[1].file.content).toBe("mine");
    expect(store.puts[1].expected).toBe("7");
  });

  test("the active document removed elsewhere is created afresh", async () => {
    const { store, saver } = setup("a");
    saver.seed([{ ...file("a", "one"), version: "1" }]);
    saver.update([file("a", "mine")], ui);
    store.puts[0].settle({ status: "conflict", current: null });
    await tick();
    expect(store.puts[1].expected).toBeNull();
  });

  test("any other document takes the store's copy", async () => {
    const { store, saver, applied } = setup("elsewhere");
    saver.update([file("a", "mine")], ui);
    const theirs = { ...file("a", "theirs"), version: "7" };
    store.puts[0].settle({ status: "conflict", current: theirs });
    await tick();
    expect(applied).toEqual([theirs]);
    expect(store.puts).toHaveLength(1);
  });

  test("a document removed elsewhere is dropped here", async () => {
    const { store, saver, removed } = setup("elsewhere");
    saver.update([file("a", "mine")], ui);
    store.puts[0].settle({ status: "conflict", current: null });
    await tick();
    expect(removed).toEqual(["a"]);
  });

  test("a refusal is reported and not retried", async () => {
    const { store, saver, reports, trouble } = setup();
    saver.update([file("a", "big")], ui);
    store.puts[0].settle({ status: "refused", reason: "too big" });
    await tick();
    expect(reports).toEqual(['could not save "a.sql" — too big']);
    expect(store.puts).toHaveLength(1);
    expect(trouble()).toBe(false);
  });

  test("a failure is retried and reported as trouble until it succeeds", async () => {
    const { store, saver, trouble } = setup();
    saver.update([file("a", "one")], ui);
    store.puts[0].fail(new Error("offline"));
    await tick();
    expect(trouble()).toBe(true);
    expect(store.puts).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 1_100));
    expect(store.puts).toHaveLength(2);
    store.puts[1].settle({ status: "saved", version: "1" });
    await tick();
    expect(trouble()).toBe(false);
  });

  test("a signed-out answer stops the queue, for good, rather than retrying it", async () => {
    const { store, saver, trouble, signedOut } = setup();
    saver.update([file("a", "one")], ui);
    await tick();
    expect(store.uis).toHaveLength(1);
    store.puts[0].fail(SIGNED_OUT);
    await tick();
    expect(signedOut()).toBe(1);
    expect(trouble()).toBe(false);

    await new Promise((r) => setTimeout(r, 1_100));
    expect(store.puts).toHaveLength(1);

    // The page is on its way to login: a keystroke, a switch of file and the
    // flush on the way out all find nothing to send to.
    saver.update([file("a", "two")], { activeFileId: "a", order: ["a"] });
    saver.flush(() => {});
    await tick();
    expect(store.puts).toHaveLength(1);
    expect(store.uis).toHaveLength(1);
    expect(signedOut()).toBe(1);
  });

  test("a document that has gone is removed, after its save if one is out", async () => {
    const { store, saver } = setup();
    saver.update([file("a", "one")], ui);
    saver.update([], ui);
    await tick();
    expect(store.removed).toEqual([]);
    store.puts[0].settle({ status: "saved", version: "1" });
    await tick();
    await tick();
    expect(store.removed).toEqual(["a"]);
  });

  test("the ui record goes out when it changes", async () => {
    const { store, saver } = setup();
    saver.update([], { activeFileId: "a", order: ["a"] });
    saver.update([], { activeFileId: "a", order: ["a"] });
    await tick();
    expect(store.uis).toHaveLength(1);
  });

  test("flush sends what the debounce was holding, with keepalive", () => {
    const { store, saver } = setup();
    saver.flush(() => saver.update([file("a", "one")], ui));
    expect(store.puts[0].opts?.keepalive).toBe(true);
  });
});
