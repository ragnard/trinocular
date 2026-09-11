<script lang="ts">
  /**
   * One fragment as a card: its operators as rows, children above their
   * parent, so the card reads top to bottom in the order data moves and ends
   * on the operator whose output leaves the fragment. That is also where the
   * card's outgoing edge starts, and every `RemoteSource` row carries the
   * target for the edge coming in from the fragment it reads — Svelte Flow
   * measures a handle where it sits in the markup, so an edge lands on the
   * row that consumes it rather than on the card.
   */
  import { Handle, Position, type NodeProps } from "@xyflow/svelte";
  import { getContext } from "svelte";
  import type { Fragment } from "$lib/plan/fragments";
  import { rowsEstimate, summarize } from "$lib/plan/fragments";
  import PlanNodeIcon from "./PlanNodeIcon.svelte";
  import { PLAN_SELECTION, type PlanSelection } from "./selection.svelte";

  let { data }: NodeProps & { data: { fragment: Fragment } } = $props();

  const selection = getContext<PlanSelection>(PLAN_SELECTION);
  let fragment = $derived(data.fragment);
  let last = $derived(fragment.rows.length - 1);

  function format(rows: number): string {
    return `${rows.toLocaleString()} rows`;
  }
</script>

<div class="fragment">
  <div class="head">
    <span class="name">Fragment {fragment.id}</span>
    <span class="fill"></span>
    <span class="meta">{fragment.rows.length} nodes</span>
  </div>
  {#each fragment.rows as { node, depth }, i (node.id)}
    {@const rows = rowsEstimate(node)}
    <div
      class="row"
      class:selected={selection.id === node.id}
      style:padding-left="{12 + depth * 14}px"
      role="button"
      tabindex="0"
      onclick={() => selection.select(node, fragment.id)}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") selection.select(node, fragment.id);
      }}
    >
      <span class="icon"><PlanNodeIcon name={node.name} /></span>
      <span class="ell">{node.name}</span>
      <span class="fill"></span>
      <span class="meta ell mono">{rows !== undefined ? format(rows) : summarize(node)}</span>
      {#if node.name === "RemoteSource"}
        <Handle type="target" position={Position.Left} id="in-{node.id}" isConnectable={false} />
      {/if}
      {#if i === last}
        <Handle type="source" position={Position.Right} id="out" isConnectable={false} />
      {/if}
    </div>
  {/each}
</div>

<style>
  .fragment {
    width: 260px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r);
    background: var(--s1);
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--h-tree);
    padding: 0 12px;
    border-bottom: 1px solid var(--line);
    background: var(--s2);
  }

  .name {
    font-weight: 600;
  }

  .fill {
    flex: 1;
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--h-row);
    padding-right: 12px;
    cursor: pointer;
  }

  .row:hover {
    background: var(--s2);
  }

  .row.selected {
    background: var(--accent-bg);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .icon {
    display: inline-flex;
    flex: none;
    color: var(--fg-3);
  }

  .row.selected .icon {
    color: var(--accent);
  }

  .row .meta {
    max-width: 55%;
  }

  /* The handles exist to be measured, not seen: the edge already says
     where it goes. Not `display: none`, which would unmeasure them. */
  .row :global(.svelte-flow__handle) {
    opacity: 0;
    width: 1px;
    height: 1px;
    min-width: 0;
    min-height: 0;
  }
</style>
