/**
 * The queue between `Workspace.persist()` and a `WorkspaceStore`.
 *
 * `persist` hands over every document each time it runs, on a debounce while
 * typing and at once for a rename or a switch of file. This writes only what
 * differs from what it last wrote — seeded from what was *loaded*, which is
 * the part that matters: a tab that has not touched a document never writes
 * it, so it cannot put back the copy it happened to load.
 *
 * A store may be a network away now, so each document has one request in
 * flight at most: a change that lands while its save is out is sent once the
 * save returns, rather than racing it for the version. A save that fails is
 * retried with backoff and the document stays dirty; one the store refuses is
 * reported and dropped, since asking again would not change the answer.
 */

import type { FileRecord, StoredFile, StoredUi } from "./workspaceRecord";
import type { WorkspaceStore } from "./workspaceStore";

const RETRY_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/** Conflicts in a row on one document before it is treated as a failure and
 *  backed off, rather than sent again at once. */
const CONFLICT_LIMIT = 3;

export interface SaverHooks {
  /** Whether the document is the one under the caret in this tab. */
  isActive(fileId: string): boolean;
  /** Somebody else's copy has won: replace this tab's. */
  applyRemote(file: FileRecord): void;
  /** Somebody else removed the document while this tab was editing it. */
  applyRemoved(fileId: string): void;
  /** Whether any save is waiting on a retry. */
  onTrouble(failing: boolean): void;
  report(message: string): void;
}

interface Pending {
  inFlight: boolean;
  dirty: boolean;
  attempt: number;
  conflicts: number;
  timer?: ReturnType<typeof setTimeout>;
}

const fresh = (): Pending => ({ inFlight: false, dirty: false, attempt: 0, conflicts: 0 });

export class WorkspaceSaver {
  #store: WorkspaceStore;
  #hooks: SaverHooks;
  /** The serialized record last written or read for each document. */
  #serialized = new Map<string, string>();
  /** The version the store holds each document under, as this tab knows it. */
  #versions = new Map<string, string>();
  /** The newest record `persist` handed over, which is what a send uses. */
  #latest = new Map<string, StoredFile>();
  #pending = new Map<string, Pending>();
  /** The save in flight for a document, which a removal of it waits on: a
   *  DELETE that overtook the PUT would leave the document back on the store. */
  #inFlight = new Map<string, Promise<void>>();
  #removals = new Map<string, Pending>();
  #ui: StoredUi | null = null;
  #lastUi = "";
  #uiPending: Pending = fresh();
  #keepalive = false;

  constructor(store: WorkspaceStore, hooks: SaverHooks) {
    this.#store = store;
    this.#hooks = hooks;
  }

  seed(files: FileRecord[]) {
    for (const file of files) this.noteRemote(file);
  }

  /** Another tab or browser wrote this: remember it so it is not written
   *  straight back, and so the next write expects the right version. */
  noteRemote(file: FileRecord) {
    const { version, ...record } = file;
    this.#versions.set(file.id, version);
    this.#serialized.set(file.id, JSON.stringify(record));
    this.#latest.set(file.id, record);
  }

  noteRemoved(fileId: string) {
    this.#forget(fileId);
  }

