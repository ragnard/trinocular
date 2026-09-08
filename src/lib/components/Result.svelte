<script lang="ts">
  import type { Result as ResultModel } from "$lib/State.svelte";
  import { Table, fieldFromTypeSignature, convertValue } from "./table";
  import type { Schema, Selection, ValueConverter } from "./table/types";
  import type { Columns } from "$lib/trino";
  import { abbreviateType } from "$lib/trino/typeString";
  import Spinner from "./Spinner.svelte";
  import { PanelRight, TriangleAlert } from "@lucide/svelte";

  interface Props {
    result: ResultModel | null;
    selection?: Selection | null;
    inspectorOpen: boolean;
    onToggleInspector: () => void;
  }

  let { result, selection = $bindable(null), inspectorOpen, onToggleInspector }: Props = $props();

  const toSchema = (columns?: Columns): Schema | undefined =>
    columns && {
      fields: columns.map((col) => fieldFromTypeSignature(col.typeSignature, col.name, col.type))
    };

  let schema = $derived(toSchema(result?.schema));

  const valueConverter: ValueConverter = (value, field) => convertValue(value, field.dataType);
</script>

<div class="result">
  <!-- The results pane had no header at all, so the editor and the table just
       butt together. This is the shoulder that split was missing. -->
  <div class="rail">
    {#if result}
      <span class="dot" class:failed={!!result.error} class:running={result.running}></span>
      <span>{result.rowCount ?? 0} rows</span>
      <span class="sep">&middot;</span>
      <span class="soft">{result.elapsedTimeSeconds} s</span>
    {:else}
      <span class="soft">No result</span>
    {/if}
    <span class="fill"></span>
    <button
      class="chip"
      aria-pressed={inspectorOpen}
      onclick={onToggleInspector}
      title="Inspect the selection"
    >
      <PanelRight size={14} />
      Inspector
      <kbd>&#8984;I</kbd>
    </button>
  </div>

  {#if !result}
    <div class="message">Run a statement to see results here</div>
  {:else if result.error}
    <div class="message failed">
      <TriangleAlert size={20} />
      <p>{result.error.message}</p>
      <p class="meta">{result.error.errorName} &middot; {result.error.errorCode}</p>
    </div>
  {:else if schema}
    <Table {schema} rows={result.data} {valueConverter} bind:selection>
      {#snippet header(field)}
        <!-- Name over type: a column is routinely named far wider than
             anything in it, and stacking buys those characters back without
             paying for them in table width. The type is abbreviated the way
             the schema browser abbreviates it — a nested row's full text runs
             to hundreds of characters, and a header two lines tall has even
             less room for it than a tree does. The whole thing stays on the
             hover title. -->
        <div class="col" title="{field.name} — {field.dataTypeName}">
          <div class="ell name">{field.name}</div>
          <div class="ell type">{abbreviateType(field.dataTypeName)}</div>
        </div>
      {/snippet}
      {#snippet empty()}
        <div class="message">
          {#if result?.queryState === "FINISHED"}
            No data
          {:else}
            <Spinner />
            <span class="soft">{result?.queryState?.toLowerCase() ?? "starting"}&hellip;</span>
          {/if}
        </div>
      {/snippet}
    </Table>
  {:else}
    <div class="message">
      <Spinner />
      <span class="soft">Starting query&hellip;</span>
    </div>
  {/if}
</div>

<style>
  .result {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--s0);
  }

  .fill {
    flex: 1;
  }

  .sep {
    color: var(--fg-3);
  }

  .soft {
    color: var(--fg-2);
  }

  /* Three states, one shape: idle, running, failed. */
  .dot {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--ok);
  }

  .dot.running {
    background: var(--accent);
  }

  .dot.failed {
    background: var(--error);
  }

  .message {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    color: var(--fg-3);
    text-align: center;
  }

  .message.failed {
    color: var(--error);
  }

  .message p {
    max-width: 46em;
  }

  .col .name {
    color: var(--fg);
  }

  .col .type {
    color: var(--fg-3);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }
</style>
