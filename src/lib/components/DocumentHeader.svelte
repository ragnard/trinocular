<script lang="ts">
  import type { SqlFile, Workspace } from "$lib/State.svelte";
  import { ChevronDown, Database, FileText } from "@lucide/svelte";

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

<div class="header">
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
    <button class="chip file" class:active={open === "file"} onclick={() => toggle("file")}>
      <FileText size={14} />
      <span class="label">{file?.name ?? "No file"}</span>
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
      class:active={open === "connection"}
      onclick={() => toggle("connection")}
      title="The Trino cluster this document runs against"
    >
      <Database size={14} />
      <span class="label">{connectionName}</span>
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

  <button class="hint" onclick={onquickopen}>
    <kbd>&#8984;P</kbd>
    Switch file
  </button>
</div>

<style>
  .header {
    display: flex;
    align-items: center;
    gap: 0.25em;
    padding: 0 0.75em;
    height: 2.5em;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
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
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    max-width: 22em;
    padding: 0.25em 0.45em;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-0);
    font: inherit;
    font-size: var(--font-sm);
    cursor: pointer;
  }

  .chip.file {
    font-weight: 600;
  }

  .chip :global(svg) {
    color: var(--text-2);
    flex: none;
  }

  .chip:hover,
  .chip.active {
    background: var(--bg-2);
  }

  .chip .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rule {
    width: 1px;
    height: 1em;
    background: var(--border);
    margin: 0 0.25em;
  }

  .fill {
    flex: 1;
  }

  .menu {
    position: absolute;
    z-index: 11;
    top: calc(100% + 0.35em);
    left: 0;
    min-width: 12em;
    padding: 0.25em 0;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
  }

  .menu.wide {
    min-width: 18em;
  }

  .menu button {
    display: block;
    width: 100%;
    padding: 0.4em 0.75em;
    border: none;
    background: transparent;
    color: var(--text-0);
    font: inherit;
    font-size: var(--font-sm);
    text-align: left;
    cursor: pointer;
  }

  .menu button:hover {
    background: var(--bg-focus);
  }

  .menu button.selected {
    color: var(--accent);
  }

  .menu button.danger:hover {
    color: var(--error);
  }

  .separator {
    height: 1px;
    margin: 0.25em 0;
    background: var(--border);
  }

  .note {
    padding: 0.4em 0.75em 0.25em;
    color: var(--text-2);
    font-size: var(--font-sm);
    line-height: 1.4;
  }

  .hint {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    border: none;
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--font-sm);
    cursor: pointer;
  }

  .hint:hover {
    color: var(--text-0);
  }

  kbd {
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-0);
    padding: 0.05em 0.35em;
    font: inherit;
    font-size: 0.85em;
  }
</style>
