<script lang="ts">
  import type { Selection } from "./table/Table.svelte";
  import ValueNode from "./ValueNode.svelte";

  interface Props {
    selection?: Selection | null;
  }

  let { selection = null }: Props = $props();
</script>

<div class="data-viewer">
  {#if selection}
    <div class="summary">
      {selection.rows.length} row{selection.rows.length !== 1 ? "s" : ""},
      {selection.fields.length} column{selection.fields.length !== 1 ? "s" : ""}
    </div>
    <div class="rows">
      {#each selection.rows as row, ri}
        <div class="row">
          {#if selection.rows.length > 1}
            <div class="row-header">Row {ri + 1}</div>
          {/if}
          {#each row as cell, ci}
            <ValueNode
              value={cell}
              dataType={selection.fields[ci].dataType}
              label={selection.fields[ci].name}
            />
          {/each}
        </div>
      {/each}
    </div>
  {:else}
    <div class="placeholder">Select cells to inspect</div>
  {/if}
</div>

<style>
  .data-viewer {
    padding: 0.75em;
    overflow: auto;
    height: 100%;
    font-size: 0.85em;
  }

  .summary {
    font-weight: 600;
    margin-bottom: 0.5em;
    color: var(--text-2);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
  }

  .row {
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0.35em 0.5em;
  }

  .row-header {
    font-weight: 600;
    font-size: 0.85em;
    color: var(--text-2);
    margin-bottom: 0.25em;
  }

  .placeholder {
    color: var(--text-2);
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
  }
</style>
