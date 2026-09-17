/**
 * The records a workspace is made of, as every store keeps them: one per
 * document, plus an advisory `ui` record holding the active document and the
 * listing order. Shared by the browser stores and the server ones, which is
 * why nothing in here touches the DOM or the filesystem.
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

/** A stored document together with the version the store holds it under. The
 *  version is opaque: a counter in sqlite, the serialized record in
 *  localStorage. Its only use is to be handed back on the next write, so the
 *  store can tell whether somebody else wrote in between. */
export interface FileRecord extends StoredFile {
  version: string;
}

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
export function toViewFormats(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, format]) => typeof format === "string")
  ) as Record<string, string>;
}

export function toStoredUi(value: unknown): StoredUi | null {
  if (typeof value !== "object" || value === null) return null;
  const ui = value as Record<string, unknown>;
  if (!Array.isArray(ui.order)) return null;
  return {
    activeFileId: typeof ui.activeFileId === "string" ? ui.activeFileId : undefined,
    order: ui.order.filter((id): id is string => typeof id === "string")
  };
}

/**
 * The documents in the order the `ui` record asks for. The records decide what
 * exists; `ui` only decides the order, and ids in it that name nothing are
 * dropped while files it does not mention go on the end by name — so a stale
 * or missing `ui` is a cosmetic difference rather than a lost document.
 */
export function orderFiles<T extends StoredFile>(files: T[], ui: StoredUi | null): T[] {
  const byId = new Map(files.map((f) => [f.id, f]));
  const ordered: T[] = [];
  for (const id of ui?.order ?? []) {
    const file = byId.get(id);
    if (file) {
      ordered.push(file);
      byId.delete(id);
    }
  }
  const rest = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  return ordered.concat(rest);
}
