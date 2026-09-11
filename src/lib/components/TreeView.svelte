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
    loading?: boolean;
    /** Why the last attempt to fill `children` failed; drawn under the row while it is open. */
    error?: string;
    /** Offers the reload button. Only nodes whose children come from somewhere are. */
    reloadable?: boolean;
  }
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
    ontoggle: (node: TreeNode) => void;
    onclick?: (node: TreeNode) => void;
    onreload?: (node: TreeNode) => void;
    icon?: Snippet<[TreeNode]>;
    depth?: number;
  }

  let { nodes, expanded, ontoggle, onclick, onreload, icon, depth = 0 }: Props = $props();
</script>

<ul class="tree" class:nested={depth > 0}>
  {#each nodes as node (node.id)}
    {@const isLeaf = node.children === undefined}
    {@const isOpen = expanded.has(node.id)}
    <li class="node" class:leaf={isLeaf}>
      {#if isLeaf}
        <div class="row">
          <button class="label" title={node.hint} onclick={() => onclick?.(node)}>
            <ChevronRight size={12} style="visibility: hidden;" />
            {#if icon}{@render icon(node)}{/if}
            <span class="node-label">{node.label}</span>
            {#if node.detail}
              <span class="node-detail">{node.detail}</span>
            {/if}
          </button>
        </div>
      {:else}
        <div class="row">
          <button class="label" title={node.hint} onclick={() => ontoggle(node)}>
            {#if node.loading}
              <LoaderCircle size={12} class="spin" />
            {:else}
              <ChevronRight size={12} class={isOpen ? "toggle open" : "toggle"} />
            {/if}
            {#if icon}{@render icon(node)}{/if}
            <span class="node-label">{node.label}</span>
            {#if node.detail}
              <span class="node-detail">{node.detail}</span>
            {/if}
          </button>
          {#if onreload && node.reloadable}
            <button
              class="reload"
              title="Reload"
              aria-label="Reload {node.label}"
              disabled={node.loading}
              onclick={() => onreload(node)}
            >
              <RefreshCw size={12} />
            </button>
          {/if}
        </div>
        {#if isOpen && node.error}
          <div class="node-error">{node.error}</div>
        {/if}
        {#if isOpen && node.children && node.children.length > 0}
          <TreeView
            nodes={node.children}
            {expanded}
            {ontoggle}
            {onclick}
            {onreload}
            {icon}
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

  .reload {
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

  .reload:hover:enabled :global(svg) {
    color: var(--fg);
  }

  .reload:disabled {
    cursor: default;
  }

  .node-error {
    padding: 2px 8px 6px 46px;
    color: var(--error);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
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
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  :global(.toggle) {
    transition: transform 0.12s ease;
  }

  :global(.toggle.open) {
    transform: rotate(90deg);
  }
</style>
