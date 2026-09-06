<script lang="ts">
  import type { Workspace } from "$lib/State.svelte";
  import type { TreeNode } from "./TreeView.svelte";
  import {
    Box,
    ChevronRight,
    Database,
    Moon,
    Pencil,
    Plus,
    Settings,
    Sun,
    Table,
    Trash2,
    Type
  } from "@lucide/svelte";
  import Logo from "./Logo.svelte";
  import TreeView from "./TreeView.svelte";
  import { page } from "$app/state";

  interface Props {
    workspace: Workspace;
    theme: "light" | "dark";
    onToggleTheme: () => void;
  }

  let { workspace, theme, onToggleTheme }: Props = $props();

  let userId = $derived(page.data.userId);

  let browseNodes: TreeNode[] = $derived.by(() => {
    const cache = workspace.catalog;
    const loading = cache.loading;
    return cache.catalogs.map((catalog) => ({
      id: catalog,
      label: catalog,
      loading: loading.has(`schemas:${catalog}`),
      children: cache.getSchemas(catalog).map((schema) => ({
        id: `${catalog}.${schema}`,
        label: schema,
        loading: loading.has(`tables:${catalog}.${schema}`),
        children: cache.getTables(catalog, schema).map((table) => ({
          id: `${catalog}.${schema}.${table}`,
          label: table,
          loading: loading.has(`columns:${catalog}.${schema}.${table}`),
          children: cache.getColumns(catalog, schema, table).map((col) => ({
            id: `${catalog}.${schema}.${table}.${col.name}`,
            label: col.name,
            detail: col.type
          }))
        }))
      }))
    }));
  });

  function handleExpand(node: TreeNode) {
    const parts = node.id.split(".");
    const cache = workspace.catalog;
    if (parts.length === 1) {
      cache.loadSchemas(parts[0]);
    } else if (parts.length === 2) {
      cache.loadTables(parts[0], parts[1]);
    } else if (parts.length === 3) {
      cache.loadColumns(parts[0], parts[1], parts[2]);
    }
  }

  $effect(() => {
    workspace.catalog.loadCatalogs();
  });
</script>

<div class="menu-container">
  <div class="menu-top">
    <div class="brand"><Logo /> Oink</div>
  </div>

  <div class="menu-content">
    <details open>
      <summary>
        <ChevronRight size={14} class="toggle" />
        <span class="title">Connection</span>
        <span class="fill"></span>
        <button class="settings"><Settings size={16} /></button>
      </summary>
      <div class="details connection-select">
        <select
          value={workspace.connectionId}
          onchange={(e) => workspace.setConnection(e.currentTarget.value)}
        >
          {#each page.data.connections as conn (conn.id)}
            <option value={conn.id}>{conn.name}</option>
          {/each}
        </select>
      </div>
    </details>

    <details open>
      <summary>
        <ChevronRight size={14} class="toggle" />
        <span class="title">Files</span>
        <span class="fill"></span>
        <button class="settings" title="New file" onclick={(e) => { e.stopPropagation(); workspace.createFile(); }}>
          <Plus size={16} />
        </button>
      </summary>
      <div class="details query-list">
        {#each workspace.files as file (file.id)}
          <div
            class="query"
            class:active={file === workspace.activeFile}
            role="button"
            tabindex="0"
            onclick={() => workspace.openFile(file)}
            onkeydown={(e) => { if (e.key === "Enter") workspace.openFile(file); }}
          >
            <span class="query-label">{file.name}</span>
            <span class="query-icons">
              <button
                class="action"
                title="Rename"
                onclick={(e) => {
                  e.stopPropagation();
                  const name = prompt("File name", file.name);
                  if (name) workspace.renameFile(file, name);
                }}
              >
                <Pencil size={16} />
              </button>
              <button class="action" title="Delete" onclick={(e) => { e.stopPropagation(); workspace.deleteFile(file); }}>
                <Trash2 size={16} />
              </button>
            </span>
          </div>
        {/each}
      </div>
    </details>

    <details open>
      <summary>
        <ChevronRight size={14} class="toggle" />
        <span class="title">Browse</span>
        <span class="fill"></span>
        <button class="settings"><Settings size={16} /></button>
      </summary>
      <div class="details browse-tree">
        <TreeView nodes={browseNodes} onexpand={handleExpand}>
          {#snippet icon(node)}
            {@const depth = node.id.split(".").length}
            {#if depth === 1}
              <Database size={16} />
            {:else if depth === 2}
              <Box size={16} />
            {:else if depth === 3}
              <Table size={16} />
            {:else if depth === 4}
              <Type size={16} />
            {/if}
          {/snippet}
        </TreeView>
      </div>
    </details>
  </div>

  <div class="menu-bottom">
    <button class="theme-toggle" onclick={onToggleTheme} title="Toggle dark mode">
      {#if theme === "light"}
        <Moon size={16} />
      {:else}
        <Sun size={16} />
      {/if}
    </button>
    <div class="user">{userId}</div>
  </div>
</div>

<style>
  .menu-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .menu-top {
    padding: 0.6em 1em;
    border-bottom: 1px solid var(--border);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.4em;
    font-weight: bold;
  }

  .menu-content {
    display: flex;
    flex-direction: column;
    /* gap: 2em; */
    flex: 1;
    overflow: auto;
    padding: 1em;
  }

  .menu-bottom {
    border-top: 1px solid var(--border);
    padding: 0.6em 1em;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5em;
  }

  .theme-toggle {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    padding: 0.2em 0.4em;
    display: flex;
    align-items: center;
    color: var(--text-2);
  }

  .theme-toggle:hover {
    color: var(--bg-text);
  }

  .user {
    font-size: var(--font-sm);
    color: var(--text-2);
  }

  details[open] > summary :global(.toggle) {
    transform: rotate(90deg);
  }

  details {
    summary {
      display: flex;
      list-style: none;
      flex-direction: row;
      align-items: center;
      margin-bottom: 1em;
      cursor: pointer;
      justify-content: space-between;
      color: var(--text-2);

      :global(.toggle) {
        transition: transform 0.15s ease;
        margin-right: 0.25em;
      }

      .title {
        font-size: var(--font-sm);
        font-weight: bold;
        text-transform: uppercase;
      }

      .fill {
        flex: 1;
      }

    }

    .details {
      margin-bottom: 2em;
      margin-left: 0.25em;
    }


    button {
      padding: 0;
      margin: 0;
      border: none;
      background: transparent;
      color: var(--text-2);
      cursor: pointer;

      &:hover {
        color: var(--bg-text);
      }
    }

    .query-list {
      display: flex;
      flex-direction: column;
    }

    .connection-select {
      select {
        width: 100%;
        cursor: pointer;
      }
    }

    .query {
      display: flex;
      flex-direction: row;
      align-items: center;
      padding: 0.25em 0.25em;
      margin-left: -0.25em;
      margin-right: -0.25em;
      width: calc(100% + 0.5em);
      text-align: left;
      cursor: pointer;

      &:hover,
      &.active {
        background-color: var(--bg-focus);
        border-radius: 4px;
      }

      .query-label {
        flex: 1;
        min-width: 0;
      }

      .query-icons {
        display: flex;
        align-items: center;
        gap: 0.25em;
      }

      .action {
        visibility: hidden;
      }

      &:hover .action {
        visibility: visible;
      }
    }
  }
</style>
