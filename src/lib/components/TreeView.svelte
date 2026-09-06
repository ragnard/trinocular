<script lang="ts" module>
  import type { Snippet } from "svelte";

  export interface TreeNode {
    id: string;
    label: string;
    detail?: string;
    children?: TreeNode[];
    loading?: boolean;
  }
</script>

<script lang="ts">
  import { ChevronRight, LoaderCircle } from "@lucide/svelte";
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
    icon?: Snippet<[TreeNode]>;
    depth?: number;
  }

  let { nodes, expanded, ontoggle, onclick, icon, depth = 0 }: Props = $props();
</script>

<ul class="tree" class:nested={depth > 0}>
  {#each nodes as node (node.id)}
    {@const isLeaf = node.children === undefined}
    {@const isOpen = expanded.has(node.id)}
    <li class="node" class:leaf={isLeaf}>
      {#if isLeaf}
        <button class="label leaf-label" onclick={() => onclick?.(node)}>
          <ChevronRight size={12} style="visibility: hidden;" />
          {#if icon}{@render icon(node)}{/if}
          <span class="node-label">{node.label}</span>
          {#if node.detail}
            <span class="node-detail">{node.detail}</span>
          {/if}
        </button>
      {:else}
        <button class="label branch-label" onclick={() => ontoggle(node)}>
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
        {#if isOpen && node.children && node.children.length > 0}
          <TreeView
            nodes={node.children}
            {expanded}
            {ontoggle}
            {onclick}
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

  .label {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: var(--h-tree);
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

  .label:hover {
    background: var(--s2);
  }

  /* Icons are furniture until they mean something. */
  .label :global(svg) {
    flex: none;
    color: var(--fg-3);
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
