/**
 * Where a workspace's documents live between visits, as the browser sees it:
 * either this browser's localStorage (`fileStorage.ts`) or the server's file
 * store behind `/api/workspace` (`remoteWorkspaceStore.ts`). `Workspace` talks
 * to one of these and never learns which.
 *
 * A write carries the version it expects the store to hold, so two tabs — or
 * two browsers, with the server store — cannot silently revert each other. A
 * conflict is an outcome and not an error: it hands back what the store holds
 * now, and `Workspace` decides whose copy wins by the same rules it applies to
 * a change another tab announces.
 */

import type { FileRecord, StoredFile, StoredUi } from "./workspaceRecord";

export type PutOutcome =
  | { status: "saved"; version: string }
  /** Somebody else wrote first; `current` is what they wrote, or null if they
   *  removed the document. */
  | { status: "conflict"; current: FileRecord | null }
  /** The store will not take this record, and asking again will not help —
   *  the browser's quota, or a document over the server's size cap. */
  | { status: "refused"; reason: string };

export interface LoadedWorkspace {
  /** Already in listing order. */
  files: FileRecord[];
  activeFileId?: string;
  connectionId?: string;
}

export interface WorkspaceWatcher {
  /** A document was written by another tab or another browser. */
  onFile(file: FileRecord): void;
  /** A document was removed elsewhere. */
  onFileRemoved(fileId: string): void;
  /** The listing order was rewritten elsewhere. */
  onOrder(order: string[]): void;
}

export interface WriteOptions {
  /** The page is going away: ask the browser to finish the request after it
   *  has. Only honoured for small bodies, which is the browser's rule. */
  keepalive?: boolean;
}

export interface WorkspaceStore {
  load(): Promise<LoadedWorkspace>;
  /** `expected` is the version this tab last saw for the document, or null
   *  for one it is creating. A rejection is transient and worth retrying; a
   *  `refused` outcome is not. */
  put(file: StoredFile, expected: string | null, opts?: WriteOptions): Promise<PutOutcome>;
  remove(fileId: string, opts?: WriteOptions): Promise<void>;
  putUi(ui: StoredUi, opts?: WriteOptions): Promise<void>;
  /** Reports what other tabs and other browsers do to this workspace. Returns
   *  the unsubscribe. */
  watch(watcher: WorkspaceWatcher): () => void;
}
