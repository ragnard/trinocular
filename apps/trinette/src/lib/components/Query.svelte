<script lang="ts">
  import type { Query } from "$lib/State.svelte";
  import Table from "./table/Table.svelte";
  import type { TableData } from "./table/Table.svelte";
  import type { Columns, QueryData } from "$lib/trino";

  interface Props {
    query: Query
  }

  let { query }: Props  = $props();

  const toData = (columns: Columns, rows: QueryData[]): TableData | undefined => {
    if (!columns || !rows) return undefined;

    return {
      schema: {
        fields: columns.map((col) => ({
          name: col.name,
          dataType: col.type as any,
          nullable: true,
        })),
      },
      data: rows,
    };
  }

  let data = $derived(query.schema && query.data ? toData(query.schema, query.data) : undefined);


</script>

<div class="bleh">
  <pre>{query.queryState}</pre>
  <pre>{JSON.stringify(query.latestStats?.progressPercentage, null, 2)}</pre>
  {#if query.error}
    <span>Error:  {query.error.message} ({query.error.errorCode})</span>
  {:else if data }
    <Table data={data}>
      {#snippet header(field)}
        <div class="header">
          <div class="name" title="{field.name}">{field.name}</div>
          <div class="type" title="{field.dataType}">{field.dataType}</div>
        </div>
      {/snippet}
    </Table>
  {/if}


</div>

<style>

 .bleh {
     height: 100%;
     overflow: hidden;
     display: flex;
     flex-direction: column;
 }

 .header {
     padding: 0.25em 0.15em;
     flex-direction: column;

     .name {
         overflow: hidden;
         text-overflow: ellipsis;
         text-transform: uppercase;
         font-size: 0.8em;
     }

     .type {
         font-size: 0.7em;
         color: gray;
     }
 }

 .bleh :global {
     font-family: 'Arial';


     th {
         /* background-color: pink;
            padding: 0.25em 0.15em; */
         /* border: 1px solid black; */
     }

     td {
         /*border-bottom: 1px solid #e0e0e0;*/
     }
 }

</style>
