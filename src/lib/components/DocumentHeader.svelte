<script lang="ts">
  import type { SqlFile, Workspace } from "$lib/State.svelte";
  import { CloudOff, FileText } from "@lucide/svelte";
  import Dropdown from "./Dropdown.svelte";

  interface Props {
    workspace: Workspace;
    /** Opens the file switcher; the header only advertises the shortcut. */
    onquickopen: () => void;
  }

  let { workspace, onquickopen }: Props = $props();

  /**
   * The bar names the document you are editing and nothing about where it
   * runs: the cluster is the workspace's, chosen in the data browser's rail,
   * and every document runs against it.
   */
  let file: SqlFile | null = $derived(workspace.activeFile);

  function rename() {
    if (!file) return;
    const name = prompt("File name", file.name);
    if (name) workspace.renameFile(file, name);
  }

  function remove() {
    if (file) workspace.deleteFile(file);
  }
</script>

<div class="rail">
  <Dropdown icon={FileText} label={file?.name ?? "No file"} strong>
    {#snippet menu()}
      <button onclick={rename}>Rename&hellip;</button>
      <button onclick={() => workspace.createFile()}>New file</button>
      <button onclick={onquickopen}>Switch file&hellip;</button>
      <div class="separator"></div>
      <button class="danger" onclick={remove}>Delete file</button>
    {/snippet}
  </Dropdown>

  <span class="fill"></span>

  {#if workspace.saveFailed}
    <span
      class="unsaved"
      title="A save failed and is being retried. Your edits are only in this tab until it succeeds."
    >
      <CloudOff size={14} />
      Not saved
    </span>
  {/if}

  <button class="chip" onclick={onquickopen}>
    <kbd>&#8984;P</kbd>
    Switch file
  </button>
</div>

<style>
  .rail {
    gap: 2px;
  }

  /* Shown only once a save has failed and is being retried: the half-second
     between a keystroke and its save is not worth a flicker. */
  .unsaved {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    color: var(--error);
    font-size: var(--text-sm);
  }

  button.danger:hover {
    color: var(--error);
  }
</style>
