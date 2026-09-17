/**
 * The workspace in this browser's localStorage: the `WorkspaceStore` a
 * deployment without a server file store uses, and where the server store
 * imports from on its first visit.
 *
 * One key per file:
 *
 *     trinette:workspace:<workspaceId>:file:<fileId>   {id, name, content, connectionId,
 *                                                       viewFormats}
 *     trinette:workspace:<workspaceId>:ui              {activeFileId, order}
 *     trinette:workspace:<workspaceId>:imported        set once the server has them
 *
 * It used to be a single `:files` key holding every document, which made three
 * separate failures share one fate. A parse error lost the whole workspace
 * rather than one document, since the reader could only fall back to "no
 * files". A quota rejection lost every document's edits, not just those of the
 * file that overran. And two tabs each rewrote the entire list from the copy
 * they had loaded, so the last one to save silently reverted the other's work
 * on files it had never touched.
 *
 * The file keys are the truth. `:ui` is advisory — it records what to reopen
 * and the order to list in, and anything it says about files that are not
 * there is ignored, so the two cannot disagree in a way that needs repairing.
 *
 * A record's version is its own serialized text: what a tab last wrote or
 * read is exactly what it expects to find there next time, and the `storage`
 * event keeps that expectation current while other tabs write.
 */

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
  WorkspaceWatcher
} from "./workspaceStore";

const prefix = (workspaceId: string) => `trinette:workspace:${workspaceId}:`;
const filePrefix = (workspaceId: string) => `${prefix(workspaceId)}file:`;
const fileKey = (workspaceId: string, fileId: string) => filePrefix(workspaceId) + fileId;
const uiKey = (workspaceId: string) => `${prefix(workspaceId)}ui`;
const importedKey = (workspaceId: string) => `${prefix(workspaceId)}imported`;

/** The file id a storage key names, or null if the key is not a file of this
 *  workspace. Used to read the `storage` event, which hands over a key. */
function fileIdFromKey(workspaceId: string, key: string): string | null {
  const p = filePrefix(workspaceId);
  return key.startsWith(p) ? key.slice(p.length) : null;
}

function parseRecord(raw: string | null): FileRecord | null {
  if (raw === null) return null;
  try {
    const file = toStoredFile(JSON.parse(raw));
    return file && { ...file, version: raw };
  } catch {
    return null;
  }
}

function readUi(workspaceId: string): StoredUi | null {
  try {
    const raw = localStorage.getItem(uiKey(workspaceId));
    return raw ? toStoredUi(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Every document of the workspace, in listing order. */
export function loadWorkspace(workspaceId: string): LoadedWorkspace {
  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(filePrefix(workspaceId)));
  } catch {
    return { files: [] };
  }

  const files: FileRecord[] = [];
  for (const key of keys) {
    let file: FileRecord | null = null;
    try {
      file = parseRecord(localStorage.getItem(key));
    } catch {}
    if (file) files.push(file);
  }

  const ui = readUi(workspaceId);
  return { files: orderFiles(files, ui), activeFileId: ui?.activeFileId };
}

/** Whether this browser's documents have been handed to the server already.
 *  Once per browser, not per account: another browser of the same person has
 *  its own localStorage and its own documents to bring. */
export function markImported(workspaceId: string, imported = true): boolean {
  try {
    if (imported) localStorage.setItem(importedKey(workspaceId), "1");
    return localStorage.getItem(importedKey(workspaceId)) !== null;
  } catch {
    return false;
  }
}

export class LocalWorkspaceStore implements WorkspaceStore {
  #workspaceId: string;

  constructor(workspaceId: string) {
    this.#workspaceId = workspaceId;
  }

  async load(): Promise<LoadedWorkspace> {
    return loadWorkspace(this.#workspaceId);
  }

  /**
   * Writes one document. A refusal is almost always the ~5MB quota. The caller
   * is told rather than the failure being swallowed: silently not saving is
   * the worst of the available behaviours, and with a key per file the refusal
   * is confined to the document that caused it instead of taking every other
   * document's edits down with it.
   */
  async put(file: StoredFile, expected: string | null): Promise<PutOutcome> {
    const key = fileKey(this.#workspaceId, file.id);
    let current: string | null = null;
    try {
      current = localStorage.getItem(key);
    } catch {}
    if (current !== expected) return { status: "conflict", current: parseRecord(current) };

    const version = JSON.stringify(file);
    try {
      localStorage.setItem(key, version);
      return { status: "saved", version };
    } catch {
      return { status: "refused", reason: "storage is full" };
    }
  }

  async remove(fileId: string): Promise<void> {
    try {
      localStorage.removeItem(fileKey(this.#workspaceId, fileId));
    } catch {}
  }

  async putUi(ui: StoredUi): Promise<void> {
    try {
      localStorage.setItem(uiKey(this.#workspaceId), JSON.stringify(ui));
    } catch {}
  }

  /**
   * The `storage` event fires only in the tabs that did *not* write, which is
   * exactly the audience, and it is the piece that turns "tabs no longer
   * overwrite each other" into "tabs agree about which documents exist".
   *
   * A null key means another tab called `localStorage.clear()`. There is no
   * sensible merge for that — this tab's documents are still in memory and
   * rewriting them would undo whatever the clear was for — so it is left alone.
   */
  watch(watcher: WorkspaceWatcher): () => void {
    const workspaceId = this.#workspaceId;
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return;
      if (event.key === null) return;

      const fileId = fileIdFromKey(workspaceId, event.key);
      if (fileId !== null) {
        if (event.newValue === null) watcher.onFileRemoved(fileId);
        else {
          const file = parseRecord(event.newValue);
          if (file) watcher.onFile(file);
        }
        return;
      }

      if (event.key === uiKey(workspaceId)) {
        const ui = readUi(workspaceId);
        if (ui) watcher.onOrder(ui.order);
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }
}
