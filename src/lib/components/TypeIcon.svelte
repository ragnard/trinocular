<script lang="ts">
  /**
   * One icon per type category, shared by the schema browser's tree and the
   * results table's header so that a `row` column looks the same in both
   * places — the icon is the only thing carrying the type in the header, so it
   * had better be the vocabulary you already learned from the drawer.
   */
  import type { TypeCategory } from "$lib/trino/typeString";
  import {
    Binary,
    Braces,
    Brackets,
    Clock,
    Hash,
    Parentheses,
    ToggleLeft,
    Type
  } from "@lucide/svelte";

  interface Props {
    category: TypeCategory;
    size?: number;
  }

  let { category, size = 14 }: Props = $props();
</script>

{#if category === "row"}
  <Braces {size} />
{:else if category === "array"}
  <Brackets {size} />
{:else if category === "map"}
  <Parentheses {size} />
{:else if category === "numeric"}
  <Hash {size} />
{:else if category === "temporal"}
  <Clock {size} />
{:else if category === "binary"}
  <Binary {size} />
{:else if category === "boolean"}
  <ToggleLeft {size} />
{:else}
  <Type {size} />
{/if}
