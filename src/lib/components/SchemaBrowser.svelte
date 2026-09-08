<script lang="ts">
  import type { Workspace } from "$lib/State.svelte";
  import type { TreeNode } from "./TreeView.svelte";
  import type { TypeCategory } from "$lib/trino/typeString";
  import { abbreviateType, typeCategory, typeChildren } from "$lib/trino/typeString";
  import {
    Binary,
    Box,
    Braces,
    Brackets,
    Clock,
    Database,
    Hash,
    Parentheses,
    Search,
    Server,
    Table,
    ToggleLeft,
    Type
  } from "@lucide/svelte";
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

  /**
   * Path segments are joined with a unit separator, not a dot. A dot is a
   * character Trino identifiers are allowed to contain — `SHOW COLUMNS` will
   * report a field literally named `weird name.with dot` — so a dotted id
   * could never be taken apart again with any confidence.
   */
  const SEP = "\u001f";

  type NodeKind = "catalog" | "schema" | "table" | TypeCategory;

  interface NodeMeta {
    /** Picks the icon, and nothing else. */
    kind: NodeKind;
    /** Only the three levels that live on the cluster have anything to fetch. */
    load?: () => void;
  }

  /**
   * The tree and, beside it, what each node *is*. This used to be read back out
   * of the id by counting dots, which a field named with a dot already broke
   * and which stopped meaning anything at all once a column's own fields hang
   * below it at no fixed depth. Saying it once, here, where the node is built,
   * is the only version that cannot drift from what was built.
   */
  let tree: { nodes: TreeNode[]; meta: Map<string, NodeMeta> } = $derived.by(() => {
    const cache = workspace.catalog;
    const loading = cache.loading;
    const meta = new Map<string, NodeMeta>();

    /**
     * A type, expanded in place, as deep as it goes. Nothing in here reaches
     * the cluster: the whole shape already arrived in the string `SHOW COLUMNS`
     * returned, so a row nested six deep costs a parse and not a round trip.
     */
    function typeNodes(prefix: string, type: string): TreeNode[] | undefined {
      const fields = typeChildren(type);
      if (fields.length === 0) return undefined;
      return fields.map((field, i) => {
        // Keyed by position: two fields of a row cannot share one, and there is
        // nothing else about them that they are guaranteed not to share.
        const id = `${prefix}${SEP}${i}`;
        meta.set(id, { kind: typeCategory(field.type) });
        return {
          id,
          label: field.name,
          detail: abbreviateType(field.type),
          // Both halves, because at six levels of indent it is as often the
          // name that ran out of room as the type.
          hint: `${field.name} ${field.type}`,
          children: typeNodes(id, field.type)
        };
      });
    }

    const nodes = cache.catalogs.map((catalog) => {
      meta.set(catalog, { kind: "catalog", load: () => cache.loadSchemas(catalog) });
      return {
        id: catalog,
        label: catalog,
        loading: loading.has(`schemas:${catalog}`),
        children: cache.getSchemas(catalog).map((schema) => {
          const schemaId = `${catalog}${SEP}${schema}`;
          meta.set(schemaId, { kind: "schema", load: () => cache.loadTables(catalog, schema) });
          return {
            id: schemaId,
            label: schema,
            loading: loading.has(`tables:${catalog}.${schema}`),
            children: cache.getTables(catalog, schema).map((table) => {
              const tableId = `${schemaId}${SEP}${table}`;
              meta.set(tableId, {
                kind: "table",
                load: () => cache.loadColumns(catalog, schema, table)
              });
              return {
                id: tableId,
                label: table,
                loading: loading.has(`columns:${catalog}.${schema}.${table}`),
                children: cache.getColumns(catalog, schema, table).map((col) => {
                  const colId = `${tableId}${SEP}${col.name}`;
                  meta.set(colId, { kind: typeCategory(col.type) });
                  return {
                    id: colId,
                    label: col.name,
                    detail: abbreviateType(col.type),
                    hint: `${col.name} ${col.type}`,
                    children: typeNodes(colId, col.type)
                  };
                })
              };
            })
          };
        })
      };
    });

    return { nodes, meta };
  });

  let nodes: TreeNode[] = $derived(tree.nodes);
  let meta: Map<string, NodeMeta> = $derived(tree.meta);

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

    // Nested fields have no `load`: their shape came down with the column's
    // type string, so opening one is a pure display change.
    meta.get(node.id)?.load?.();
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
  <div class="scope">
    <Server size={14} />
    <span class="ell">{connectionName}</span>
  </div>

  <div class="tree">
    <TreeView nodes={visible} expanded={open} ontoggle={handleToggle}>
      {#snippet icon(node)}
        {@const kind = meta.get(node.id)?.kind}
        {#if kind === "catalog"}
          <Database size={14} />
        {:else if kind === "schema"}
          <Box size={14} />
        {:else if kind === "table"}
          <Table size={14} />
        {:else if kind === "row"}
          <Braces size={14} />
        {:else if kind === "array"}
          <Brackets size={14} />
        {:else if kind === "map"}
          <Parentheses size={14} />
        {:else if kind === "numeric"}
          <Hash size={14} />
        {:else if kind === "temporal"}
          <Clock size={14} />
        {:else if kind === "binary"}
          <Binary size={14} />
        {:else if kind === "boolean"}
          <ToggleLeft size={14} />
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

  /* Body text, not `.meta`. This names the cluster every row in the tree below
     belongs to, which is the same weight of fact as the tree itself — at
     `--text-sm` it read as a caption on the filter above it instead. Muted, so
     it still sits behind the tree without shrinking. */
  .scope {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: var(--h-tree);
    padding: 0 12px;
    color: var(--fg-3);
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
