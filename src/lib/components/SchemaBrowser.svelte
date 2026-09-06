<script lang="ts">
  import type { Workspace } from "$lib/State.svelte";
  import type { TreeNode } from "./TreeView.svelte";
  import { Box, Database, Moon, Search, Sun, Table, Type } from "@lucide/svelte";
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
  let connectionName = $derived(
    page.data.connections?.find((c: { id: string }) => c.id === workspace.connectionId)?.name ||
      workspace.connectionId ||
      "No connection"
  );

  let filter = $state("");
  let filtering = $derived(filter.trim().length > 0);

  /**
   * The active document's connection, as a value. Reading it through
   * `workspace` touches `activeFile` too, so anything downstream of that would
   * also fire when you merely switch between two files on the same cluster.
   */
  let connectionId = $derived(workspace.connectionId);

  const NO_IDS: Set<string> = new Set();

  /**
   * What is open, kept per connection: node ids are bare catalog and schema
   * names, which collide across clusters, and each cluster's tree was fetched
   * separately anyway. Keeping them apart means coming back to a document on
   * the other cluster finds the tree as you left it — the point of holding a
   * `CatalogCache` per connection in the first place.
   */
  let openByConnection: Record<string, Set<string>> = $state({});
  let browseOpen = $derived(openByConnection[connectionId] ?? NO_IDS);

  /**
   * A filter runs with its own open-set, seeded with the branches that have to
   * be open to show the matches. It is separate from `browseOpen` because the
   * two want opposite things: filtering for "hive" should show you the catalog
   * named hive, not the three thousand tables you happened to have open under
   * it. Clearing the filter drops it and browsing resumes where it was.
   */
  let filterOpen = $state(new Set<string>());
  let open = $derived(filtering ? filterOpen : browseOpen);

  let nodes: TreeNode[] = $derived.by(() => {
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

  /**
   * Narrows what is already on screen — it never asks the cluster for more.
   * A catalog here can hold thousands of tables behind connectors that take
   * seconds to answer, so "search everything" would mean walking every catalog
   * on every keystroke. Expanding a branch is still the only thing that
   * fetches; this just hides what does not match.
   *
   * A node kept on its own name keeps all its children and stays shut, so the
   * keystroke costs one row and opening it shows the real contents. A node
   * kept only because something beneath it matched is recorded in `ancestors`
   * and opened, since it is on screen to place the match.
   */
  function prune(nodes: TreeNode[], needle: string, ancestors: Set<string>): TreeNode[] {
    const kept: TreeNode[] = [];
    for (const node of nodes) {
      if (node.label.toLowerCase().includes(needle)) {
        kept.push(node);
        continue;
      }
      const children = node.children ? prune(node.children, needle, ancestors) : [];
      if (children.length > 0) {
        ancestors.add(node.id);
        kept.push({ ...node, children });
      }
    }
    return kept;
  }

  let pruned: { nodes: TreeNode[]; ancestors: Set<string> } = $derived.by(() => {
    if (!filtering) return { nodes, ancestors: NO_IDS };
    const ancestors = new Set<string>();
    return { nodes: prune(nodes, filter.trim().toLowerCase(), ancestors), ancestors };
  });
  let visible: TreeNode[] = $derived(pruned.nodes);

  // Merged rather than assigned, so a branch opened by hand while the filter
  // is up survives the rebuild that a finished fetch causes.
  $effect(() => {
    const ancestors = pruned.ancestors;
    for (const id of ancestors) {
      if (!filterOpen.has(id)) {
        filterOpen = new Set([...filterOpen, ...ancestors]);
        return;
      }
    }
  });

  $effect(() => {
    if (!filtering) filterOpen = new Set();
  });

  /**
   * Opening a branch is the only thing in this component that goes to the
   * cluster, and it takes a click to get here. `load*` answers from cache when
   * it has one, so re-opening a branch costs nothing.
   */
  function handleToggle(node: TreeNode) {
    const next = new Set(open);
    const opening = !next.has(node.id);
    if (opening) next.add(node.id);
    else next.delete(node.id);

    if (filtering) filterOpen = next;
    else openByConnection = { ...openByConnection, [connectionId]: next };

    if (!opening) return;

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

  /**
   * The catalog list is the one fetch nobody asks for, so it is also the one
   * whose failure has nowhere to surface. An unreachable cluster — or one no
   * longer in the config — rejects here, and without this the only trace is an
   * unhandled rejection in the console.
   */
  let loadError: string | null = $state(null);

  $effect(() => {
    const cache = workspace.catalog;
    loadError = null;
    cache.loadCatalogs().catch((e) => {
      loadError = e instanceof Error ? e.message : String(e);
    });
  });
</script>

<div class="browser">
  <div class="top">
    <div class="brand"><Logo /> Oink</div>
  </div>

  <div class="filter">
    <Search size={14} />
    <input type="text" placeholder="Filter&hellip;" bind:value={filter} spellcheck="false" />
  </div>

  <div class="scope">
    <span class="title">Schema</span>
    <span class="connection" title="The connection this document runs against">
      <Database size={12} />
      {connectionName}
    </span>
  </div>

  <div class="tree">
    <TreeView nodes={visible} expanded={open} ontoggle={handleToggle}>
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
    {#if loadError}
      <div class="hint error">Could not list catalogs: {loadError}</div>
    {:else if filtering}
      <div class="hint">
        {visible.length === 0 ? "Nothing loaded matches." : "Filtering what is loaded."}
        Expand a catalog to fetch more.
      </div>
    {/if}
  </div>

  <div class="bottom">
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
  .browser {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .top {
    padding: 0.6em 1em;
    border-bottom: 1px solid var(--border);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.4em;
    font-weight: bold;
  }

  .filter {
    display: flex;
    align-items: center;
    gap: 0.4em;
    margin: 0.6em 0.75em 0.35em;
    padding: 0 0.5em;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-0);
    color: var(--text-2);
  }

  .filter:focus-within {
    border-color: var(--accent);
  }

  .filter input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--text-0);
    padding: 0.35em 0;
    font: inherit;
  }

  .filter input:focus {
    outline: none;
  }

  .scope {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5em;
    padding: 0.4em 0.9em 0.5em;
    color: var(--text-2);
    font-size: var(--font-sm);
  }

  .scope .title {
    font-weight: bold;
    text-transform: uppercase;
  }

  .scope .connection {
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tree {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 0.75em 0.75em;
  }

  .hint {
    padding: 0.5em 0.25em;
    color: var(--text-2);
    font-size: var(--font-sm);
  }

  .hint.error {
    color: var(--error);
  }

  .bottom {
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

  .user {
    font-size: var(--font-sm);
    color: var(--text-2);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
