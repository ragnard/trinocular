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
    onexpand?: (node: TreeNode) => void;
    onclick?: (node: TreeNode) => void;
    icon?: Snippet<[TreeNode]>;
    depth?: number;
  }

  let { nodes, onexpand, onclick, icon, depth = 0 }: Props = $props();

  let expanded = $state(new Set<string>());

  function toggle(node: TreeNode) {
    const next = new Set(expanded);
    if (next.has(node.id)) {
      next.delete(node.id);
    } else {
      next.add(node.id);
      onexpand?.(node);
    }
    expanded = next;
  }
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
        <button class="label branch-label" onclick={() => toggle(node)}>
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
            {onexpand}
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

  .tree :global(.tree) {
    padding-left: 0.75em;
  }

  .node {
    margin: 0;
    padding: 0;
  }

  .label {
    display: flex;
    align-items: center;
    gap: 0.25em;
    padding: 0.25em 0.25em;
    width: 100%;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-size: var(--font);
    text-align: left;
    border-radius: 3px;
    white-space: nowrap;

    :global(svg) {
      flex-shrink: 0;
    }
    /* overflow: hidden;
       text-overflow: ellipsis; */
  }

  .label:hover {
    background-color: var(--bg-focus);
  }

  .node-label {
    /* overflow: hidden;
       text-overflow: ellipsis; */
  }

  .node-detail {
    color: var(--text-2);
    font-size: var(--font-sm);
    margin-left: 0.25em;
    flex-shrink: 0;
  }

  :global(.toggle) {
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }

  :global(.toggle.open) {
    transform: rotate(90deg);
  }
</style>