  #forget(fileId: string) {
    this.#versions.delete(fileId);
    this.#serialized.delete(fileId);
    this.#latest.delete(fileId);
    const pending = this.#pending.get(fileId);
    if (pending) {
      clearTimeout(pending.timer);
      this.#pending.delete(fileId);
    }
  }

  /** What `persist` calls: the whole workspace, from which the changed part
   *  is sent. */
  update(files: StoredFile[], ui: StoredUi) {
    const live = new Set<string>();
    for (const file of files) {
      live.add(file.id);
      this.#latest.set(file.id, file);
      if (this.#serialized.get(file.id) === JSON.stringify(file)) continue;
      this.#send(file.id);
    }

    for (const id of [...this.#serialized.keys(), ...this.#pending.keys()]) {
      if (live.has(id)) continue;
      this.#forget(id);
      this.#sendRemoval(id);
    }

    this.#ui = ui;
    if (JSON.stringify(ui) !== this.#lastUi) this.#sendUi();
    this.#noteTrouble();
  }

  /**
   * The page is going away: gather what is waiting, send it now, and ask the
   * browser to see the requests through. `persist` runs inside so that what
   * the debounce was still holding goes out the same way.
   */
  flush(persist: () => void) {
    this.#keepalive = true;
    try {
      persist();
      for (const [id, pending] of this.#pending) {
        if (this.#wake(pending)) this.#send(id);
      }
      for (const [id, pending] of this.#removals) {
        if (this.#wake(pending)) this.#sendRemoval(id);
      }
      if (this.#wake(this.#uiPending)) this.#sendUi();
    } finally {
      this.#keepalive = false;
    }
  }

  #wake(pending: Pending): boolean {
    if (!pending.timer) return false;
    clearTimeout(pending.timer);
    pending.timer = undefined;
    return true;
  }

  #retryLater(pending: Pending, run: () => void) {
    pending.attempt += 1;
    const delay = Math.min(RETRY_MS * 2 ** (pending.attempt - 1), RETRY_MAX_MS);
    pending.timer = setTimeout(() => {
      pending.timer = undefined;
      run();
    }, delay);
  }

  #send(fileId: string) {
    let pending = this.#pending.get(fileId);
    if (!pending) {
      pending = fresh();
      this.#pending.set(fileId, pending);
    }
    pending.dirty = true;
    if (pending.inFlight || pending.timer) return;
    this.#inFlight.set(fileId, this.#put(fileId, pending));
  }

  async #put(fileId: string, pending: Pending) {
    const record = this.#latest.get(fileId);
    if (!record) {
      this.#pending.delete(fileId);
      return;
    }
    pending.inFlight = true;
    pending.dirty = false;
    const serialized = JSON.stringify(record);
    const expected = this.#versions.get(fileId) ?? null;

    let failed = false;
    try {
      const outcome = await this.#store.put(record, expected, { keepalive: this.#keepalive });
      // Forgotten while the save was out: the document is gone from the
      // workspace and its removal is waiting on this promise.
      if (this.#pending.get(fileId) !== pending) return;
      pending.attempt = 0;
      switch (outcome.status) {
        case "saved":
          pending.conflicts = 0;
          this.#versions.set(fileId, outcome.version);
          this.#serialized.set(fileId, serialized);
          break;
        case "refused":
          this.#hooks.report(`could not save "${record.name}" — ${outcome.reason}`);
          pending.dirty = false;
          break;
        case "conflict":
          this.#resolve(fileId, outcome.current, pending);
          break;
      }
    } catch {
      if (this.#pending.get(fileId) !== pending) return;
      failed = true;
    } finally {
      pending.inFlight = false;
      this.#inFlight.delete(fileId);
    }

    if (failed || pending.conflicts >= CONFLICT_LIMIT) {
      pending.dirty = true;
      pending.conflicts = 0;
      this.#retryLater(pending, () => {
        if (this.#pending.get(fileId) === pending) this.#send(fileId);
      });
    } else if (pending.dirty) {
      this.#inFlight.set(fileId, this.#put(fileId, pending));
    } else {
      this.#pending.delete(fileId);
    }
    this.#noteTrouble();
  }

  /**
   * Whose copy wins is the rule other tabs' writes already follow: the
   * document under the caret is this tab's — its text is what the person is
   * looking at — so it is sent again against the version that beat it, and
   * created afresh if that version was a removal. Any other document takes
   * the store's copy, and this tab's edit to it is gone, which is the same
   * outcome as if the other write had arrived a moment earlier.
   */
  #resolve(fileId: string, current: FileRecord | null, pending: Pending) {
    if (this.#hooks.isActive(fileId)) {
      if (current) this.#versions.set(fileId, current.version);
      else this.#versions.delete(fileId);
      pending.dirty = true;
      pending.conflicts += 1;
      return;
    }
    pending.dirty = false;
    if (current) this.#hooks.applyRemote(current);
    else this.#hooks.applyRemoved(fileId);
  }

  #sendRemoval(fileId: string) {
    let pending = this.#removals.get(fileId);
    if (!pending) {
      pending = fresh();
      this.#removals.set(fileId, pending);
    }
    if (pending.inFlight || pending.timer) return;
    void this.#remove(fileId, pending);
  }

  async #remove(fileId: string, pending: Pending) {
    pending.inFlight = true;
    let failed = false;
    try {
      await this.#inFlight.get(fileId)?.catch(() => {});
      await this.#store.remove(fileId, { keepalive: this.#keepalive });
      this.#removals.delete(fileId);
    } catch {
      failed = true;
    } finally {
      pending.inFlight = false;
    }
    if (failed) this.#retryLater(pending, () => this.#sendRemoval(fileId));
    this.#noteTrouble();
  }

  #sendUi() {
    const pending = this.#uiPending;
    pending.dirty = true;
    if (pending.inFlight || pending.timer) return;
    void this.#putUi(pending);
  }

  async #putUi(pending: Pending) {
    const ui = this.#ui;
    if (!ui) return;
    pending.inFlight = true;
    pending.dirty = false;
    // Recorded as sent before it is: a same-again `update` while this is out
    // would otherwise send it a second time.
    this.#lastUi = JSON.stringify(ui);
    let failed = false;
    try {
      await this.#store.putUi(ui, { keepalive: this.#keepalive });
      pending.attempt = 0;
    } catch {
      failed = true;
    } finally {
      pending.inFlight = false;
    }
    if (failed) {
      pending.dirty = true;
      this.#retryLater(pending, () => this.#sendUi());
    } else if (pending.dirty) {
      void this.#putUi(pending);
    }
    this.#noteTrouble();
  }

  #noteTrouble() {
    const waiting = (p: Pending) => p.timer !== undefined;
    const failing =
      [...this.#pending.values()].some(waiting) ||
      [...this.#removals.values()].some(waiting) ||
      waiting(this.#uiPending);
    this.#hooks.onTrouble(failing);
  }
}
