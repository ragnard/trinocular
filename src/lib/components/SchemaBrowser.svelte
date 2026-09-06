<script lang="ts">
  import type { Workspace } from "$lib/State.svelte";
  import type { TreeNode } from "./TreeView.svelte";
  import { Box, Database, Search, Table, Type } from "@lucide/svelte";
  import TreeView from "./TreeView.svelte";
  import { page } from "$app/state";

  interface Props {
    workspace: Workspace;
  }

  let { workspace }: Props = $props();

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
   * Toggles made while a filter is up, which have to be able to shut a branch
   * the filter itself opened. Dropped when the filter clears.
   */
  let filterOverride = $state(new Map<string, boolean>());

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
   * A node kept on its own name keeps its children whole — whatever you had
   * open under it stays open, which is the point: filtering for a schema you
   * are working in should not collapse the table you were reading. A node kept
   * only because something beneath it matched is recorded in `ancestors` and
   * forced open, since it is on screen to place the match.
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

  /**
   * Filtering does not decide what is open — you did. A branch is open because
   * you had it open, plus the ones holding a match on screen, minus anything
   * you have since clicked shut. So filtering never reveals a subtree you had
   * collapsed (it cannot paint three thousand rows you were not already
   * looking at), and everything you *had* expanded under a match stays where
   * it was.
   */
  let open: Set<string> = $derived.by(() => {
    if (!filtering) return browseOpen;
    const ids = new Set(browseOpen);
    for (const id of pruned.ancestors) ids.add(id);
    for (const [id, isOpen] of filterOverride) {
      if (isOpen) ids.add(id);
      else ids.delete(id);
    }
    return ids;
  });

  $effect(() => {
    if (!filtering) filterOverride = new Map();
  });

  /**
   * Opening a branch is the only thing in this component that goes to the
   * cluster, and it takes a click to get here. `load*` answers from cache when
   * it has one, so re-opening a branch costs nothing.
   */
  function handleToggle(node: TreeNode) {
    const opening = !open.has(node.id);

    // Recorded against the browse state either way, so what you open or shut
    // while filtering is still what you find when the filter clears.
    const next = new Set(browseOpen);
    if (opening) next.add(node.id);
    else next.delete(node.id);
    openByConnection = { ...openByConnection, [connectionId]: next };

    // A branch the filter is holding open needs the override to shut it.
    if (filtering) filterOverride = new Map(filterOverride).set(node.id, opening);

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
  <!-- The filter IS the header. It used to be a third stacked row under a
       brand and a section label, which is how this pane ended up 112px of
       chrome deep against the document header's 40. -->
  <div class="rail">
    <Search size={14} />
    <input
      type="text"
      placeholder="Filter&hellip;"
      bind:value={filter}
      spellcheck="false"
      aria-label="Filter schema"
    />
  </div>

  <!-- Says what the tree is. The connection also appears in the document
       header, where it says what the file runs on; sitting on one band the
       two read as the same fact rather than a repetition. -->
  <div class="scope meta">
    <Database size={12} />
    <span class="ell">{connectionName}</span>
  </div>

  <div class="tree">
    <TreeView nodes={visible} expanded={open} ontoggle={handleToggle}>
      {#snippet icon(node)}
        {@const depth = node.id.split(".").length}
        {#if depth === 1}
          <Database size={14} />
        {:else if depth === 2}
          <Box size={14} />
        {:else if depth === 3}
          <Table size={14} />
        {:else}
          <Type size={14} />
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
</div>

<style>
  .browser {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--s1);
  }

  /* The rail keeps the pane's own surface, so the filter reads as the pane's
     header rather than a control sitting on one. */
  .rail {
    background: transparent;
    color: var(--fg-3);
  }

  .rail:focus-within {
    color: var(--accent);
  }

  .rail input {
    flex: 1;
    min-width: 0;
    height: auto;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--fg);
  }

  .rail input:focus-visible {
    outline: none;
  }

  .scope {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: var(--h-tree);
    padding: 0 12px;
  }

  .tree {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 8px 8px;
  }

  .hint {
    padding: 8px;
    color: var(--fg-3);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }

  .hint.error {
    color: var(--error);
  }
</style>
