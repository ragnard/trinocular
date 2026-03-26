<script lang="ts">
  import type { Selection } from "./table/Table.svelte";

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
    <div class="fields">
      {#each selection.fields as field}
        <div class="field">
          <span class="field-name">{field.name}</span>
          <span class="field-type">{typeof field.dataType === "string" ? field.dataType : "struct"}</span>
        </div>
      {/each}
    </div>
    <div class="rows">
      {#each selection.rows as row, ri}
        <div class="row">
          {#each row as cell, ci}
            <div class="cell">
              <span class="cell-label">{selection.fields[ci].name}</span>
              <span class="cell-value">{cell ?? "null"}</span>
            </div>
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

  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25em;
    margin-bottom: 0.75em;
  }

  .field {
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0.15em 0.4em;
    font-size: 0.85em;
  }

  .field-name {
    font-weight: 600;
  }

  .field-type {
    color: var(--text-2);
    margin-left: 0.3em;
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

  .cell {
    display: flex;
    gap: 0.5em;
    padding: 0.1em 0;
  }

  .cell-label {
    color: var(--text-2);
    min-width: 6em;
    flex-shrink: 0;
  }

  .cell-value {
    word-break: break-all;
  }

  .placeholder {
    color: var(--text-2);
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
  }
</style>
