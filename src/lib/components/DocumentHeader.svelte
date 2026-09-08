<script lang="ts">
  import type { SqlFile, Workspace } from "$lib/State.svelte";
  import { Boxes, ChevronDown, FileText } from "@lucide/svelte";

  interface Connection {
    id: string;
    name: string;
  }

  interface Props {
    workspace: Workspace;
    connections: Connection[];
    /** Opens the file switcher; the header only advertises the shortcut. */
    onquickopen: () => void;
  }

  let { workspace, connections, onquickopen }: Props = $props();

  /**
   * The bar names the document you are editing and the one thing that decides
   * what its statements mean: the cluster they run against. The file is the
   * noun, the connection is its address — which is why the two are separated
   * by a rule rather than sitting side by side as equals.
   */
  let file: SqlFile | null = $derived(workspace.activeFile);
  let connectionName = $derived(
    connections.find((c) => c.id === workspace.connectionId)?.name ||
      workspace.connectionId ||
      "No connection"
  );

  let open: "file" | "connection" | null = $state(null);

  function toggle(menu: "file" | "connection") {
    open = open === menu ? null : menu;
  }

  function rename() {
    open = null;
    if (!file) return;
    const name = prompt("File name", file.name);
    if (name) workspace.renameFile(file, name);
  }

  function remove() {
    open = null;
    if (file) workspace.deleteFile(file);
  }

  function create() {
    open = null;
    workspace.createFile();
  }

  function pick(connectionId: string) {
    open = null;
    if (file) workspace.setFileConnection(file, connectionId);
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") open = null;
  }}
/>

<div class="rail">
  <!-- Clicking anywhere else dismisses an open menu; the backdrop only exists
       while one is open, so it never eats a click otherwise. -->
  {#if open}
    <div
      class="backdrop"
      role="presentation"
      onclick={() => (open = null)}
      oncontextmenu={() => (open = null)}
    ></div>
  {/if}

  <div class="anchor">
    <button class="chip file" aria-pressed={open === "file"} onclick={() => toggle("file")}>
      <FileText size={14} />
      <span class="ell">{file?.name ?? "No file"}</span>
      <ChevronDown size={12} />
    </button>
    {#if open === "file"}
      <div class="menu">
        <button onclick={rename}>Rename&hellip;</button>
        <button onclick={create}>New file</button>
        <button onclick={() => { open = null; onquickopen(); }}>Switch file&hellip;</button>
        <div class="separator"></div>
        <button class="danger" onclick={remove}>Delete file</button>
      </div>
    {/if}
  </div>

  <span class="rule"></span>

  <div class="anchor">
    <button
      class="chip"
      aria-pressed={open === "connection"}
      onclick={() => toggle("connection")}
      title="The Trino cluster this document runs against"
    >
      <Boxes size={14} />
      <span class="ell">{connectionName}</span>
      <ChevronDown size={12} />
    </button>
    {#if open === "connection"}
      <div class="menu wide">
        {#each connections as connection (connection.id)}
          <button
            class:selected={connection.id === workspace.connectionId}
            onclick={() => pick(connection.id)}
          >
            {connection.name}
          </button>
        {/each}
        <div class="separator"></div>
        <div class="note">
          Applies to <strong>{file?.name ?? "this file"}</strong> only. Its statements, results and
          the schema browser follow this connection.
        </div>
      </div>
    {/if}
  </div>

  <span class="fill"></span>

  <button class="chip" onclick={onquickopen}>
    <kbd>&#8984;P</kbd>
    Switch file
  </button>
</div>

<style>
  .rail {
    position: relative;
    gap: 2px;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
  }

  .anchor {
    position: relative;
    min-width: 0;
  }

  .chip {
    max-width: 22em;
  }

  /* The file is the noun; the connection is its address. */
  .chip.file {
    color: var(--fg);
    font-weight: 600;
  }

  .chip :global(svg) {
    color: var(--fg-3);
  }

  .rule {
    width: 1px;
    height: 16px;
    margin: 0 8px;
    background: var(--line-strong);
  }

  .fill {
    flex: 1;
  }

  .menu {
    position: absolute;
    z-index: 11;
    top: calc(100% + 6px);
    left: 0;
    min-width: 12em;
    padding: 4px 0;
    background: var(--s2);
    border: 1px solid var(--line-strong);
    border-radius: var(--r);
    box-shadow: var(--shadow);
  }

  .menu.wide {
    min-width: 18em;
  }

  .menu button {
    display: block;
    width: 100%;
    height: var(--h-tree);
    padding: 0 12px;
    border: none;
    background: transparent;
    color: var(--fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .menu button:hover {
    background: var(--s3);
  }

  .menu button.selected {
    color: var(--accent);
  }

  .menu button.danger:hover {
    color: var(--error);
  }

  .separator {
    height: 1px;
    margin: 4px 0;
    background: var(--line-strong);
  }

  .note {
    padding: 4px 12px 6px;
    color: var(--fg-3);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }
</style>
