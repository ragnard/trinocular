/**
 * Where a workspace's documents live between visits. localStorage today; the
 * shape here is meant to be the seam a server store slots into, which is part
 * of why a file is its own record rather than a row inside one blob.
 *
 * One key per file:
 *
 *     trinette:workspace:<workspaceId>:file:<fileId>   {id, name, content, connectionId,
 *                                                       viewFormats}
 *     trinette:workspace:<workspaceId>:ui              {activeFileId, order}
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
 */

export interface StoredFile {
  id: string;
  name: string;
  content: string;
  connectionId: string;
  /** Inspector view formats, by field path. See `SqlFile.viewFormats`. */
  viewFormats: Record<string, string>;
}

export interface StoredUi {
  activeFileId?: string;
  /** File ids, in the order the switcher should list them. */
  order: string[];
}

export interface StoredWorkspace {
  files: StoredFile[];
  activeFileId?: string;
}

const prefix = (workspaceId: string) => `trinette:workspace:${workspaceId}:`;
const filePrefix = (workspaceId: string) => `${prefix(workspaceId)}file:`;
const fileKey = (workspaceId: string, fileId: string) => filePrefix(workspaceId) + fileId;
const uiKey = (workspaceId: string) => `${prefix(workspaceId)}ui`;

/** The file id a storage key names, or null if the key is not a file of this
 *  workspace. Used to read the `storage` event, which hands over a key. */
export function fileIdFromKey(workspaceId: string, key: string): string | null {
  const p = filePrefix(workspaceId);
  return key.startsWith(p) ? key.slice(p.length) : null;
}

export const isUiKey = (workspaceId: string, key: string) => key === uiKey(workspaceId);

/**
 * A stored record, or null if it is not one. Every field is checked rather
 * than cast: the point of a key per file is that one unreadable record costs
 * one document, and a half-checked record would put an `undefined` name into
 * the switcher instead.
 */
export function toStoredFile(value: unknown): StoredFile | null {
  if (typeof value !== "object" || value === null) return null;
  const file = value as Record<string, unknown>;
  if (typeof file.id !== "string" || file.id === "") return null;
  if (typeof file.name !== "string") return null;
  if (typeof file.content !== "string") return null;
  return {
    id: file.id,
    name: file.name,
    content: file.content,
    // An unknown connection is healed against the config by the caller.
    connectionId: typeof file.connectionId === "string" ? file.connectionId : "",
    viewFormats: toViewFormats(file.viewFormats)
  };
}

/**
 * Whatever of a `path: formatId` map survives being read. A record written
 * before the field existed has none, which is the empty map rather than a
 * broken document. Format ids are not checked against the ones this build
 * knows: that is `viewFormats.ts`'s to decide at render time, and dropping an
 * id here would mean a newer tab's choices being erased by an older one every
 * time it saved.
 */
function toViewFormats(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, format]) => typeof format === "string")
  ) as Record<string, string>;
}

function parseFile(raw: string | null): StoredFile | null {
  if (raw === null) return null;
  try {
    return toStoredFile(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function readFile(workspaceId: string, fileId: string): StoredFile | null {
  try {
    return parseFile(localStorage.getItem(fileKey(workspaceId, fileId)));
  } catch {
    return null;
  }
}

function readUi(workspaceId: string): StoredUi {
  try {
    const raw = localStorage.getItem(uiKey(workspaceId));
    if (raw) {
      const parsed = JSON.parse(raw) as StoredUi;
      if (Array.isArray(parsed.order)) {
        return {
          activeFileId: typeof parsed.activeFileId === "string" ? parsed.activeFileId : undefined,
          order: parsed.order.filter((id): id is string => typeof id === "string")
        };
      }
    }
  } catch {}
  return { order: [] };
}

/**
 * Every document of the workspace. The file keys decide what exists; `:ui`
 * only decides the order, and ids in it that name nothing are dropped while
 * files it does not mention go on the end by name — so a stale or missing
 * `:ui` is a cosmetic difference rather than a lost document.
 */
export function loadWorkspace(workspaceId: string): StoredWorkspace {
  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(filePrefix(workspaceId)));
  } catch {
    return { files: [] };
  }

  const byId = new Map<string, StoredFile>();
  for (const key of keys) {
    let file: StoredFile | null = null;
    try {
      file = parseFile(localStorage.getItem(key));
    } catch {}
    if (file) byId.set(file.id, file);
  }

  const ui = readUi(workspaceId);
  const files: StoredFile[] = [];
  for (const id of ui.order) {
    const file = byId.get(id);
    if (file) {
      files.push(file);
      byId.delete(id);
    }
  }
  const rest = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  files.push(...rest);

  return { files, activeFileId: ui.activeFileId };
}

/**
 * Writes one document. Returns false if the browser refused it, which is
 * almost always the ~5MB quota. The caller is told rather than the failure
 * being swallowed: silently not saving is the worst of the available
 * behaviours, and with a key per file the refusal is now confined to the
 * document that caused it instead of taking every other document's edits down
 * with it.
 */
export function writeFile(workspaceId: string, file: StoredFile): boolean {
  try {
    localStorage.setItem(fileKey(workspaceId, file.id), JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

export function removeFile(workspaceId: string, fileId: string): void {
  try {
    localStorage.removeItem(fileKey(workspaceId, fileId));
  } catch {}
}

export function writeUi(workspaceId: string, ui: StoredUi): boolean {
  try {
    localStorage.setItem(uiKey(workspaceId), JSON.stringify(ui));
    return true;
  } catch {
    return false;
  }
}

export interface WorkspaceWatcher {
  /** A file was written by another tab. */
  onFile(file: StoredFile): void;
  /** A file key was removed by another tab. */
  onFileRemoved(fileId: string): void;
  /** Another tab rewrote the listing order. */
  onOrder(order: string[]): void;
}

/**
 * Reports what other tabs do to this workspace. The `storage` event fires only
 * in the tabs that did *not* write, which is exactly the audience, and it is
 * the piece that turns "tabs no longer overwrite each other" into "tabs agree
 * about which documents exist".
 *
 * A null key means another tab called `localStorage.clear()`. There is no
 * sensible merge for that — this tab's documents are still in memory and
 * rewriting them would undo whatever the clear was for — so it is left alone.
 */
export function watchWorkspace(workspaceId: string, watcher: WorkspaceWatcher): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return;
    if (event.key === null) return;

    const fileId = fileIdFromKey(workspaceId, event.key);
    if (fileId !== null) {
      if (event.newValue === null) watcher.onFileRemoved(fileId);
      else {
        const file = parseFile(event.newValue);
        if (file) watcher.onFile(file);
      }
      return;
    }

    if (isUiKey(workspaceId, event.key)) {
      const ui = readUi(workspaceId);
      watcher.onOrder(ui.order);
    }
  };

  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
