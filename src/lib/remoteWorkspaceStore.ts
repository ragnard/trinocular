/**
 * The workspace on the server, behind `/api/workspace`. The server keys it by
 * the signed-in user, so nothing here says whose it is.
 *
 * The protocol is the store's contract spelled as HTTP: a write carries the
 * version it expects in `If-Match` (or `If-None-Match: *` for a document it is
 * creating), and a 412 comes back with what the server holds instead. A 413
 * is the size cap and is refused rather than retried; anything else that
 * fails is a rejection, which the caller retries.
 *
 * Other tabs of this browser hear about a write straight away over a
 * `BroadcastChannel`, which stands in for the `storage` event the local store
 * has. Other browsers are caught up with by re-reading the listing whenever
 * this tab becomes visible, and on a slow tick while it is — a version that
 * moved is reported as a write, an id that is gone as a removal.
 */

import { loadWorkspace, removeLocalFile } from "./fileStorage";
import {
  orderFiles,
  toStoredFile,
  toStoredUi,
  type FileRecord,
  type StoredFile,
  type StoredUi
} from "./workspaceRecord";
import type {
  LoadedWorkspace,
  PutOutcome,
  WorkspaceStore,
  WorkspaceWatcher,
  WriteOptions
} from "./workspaceStore";

const API = "/api/workspace";
const CHANNEL = "trinocular:workspace";
/** How often a visible tab re-reads the listing to catch up with other
 *  browsers. Refreshing on becoming visible is what usually does the work;
 *  this is for the tab left open beside another one. */
const REFRESH_MS = 60_000;
/** The body limit past which a browser refuses a `keepalive` request. */
const KEEPALIVE_LIMIT = 60_000;

type Message =
  | { type: "file"; file: FileRecord }
  | { type: "removed"; fileId: string }
  | { type: "ui"; ui: StoredUi };

function toRecord(value: unknown): FileRecord | null {
  const file = toStoredFile(value);
  if (!file) return null;
  const version = (value as Record<string, unknown>).version;
  return typeof version === "string" ? { ...file, version } : null;
}

function toListing(value: unknown): { files: FileRecord[]; ui: StoredUi | null } {
  const listing = (typeof value === "object" && value) || {};
  const rawFiles = (listing as Record<string, unknown>).files;
  const files = Array.isArray(rawFiles)
    ? rawFiles.map(toRecord).filter((f): f is FileRecord => f !== null)
    : [];
  return { files, ui: toStoredUi((listing as Record<string, unknown>).ui) };
}

export class RemoteWorkspaceStore implements WorkspaceStore {
  /** The version this tab knows for every document the server has, so a
   *  refresh can tell what moved. */
  #known = new Map<string, string>();
  #knownUi = "";
  /** Removals this tab has asked for and not yet heard back on: a refresh in
   *  the meantime still sees the document and must not announce it as new. */
  #removing = new Set<string>();
  #channel: BroadcastChannel | null = null;
  #workspaceId: string;

  constructor(workspaceId: string) {
    this.#workspaceId = workspaceId;
  }

  async load(): Promise<LoadedWorkspace> {
    let { files, ui } = await this.#listing();

    const imported = await this.#import(new Set(files.map((f) => f.id)));
    if (imported.length > 0) {
      files = files.concat(imported);
      // Their order was this browser's; the server's, if it has one, wins.
      if (!ui) ui = loadWorkspaceUi(this.#workspaceId);
    }

    this.#remember(files, ui);
    return {
      files: orderFiles(files, ui),
      activeFileId: ui?.activeFileId,
      connectionId: ui?.connectionId
    };
  }

  /**
   * The documents this browser kept that the server does not have, handed
   * over and then removed from localStorage, so that what is left there is
   * only what has never reached the server. That is what makes the check safe
   * to run on every load rather than once: a document created in the browser
   * while the deployment was back on browser storage is imported on the next
   * visit, while one the server has since deleted cannot come back, because
   * its local copy went when it was first imported. A create that loses a
   * race to another tab importing the same document is a conflict, which is
   * the right answer; the copy is dropped either way, since the server has it.
   */
  async #import(present: Set<string>): Promise<FileRecord[]> {
    const imported: FileRecord[] = [];
    for (const file of loadWorkspace(this.#workspaceId).files) {
      // The scratch file a workspace makes when it finds nothing is not a
      // document anybody wrote; carrying it over would put a blank beside the
      // one the server already made for the same reason.
      if (!present.has(file.id) && file.content !== "") {
        const { version, ...record } = file;
        const outcome = await this.put(record, null);
        if (outcome.status === "saved") imported.push({ ...record, version: outcome.version });
        else if (outcome.status === "refused") continue;
      }
      removeLocalFile(this.#workspaceId, file.id);
    }
    return imported;
  }

  async #listing(): Promise<{ files: FileRecord[]; ui: StoredUi | null }> {
    const response = await fetch(API, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`workspace listing failed: ${response.status}`);
    return toListing(await response.json());
  }

  #remember(files: FileRecord[], ui: StoredUi | null) {
    this.#known = new Map(files.map((f) => [f.id, f.version]));
    this.#knownUi = ui ? JSON.stringify(ui) : "";
  }

