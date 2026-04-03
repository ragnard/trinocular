<script lang="ts">
  import type { Query } from "$lib/State.svelte";
  import { Table, fieldFromTypeSignature, convertValue } from "./table";
  import type { Schema, Selection, ValueConverter } from "./table/types";
  import type { Columns } from "$lib/trino";
  import Spinner from "./Spinner.svelte";

  interface Props {
    query: Query;
    selection?: Selection | null;
  }

  let { query, selection = $bindable(null) }: Props = $props();

  const toSchema = (columns?: Columns): Schema | undefined => {
    if (!columns) return undefined;
    return {
      fields: columns.map((col) => fieldFromTypeSignature(col.typeSignature, col.name, col.type))
    };
  };

  let schema = $derived(toSchema(query.schema));

  const valueConverter: ValueConverter = (value, field) => convertValue(value, field.dataType);
</script>

<div class="query">
  {#if query.error}
    <div class="message error">
      <span>Error: {query.error.message} ({query.error.errorCode})</span>
    </div>
  {:else if schema}
    <Table
      {schema}
      rows={query.data}
      {valueConverter}
      bind:selection
      --table-bg="var(--bg-0)"
      --table-header-bg="var(--bg-1)"
      --table-row-num-bg="var(--bg-1)"
      --table-selected-bg="var(--accent-bg)"
    >
      {#snippet header(field)}
        <div class="header">
          <div class="name" title={field.name}>{field.name}</div>
          <div class="type">{field.dataTypeName}</div>
        </div>
      {/snippet}
      {#snippet empty()}
        <div class="message">
          {#if query?.queryState == "FINISHED"}
            <div>No data</div>
          {:else}
            <Spinner />
            <div style="text-transform: capitalize;">{query?.queryState?.toLowerCase()} ...</div>
          {/if}
        </div>
      {/snippet}
    </Table>
  {:else}
    <div class="message loading">
      <Spinner />
      <div>Starting query...</div>
    </div>
  {/if}
</div>

<style>
  .query {
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .message {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 0.5em;

    > * {
      max-width: 50%;
    }
  }

  .header {
    padding: 0.4em 0.2em;
    flex-direction: column;

    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      text-transform: uppercase;
      font-size: 0.8em;
    }

    .type {
      font-size: 0.7em;
      color: var(--text-2);
    }
  }
</style>
