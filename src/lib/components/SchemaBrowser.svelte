<script lang="ts">
  import type { Workspace } from "$lib/State.svelte";
  import type { TreeNode } from "./TreeView.svelte";
  import type { TypeCategory } from "$lib/trino/typeString";
  import { abbreviateType, typeCategory, typeChildren } from "$lib/trino/typeString";
  import { selectStatement, terminated, type TableRef } from "$lib/trino/statements";
  import { Box, Database, Globe, HardDrive, SquareChevronDown, Table, X } from "@lucide/svelte";
  import FilterBox from "./FilterBox.svelte";
  import Menu from "./Menu.svelte";
  import TreeView from "./TreeView.svelte";
  import TypeIcon from "./TypeIcon.svelte";
  import { page } from "$app/state";

  interface Props {
    workspace: Workspace;
    /** Puts a statement into the active document. Without it the menu only copies. */
    oninsert?: (sql: string) => void;
  }

  let { workspace, oninsert }: Props = $props();

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
    load?: (fresh?: boolean) => Promise<unknown>;
    /** The parts of a table's name, for the statements written about it. */
    table?: TableRef;
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
    const errors = cache.errors;
    const working = busy;
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
      meta.set(catalog, {
        kind: "catalog",
        load: (fresh) => cache.loadSchemas(catalog, fresh)
      });
      return {
        id: catalog,
        label: catalog,
        loading: loading.has(`schemas:${catalog}`),
        error: errors.get(`schemas:${catalog}`),
        reloadable: true,
        children: cache.getSchemas(catalog).map((schema) => {
          const schemaId = `${catalog}${SEP}${schema}`;
          meta.set(schemaId, {
            kind: "schema",
            load: (fresh) => cache.loadTables(catalog, schema, fresh)
          });
          return {
            id: schemaId,
            label: schema,
            loading: loading.has(`tables:${catalog}.${schema}`),
            error: errors.get(`tables:${catalog}.${schema}`),
            reloadable: true,
            children: cache.getTables(catalog, schema).map((table) => {
              const tableId = `${schemaId}${SEP}${table}`;
              meta.set(tableId, {
                kind: "table",
                load: (fresh) => cache.loadColumns(catalog, schema, table, fresh),
                table: { catalog, schema, table }
              });
              return {
                id: tableId,
                label: table,
                loading:
                  loading.has(`columns:${catalog}.${schema}.${table}`) || working.has(tableId),
                error: errors.get(`columns:${catalog}.${schema}.${table}`),
                reloadable: true,
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
    loadNode(node);
  }

  /**
   * The rejection carries nothing the tree does not already draw: the cache
   * records why under the node's key, and the node shows it. Once the list is
   * in, every open branch under it is asked for again — answered from cache
   * for free, and fetched only where a failure had dropped the list, so a
   * reload of the parent is what brings a child back.
   */
  async function loadNode(node: TreeNode, fresh = false) {
    const load = meta.get(node.id)?.load;
    if (!load) return;
    try {
      await load(fresh);
    } catch {
      return;
    }
    const under = `${node.id}${SEP}`;
    for (const id of open) {
      if (id.startsWith(under)) meta.get(id)?.load?.().catch(() => {});
    }
  }

  function handleReload(node: TreeNode) {
    loadNode(node, true);
  }

  /**
   * The statements a table's menu offers. One menu for the whole tree, pointed
   * at by every table row's button, for the same reason the inspector shares
   * one: only one can be open. The CREATE is the cluster's own DDL and costs a
   * query; the SELECT is written from the columns the tree already holds, or
   * fetches them, which is the same fetch opening the row does.
   */
  const menuId = $props.id();
  let target: TreeNode | null = $state.raw(null);
  let anchor: HTMLElement | null = $state(null);
  let menuOpen = $state(false);

  /** Table rows with a statement on the way; drawn as the row loading. */
  let busy: Set<string> = $state.raw(new Set());
  let actionError: string | null = $state(null);

  function startAction(node: TreeNode, button: HTMLElement) {
    target = node;
    anchor = button;
  }

  type StatementKind = "CREATE" | "SELECT";

  async function statementFor(ref: TableRef, kind: StatementKind): Promise<string> {
    const cache = workspace.catalog;
    if (kind === "CREATE")
      return terminated(await cache.showCreate(ref.catalog, ref.schema, ref.table));
    return selectStatement(ref, await cache.loadColumns(ref.catalog, ref.schema, ref.table));
  }

  async function act(node: TreeNode, kind: StatementKind, how: "copy" | "insert") {
    const ref = meta.get(node.id)?.table;
    if (!ref) return;
    actionError = null;
    busy = new Set(busy).add(node.id);
    try {
      const sql = await statementFor(ref, kind);
      if (how === "copy") await navigator.clipboard.writeText(sql);
      else oninsert?.(sql);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      actionError = `Could not ${how} ${kind} statement for ${node.label}: ${reason}`;
    } finally {
      const next = new Set(busy);
      next.delete(node.id);
      busy = next;
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
  <div class="rail">
    <Globe size={14} />
    <span class="ell title">Data browser</span>
  </div>

  <FilterBox bind:value={filter} label="Filter schema" />

  <!-- Says what the tree is. The connection also appears in the document
       header, where it says what the file runs on; sitting on one band the
       two read as the same fact rather than a repetition. -->
  <div class="scope">
    <HardDrive size={14} />
    <span class="ell">{connectionName}</span>
  </div>

  <div class="tree">
    <TreeView nodes={visible} expanded={open} ontoggle={handleToggle} onreload={handleReload}>
      {#snippet actions(node)}
        {#if meta.get(node.id)?.kind === "table"}
          <button
            popovertarget={menuId}
            aria-pressed={menuOpen && target?.id === node.id}
            aria-haspopup="true"
            title="SQL for {node.label}"
            onclick={(e) => startAction(node, e.currentTarget)}
          >
            <SquareChevronDown size={14} />
          </button>
        {/if}
      {/snippet}
      {#snippet icon(node)}
        {@const kind = meta.get(node.id)?.kind}
        {#if kind === "catalog"}
          <Database size={14} />
        {:else if kind === "schema"}
          <Box size={14} />
        {:else if kind === "table"}
          <Table size={14} />
        {:else}
          <TypeIcon category={kind ?? "other"} />
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

  <!-- Below the tree rather than under the row: the row's own error line is
       drawn only while the row is open, and a statement is asked for from a
       closed one as often as not. -->
  {#if actionError}
    <div class="notice">
      <span>{actionError}</span>
      <button class="chip square" title="Dismiss" onclick={() => (actionError = null)}>
        <X size={12} />
      </button>
    </div>
  {/if}
</div>

<!-- One menu, shared. `target` is whichever table's button last opened it. -->
<Menu id={menuId} {anchor} onopenchange={(o) => (menuOpen = o)}>
  {#snippet menu()}
    {#if target}
      {@const node = target}
      <button onclick={() => act(node, "CREATE", "copy")}>Copy CREATE statement</button>
      <button onclick={() => act(node, "SELECT", "copy")}>Copy SELECT statement</button>
      {#if oninsert}
        <div class="separator"></div>
        <button onclick={() => act(node, "CREATE", "insert")}>Insert CREATE statement</button>
        <button onclick={() => act(node, "SELECT", "insert")}>Insert SELECT statement</button>
      {/if}
    {/if}
  {/snippet}
</Menu>

<style>
  .browser {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--s1);
  }

  .rail :global(svg) {
    color: var(--fg-3);
  }

  .title {
    flex: 1;
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

  .notice {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    flex: none;
    padding: 6px 8px 8px 12px;
    border-top: 1px solid var(--line);
    color: var(--error);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    overflow-wrap: anywhere;
  }

  .notice span {
    flex: 1;
    min-width: 0;
  }
</style>