  async put(file: StoredFile, expected: string | null, opts?: WriteOptions): Promise<PutOutcome> {
    const body = JSON.stringify(file);
    const response = await fetch(`${API}/files/${encodeURIComponent(file.id)}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(expected === null ? { "if-none-match": "*" } : { "if-match": JSON.stringify(expected) })
      },
      body,
      keepalive: opts?.keepalive === true && body.length < KEEPALIVE_LIMIT
    });

    if (response.status === 412) {
      const { current } = (await response.json()) as { current: unknown };
      const record = toRecord(current);
      if (record) this.#known.set(file.id, record.version);
      else this.#known.delete(file.id);
      return { status: "conflict", current: record };
    }
    if (response.status === 413 || response.status === 400) {
      const { error } = (await response.json().catch(() => ({}))) as { error?: string };
      return { status: "refused", reason: error ?? `rejected with ${response.status}` };
    }
    if (!response.ok) throw new Error(`save failed: ${response.status}`);

    const { version } = (await response.json()) as { version: string };
    this.#known.set(file.id, version);
    this.#post({ type: "file", file: { ...file, version } });
    return { status: "saved", version };
  }

  async remove(fileId: string, opts?: WriteOptions): Promise<void> {
    this.#removing.add(fileId);
    try {
      const response = await fetch(`${API}/files/${encodeURIComponent(fileId)}`, {
        method: "DELETE",
        keepalive: opts?.keepalive === true
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`remove failed: ${response.status}`);
      }
      this.#known.delete(fileId);
      this.#post({ type: "removed", fileId });
    } finally {
      this.#removing.delete(fileId);
    }
  }

  async putUi(ui: StoredUi, opts?: WriteOptions): Promise<void> {
    const response = await fetch(`${API}/ui`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ui),
      keepalive: opts?.keepalive === true
    });
    if (!response.ok) throw new Error(`save failed: ${response.status}`);
    this.#knownUi = JSON.stringify(ui);
    this.#post({ type: "ui", ui });
  }

  #post(message: Message) {
    this.#channel?.postMessage(message);
  }

  watch(watcher: WorkspaceWatcher): () => void {
    const channel = new BroadcastChannel(CHANNEL);
    this.#channel = channel;
    channel.onmessage = (event: MessageEvent<Message>) => {
      const message = event.data;
      switch (message.type) {
        case "file": {
          const file = toRecord(message.file);
          if (!file) return;
          this.#known.set(file.id, file.version);
          watcher.onFile(file);
          return;
        }
        case "removed":
          this.#known.delete(message.fileId);
          watcher.onFileRemoved(message.fileId);
          return;
        case "ui": {
          const ui = toStoredUi(message.ui);
          if (!ui) return;
          this.#knownUi = JSON.stringify(ui);
          watcher.onOrder(ui.order);
          return;
        }
      }
    };

    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      this.#refresh(watcher).catch(() => {
        // Nothing to do: the next refresh asks again, and a save that fails
        // reports itself.
      });
    };
    document.addEventListener("visibilitychange", refresh);
    const tick = setInterval(refresh, REFRESH_MS);

    return () => {
      channel.close();
      if (this.#channel === channel) this.#channel = null;
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(tick);
    };
  }

  /** Re-reads the listing and reports what moved since this tab last looked. */
  async #refresh(watcher: WorkspaceWatcher) {
    const { files, ui } = await this.#listing();
    const seen = new Set<string>();
    for (const file of files) {
      seen.add(file.id);
      if (this.#removing.has(file.id)) continue;
      if (this.#known.get(file.id) === file.version) continue;
      this.#known.set(file.id, file.version);
      watcher.onFile(file);
    }
    for (const id of [...this.#known.keys()]) {
      if (seen.has(id)) continue;
      this.#known.delete(id);
      watcher.onFileRemoved(id);
    }
    const serializedUi = ui ? JSON.stringify(ui) : "";
    if (ui && serializedUi !== this.#knownUi) {
      this.#knownUi = serializedUi;
      watcher.onOrder(ui.order);
    }
  }
}

function loadWorkspaceUi(workspaceId: string): StoredUi | null {
  const loaded = loadWorkspace(workspaceId);
  return {
    activeFileId: loaded.activeFileId,
    order: loaded.files.map((f) => f.id),
    connectionId: loaded.connectionId
  };
}
