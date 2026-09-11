<script lang="ts">
  /**
   * One glyph per kind of operator, so a card can be read by shape before
   * the names are. Kind is carried by icon rather than colour: the app has
   * one accent and it is spoken for.
   */
  import {
    ArrowDownUp,
    Box,
    Braces,
    Filter,
    ListEnd,
    Merge,
    Monitor,
    Network,
    Shuffle,
    Sigma,
    Table
  } from "@lucide/svelte";

  interface Props {
    name: string;
    size?: number;
  }

  let { name, size = 14 }: Props = $props();
</script>

{#if name === "TableScan" || name === "ScanProject" || name === "ScanFilterProject"}
  <Table {size} />
{:else if name === "Aggregate"}
  <Sigma {size} />
{:else if name === "Project"}
  <Braces {size} />
{:else if name === "Filter" || name === "FilterProject"}
  <Filter {size} />
{:else if name.endsWith("Join")}
  <Merge {size} />
{:else if name === "Sort" || name === "TopN"}
  <ArrowDownUp {size} />
{:else if name === "Limit" || name === "DistinctLimit"}
  <ListEnd {size} />
{:else if name === "LocalExchange" || name === "Exchange"}
  <Shuffle {size} />
{:else if name === "RemoteSource"}
  <Network {size} />
{:else if name === "Output"}
  <Monitor {size} />
{:else}
  <Box {size} />
{/if}
