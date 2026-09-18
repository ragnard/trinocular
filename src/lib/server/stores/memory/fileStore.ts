import type { FileRecord, StoredFile, StoredUi } from "$lib/workspaceRecord";

import type { FileStore, PutResult } from "../../fileStore";

/** Files in this process, gone with it. For development, and for what the
 *  sqlite store has to agree with. */
export class InMemoryFileStore implements FileStore {
  #files = new Map<string, Map<string, FileRecord>>();
  #ui = new Map<string, StoredUi>();
  #counter = 0;

  #of(userId: string): Map<string, FileRecord> {
    let files = this.#files.get(userId);
    if (!files) {
      files = new Map();
      this.#files.set(userId, files);
    }
    return files;
  }

  async list(userId: string) {
    return {
      files: [...this.#of(userId).values()].map((f) => ({ ...f })),
      ui: this.#ui.get(userId) ?? null
    };
  }

  async put(userId: string, file: StoredFile, expected: string | null): Promise<PutResult> {
    const files = this.#of(userId);
    const current = files.get(file.id) ?? null;
    if ((current?.version ?? null) !== expected) {
      return { status: "conflict", current: current && { ...current } };
    }
    const version = String(++this.#counter);
    files.set(file.id, { ...file, viewFormats: { ...file.viewFormats }, version });
    return { status: "saved", version };
  }

  async remove(userId: string, fileId: string): Promise<void> {
    this.#of(userId).delete(fileId);
  }

  async putUi(userId: string, ui: StoredUi): Promise<void> {
    this.#ui.set(userId, {
      activeFileId: ui.activeFileId,
      order: [...ui.order],
      connectionId: ui.connectionId
    });
  }
}
