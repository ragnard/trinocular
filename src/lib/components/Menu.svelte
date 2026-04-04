<script lang="ts">
  import type { Query, Workspace } from "$lib/State.svelte";
  import type { TreeNode } from "./TreeView.svelte";
  import {
    Box,
    ChevronRight,
    CircleAlert,
    CircleStop,
    CircleX,
    Database,
    Download,
    LoaderCircle,
    Save,
    Settings,
    Table,

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
        <span class="title">History</span>
        <span class="fill"></span>
        <button class="settings"><Settings size={16} /></button>
      </summary>
      <div class="details query-list">
        {#if workspace.queries.length}
          {#each workspace.queries as query (query.id)}
            <div class="query" role="button" tabindex="0"
              onclick={() => workspace.setActiveQuery(query)}
              onkeydown={(e) => { if (e.key === "Enter") workspace.setActiveQuery(query); }}
            >
              <span class="query-label">
                Query #{query.id}
                {#if query.rowCount}
                  <span class="stats">({query.rowCount} rows in {query.elapsedTimeSeconds}s)</span>
                {/if}
              </span>
              <span class="query-icons">
                {#if query?.running}
                  <button class="action" onclick={(e) => { e.stopPropagation(); query.cancel(); }}>
                    <CircleStop size={16} />
                  </button>
                {:else}
                  <!-- <button class="action" title="Download to file" onclick={(e) => { }}>
                       <Download size={16} />
                       </button> -->
                  <button class="action" title="Save to workspace" onclick={(e) => { e.stopPropagation(); }}>
                    <Save size={16} />
                  </button>
                  <button class="action" title="Remove" onclick={(e) => { e.stopPropagation(); workspace.removeQuery(query); }}>
                    <CircleX size={16} />
                  </button>
                {/if}
                {#if query?.running}
                  <LoaderCircle size={16} class="spin" />
                {/if}
                {#if query?.error}
                  <CircleAlert size={16} />
                {/if}
              </span>
            </div>
          {/each}
        {:else}
          <span class="placeholder">No queries yet</span>
        {/if}
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
      {theme === "light" ? "🌙" : "☀️"}
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

    .placeholder {
      /* font-size: var(--font-sm); */
      color: var(--text-2);
      padding: 0.25em 0.25em;
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

      &:hover {
        background-color: var(--bg-focus);
        border-radius: 4px;
      }

      .query-label {
        flex: 1;
        min-width: 0;
      }

      .stats {
        font-size: var(--font-sm);
        color: var(--text-2);
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
