export interface StoredFile {
  id: string;
  name: string;
  content: string;
}

interface StoredState {
  activeFileId?: string;
  files: StoredFile[];
}


export function loadFiles(workspaceId: string): StoredState {
  try {
    const raw = localStorage.getItem(`trinette:workspace:${workspaceId}:files`);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredState;
      if (Array.isArray(parsed.files)) return parsed;
    }
  } catch {}
  return { files: [] };
}

export function saveFiles(workspaceId: string, files: StoredFile[], activeFileId?: string) {
  try {
    localStorage.setItem(`trinette:workspace:${workspaceId}:files`, JSON.stringify({ activeFileId, files }));
  } catch {}
}

export function legacyEditorContent(workspaceId: string): string | null {
  try {
    return localStorage.getItem(`trinette:workspace:${workspaceId}:editor`);
  } catch {
    return null;
  }
}

export function clearLegacyEditor(workspaceId: string) {
  try {
    localStorage.removeItem(`trinette:workspace:${workspaceId}:editor`);
  } catch {}
}
