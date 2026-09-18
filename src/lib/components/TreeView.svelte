<script lang="ts" module>
  import type { Snippet } from "svelte";

  export interface TreeNode {
    id: string;
    label: string;
    detail?: string;
    /**
     * The whole truth behind a row that had to be shortened, on hover. A nested
     * row's type runs to hundreds of characters, so the tree shows `row`
     * rather than taking its width from the worst column in the schema — and
     * deep enough in, the ellipsis falls on the label instead.
     */
    hint?: string;
    children?: TreeNode[];
    /** Offers the reload button. Only nodes whose children come from somewhere are. */
    reloadable?: boolean;
  }

  const NONE: ReadonlySet<string> = new Set();
  const NO_ERRORS: ReadonlyMap<string, string> = new Map();
</script>

<script lang="ts">
  import { ChevronRight, LoaderCircle, RefreshCw } from "@lucide/svelte";
  import TreeView from "./TreeView.svelte";

  interface Props {
    nodes: TreeNode[];
    /**
     * Which branches are open — the whole truth, owned by the caller. It lives
     * outside this component because a filter rebuilds `nodes`, and with it
     * these component instances; state kept in here would be lost on every
     * filter and clear. Keeping it the only input to `isOpen` is also what
     * stops the chevron from lying: whatever it draws, clicking changes.
     */
    expanded: Set<string>;
    /**
     * Status, by node id, kept apart from the nodes on purpose: a spinner
     * starting on one row must not rebuild the tree — with a few thousand
     * columns loaded, that rebuild re-parses every one of their types.
     */
    loading?: ReadonlySet<string>;
    /** Why the last attempt to fill a node's children failed; drawn under the row while it is open. */
    errors?: ReadonlyMap<string, string>;
    ontoggle: (node: TreeNode) => void;
    onclick?: (node: TreeNode) => void;
    onreload?: (node: TreeNode) => void;
    icon?: Snippet<[TreeNode]>;
    /**
     * Per-row controls, revealed on hover beside the reload button. The
     * snippet decides which rows get any; an empty render costs nothing.
     */
    actions?: Snippet<[TreeNode]>;
    depth?: number;
  }

  let {
    nodes,
    expanded,
    loading = NONE,
    errors = NO_ERRORS,
    ontoggle,
    onclick,
    onreload,
    icon,
    actions,
    depth = 0
  }: Props = $props();
</script>

<ul class="tree" class:nested={depth > 0}>
  {#each nodes as node (node.id)}
    {@const isLeaf = node.children === undefined}
    {@const isOpen = expanded.has(node.id)}
    {@const isLoading = loading.has(node.id)}
    {@const error = errors.get(node.id)}
    <li class="node" class:leaf={isLeaf}>
      {#if isLeaf}
        <div class="row">
          <button class="label" title={node.hint} onclick={() => onclick?.(node)}>
            <ChevronRight size={12} style="visibility: hidden;" />
            {#if icon}{@render icon(node)}{/if}
            <span class="node-label">{node.label}</span>
            {#if node.detail}
              <span class="node-detail meta">{node.detail}</span>
            {/if}
          </button>
          {#if actions}
            <span class="actions">{@render actions(node)}</span>
          {/if}
        </div>
      {:else}
        <div class="row">
          <button class="label" title={node.hint} onclick={() => ontoggle(node)}>
            {#if isLoading}
              <LoaderCircle size={12} class="spin" />
            {:else}
              <ChevronRight size={12} class={isOpen ? "toggle open" : "toggle"} />
            {/if}
            {#if icon}{@render icon(node)}{/if}
            <span class="node-label">{node.label}</span>
            {#if node.detail}
              <span class="node-detail meta">{node.detail}</span>
            {/if}
          </button>
          {#if actions}
            <span class="actions">{@render actions(node)}</span>
          {/if}
          {#if onreload && node.reloadable}
            <button
              class="reload"
              title="Reload"
              aria-label="Reload {node.label}"
              disabled={isLoading}
              onclick={() => onreload(node)}
            >
              <RefreshCw size={12} />
            </button>
          {/if}
        </div>
        {#if isOpen && error}
          <div class="node-error small warn">{error}</div>
        {/if}
        {#if isOpen && node.children && node.children.length > 0}
          <TreeView
            nodes={node.children}
            {expanded}
            {loading}
            {errors}
            {ontoggle}
            {onclick}
            {onreload}
            {icon}
            {actions}
            depth={depth + 1}
          />
        {/if}
      {/if}
    </li>
  {/each}
</ul>

<style>
  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .tree.nested {
    padding-left: 14px;
  }

  .node {
    margin: 0;
    padding: 0;
  }

  .row {
    display: flex;
    align-items: center;
    height: var(--h-tree);
    border-radius: var(--r);
  }

  .row:hover {
    background: var(--s2);
  }

  .label {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 8px;
    border: none;
    border-radius: var(--r);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  /* Icons are furniture until they mean something. */
  .row :global(svg) {
    flex: none;
    color: var(--fg-3);
  }

  .reload,
  .actions :global(button) {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 20px;
    height: 20px;
    margin-right: 4px;
    padding: 0;
    border: none;
    border-radius: var(--r-kbd);
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0;
  }

  .row:hover .reload,
  .reload:focus-visible {
    opacity: 1;
  }

  /* Same reveal as the reload button, and held while a menu one of them
     opened is up — the pointer is on the menu by then, not the row. */
  .actions {
    display: contents;
  }

  .actions :global(button) {
    opacity: 0;
  }

  .row:hover .actions :global(button),
  .actions :global(button:focus-visible),
  .actions :global(button[aria-pressed="true"]) {
    opacity: 1;
  }

  .reload:hover:enabled :global(svg),
  .actions :global(button:hover svg),
  .actions :global(button[aria-pressed="true"] svg) {
    color: var(--fg);
  }

  .reload:disabled {
    cursor: default;
  }

  .node-error {
    padding: 2px 8px 6px 46px;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .node-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .node-detail {
    flex: none;
    margin-left: auto;
    padding-left: 8px;
  }

  /* Scoped under the row: `.toggle` is too plain a name to own globally. */
  .label :global(.toggle) {
    transition: transform 0.12s ease;
  }

  .label :global(.toggle.open) {
    transform: rotate(90deg);
  }
</style>
