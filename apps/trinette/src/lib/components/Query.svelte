<script lang="ts">
  import type { Query } from "$lib/State.svelte";
  import Table from "./table/Table.svelte";
  import type { TableData, Selection } from "./table/Table.svelte";
  import type { Columns, QueryData } from "$lib/trino";
  import { fieldFromTypeSignature } from "./table/types";
  import Spinner from "./Spinner.svelte";

  interface Props {
    query: Query;
    selection?: Selection | null;
  }

  let { query, selection = $bindable(null) }: Props = $props();

  const toData = (columns: Columns, rows: QueryData[]): TableData | undefined => {
    if (!columns || !rows) return undefined;

    return {
      schema: {
        fields: columns.map((col) => fieldFromTypeSignature(col.typeSignature, col.name, col.type))
      },
      data: rows
    };
  };

  let data = $derived(query.schema && query.data ? toData(query.schema, query.data) : undefined);
</script>

<div class="query">
  {#if query.error}
    <div class="message error">
      <span>Error: {query.error.message} ({query.error.errorCode})</span>
    </div>
  {:else if data}
    <Table {data} bind:selection>
      {#snippet header(field)}
        <div class="header">
          <div class="name" title={field.name}>{field.name}</div>
          <div class="type">{field.dataTypeName}</div>
        </div>
      {/snippet}
      {#snippet empty()}
        <div class="message">
          <Spinner />
          <div>Running query...</div>
        </div>
      {/snippet}
    </Table>
  {:else}
    <div class="message loading">
      <Spinner />
      <div>Starting query...</div>
    </div>
  {/if}
  <div class="status">
    <span
      >Status: <a href={query.infoUri} target="_blank" title="Click to view query in Trino UI"
        >{query.queryState}</a
      ></span
    >
  </div>
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

  .status {
    display: flex;
    flex-direction: row;
    padding: 0.5em 1em;
    border-top: 1px solid var(--border);
    background-color: var(--bg-0);
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

  .query :global {
    th {
    }

    td {
    }
  }
</style>
