import type { PageLoad } from "./$types";
import { LocalWorkspaceStore } from "$lib/fileStorage";
import { RemoteWorkspaceStore } from "$lib/remoteWorkspaceStore";
import type { WorkspaceStore } from "$lib/workspaceStore";

export const ssr = false;

const WORKSPACE_ID = "default";

// The workspace is read here, before the page renders, so that `Workspace` is
// built from a list that is already there: everything reactive in it is made
// in its constructor, and the constructor stays synchronous.
export const load: PageLoad = async ({ parent }) => {
  const { fileStorage } = await parent();
  const store: WorkspaceStore =
    fileStorage === "server"
      ? new RemoteWorkspaceStore(WORKSPACE_ID)
      : new LocalWorkspaceStore(WORKSPACE_ID);
  return { store, loaded: await store.load() };
};
