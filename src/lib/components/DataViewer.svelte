<script lang="ts">
  import type { Selection, SelectionData, DataType, Field, Struct, List } from "./table/types";
  import type { Snippet } from "svelte";
  import { Copy, PanelRight, Search } from "@lucide/svelte";

  interface Props {
    selection?: Selection | null;
    hideNulls?: boolean;
    hideEmpty?: boolean;
    formatValue?: Snippet<[Field, any]>;
  }

  let {
    selection = null,
    hideNulls = true,
    hideEmpty = true,
    formatValue
  }: Props = $props();

  let data: SelectionData | null = $state.raw(null);

  $effect(() => {
    const sel = selection;
    if (!sel) {
      data = null;
      return;
    }
    const timeout = setTimeout(() => {
      data = sel.getData();
    }, 100);
    return () => clearTimeout(timeout);
  });

  interface FlatEntry {
    key: string;
    value: any;
    field: Field;
    empty?: boolean;
  }

  function isStruct(dt: DataType): dt is Struct {
    return typeof dt === "object" && !Array.isArray(dt) && "fields" in dt;
  }

  function isList(dt: DataType): dt is List {
    return Array.isArray(dt);
  }

  /** Structs and arrays become dotted paths, which is what makes a row read
      as a document rather than a handful of unopenable cells. */
  function flatten(value: any, field: Field, prefix: string): FlatEntry[] {
    const { dataType } = field;
    if (value === null || value === undefined) {
      return [{ key: prefix, value: null, field }];
    }
    if (isStruct(dataType) && Array.isArray(value)) {
      const entries = dataType.fields.flatMap((f, i) => {
        const key = prefix ? `${prefix}.${f.name}` : f.name;
        return flatten(value[i], f, key);
      });
      return entries.length ? entries : [{ key: prefix, value: "{}", field, empty: true }];
    }
    if (isList(dataType) && Array.isArray(value)) {
      if (value.length === 0) {
        return [{ key: prefix, value: "[]", field, empty: true }];
      }
      const elementField: Field = {
        name: "",
        dataType: dataType[0],
        dataTypeName: field.dataTypeName,
        nullable: true
      };
      return value.flatMap((element, i) => flatten(element, elementField, `${prefix}[${i + 1}]`));
    }
    return [{ key: prefix, value, field }];
  }

  /**
   * One filter, matched against field names and values alike. Two boxes
   * (Field / Value) cost a whole extra row of chrome for a distinction nobody
   * makes while scanning a document.
   */
  let filter = $state("");

  let documents: { row: number; entries: FlatEntry[] }[] = $derived.by(() => {
    if (!data || !selection) return [];
    const needle = filter.trim().toLowerCase();
    const firstRow = selection.minRow;
    return data.rows.map((row, i) => {
      let entries = data!.fields.flatMap((field, c) => flatten(row[c], field, field.name));
      if (hideNulls) entries = entries.filter((e) => e.value !== null);
      if (hideEmpty) entries = entries.filter((e) => !e.empty);
      if (needle) {
        entries = entries.filter(
          (e) =>
            e.key.toLowerCase().includes(needle) ||
            String(e.value).toLowerCase().includes(needle)
        );
      }
      return { row: firstRow + i + 1, entries };
    });
  });

  let fieldCount = $derived(documents[0]?.entries.length ?? 0);

  function text(value: any): string {
    if (value === null || value === undefined) return "null";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function copy(value: string) {
    void navigator.clipboard.writeText(value);
  }

  function copyDocument(entries: FlatEntry[]) {
    copy(JSON.stringify(Object.fromEntries(entries.map((e) => [e.key, e.value])), null, 2));
  }

  function copyAll() {
    copy(
      JSON.stringify(
        documents.map((d) => Object.fromEntries(d.entries.map((e) => [e.key, e.value]))),
        null,
        2
      )
    );
  }
</script>

<div class="inspector">
  <div class="rail">
    <PanelRight size={14} />
    <span class="ell title">
      {#if selection}
        {documents.length} rows &times; {fieldCount} fields
      {:else}
        Inspector
      {/if}
    </span>
    <button class="chip square" onclick={copyAll} disabled={!documents.length} title="Copy selection as JSON">
      <Copy size={14} />
    </button>
  </div>

  <div class="filter">
    <Search size={12} />
    <input type="text" placeholder="Filter fields&hellip;" bind:value={filter} spellcheck="false" />
  </div>

  <div class="stack">
    {#if !documents.length}
      <p class="empty">Select cells in the results to inspect them.</p>
    {/if}
    {#each documents as doc (doc.row)}
      <div class="doc-head">
        <span class="caps">Row {doc.row}</span>
        <span class="fill"></span>
        <button class="chip square" onclick={() => copyDocument(doc.entries)} title="Copy row as JSON">
          <Copy size={12} />
        </button>
      </div>
      {#each doc.entries as entry (entry.key)}
        <div class="field">
          <span class="key ell" title={entry.key}>{entry.key}</span>
          <span class="value mono" class:null={entry.value === null}>
            {#if formatValue}
              <svelte:boundary>
                {@render formatValue(entry.field, entry.value)}
                {#snippet failed(error)}<span class="null">{error}</span>{/snippet}
              </svelte:boundary>
            {:else}
              {text(entry.value)}
            {/if}
          </span>
          <button class="chip square copy" onclick={() => copy(text(entry.value))} title="Copy value">
            <Copy size={12} />
          </button>
        </div>
      {/each}
    {/each}
  </div>
</div>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--s1);
  }

  .rail {
    padding-right: 6px;
  }

  .title {
    flex: 1;
  }

  .rail :global(svg) {
    color: var(--fg-3);
  }

  .filter {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    height: var(--h-ctl);
    margin: 8px 12px 6px;
    padding: 0 8px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r);
    color: var(--fg-3);
  }

  .filter:focus-within {
    border-color: var(--accent);
  }

  .filter input {
    flex: 1;
    min-width: 0;
    height: auto;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--fg);
  }

  .filter input:focus-visible {
    outline: none;
  }

  .stack {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .empty {
    padding: 16px 12px;
    color: var(--fg-3);
  }

  /* Each selected row is its own document, headed by the row number the
     table shows, so a value can always be traced back to its row. */
  .doc-head {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    height: var(--h-ctl);
    padding: 0 6px 0 12px;
    background: var(--s2);
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }

  .caps {
    color: var(--fg-2);
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: 0.055em;
    text-transform: uppercase;
  }

  .fill {
    flex: 1;
  }

  .field {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr) var(--h-ctl);
    gap: 0 10px;
    align-items: start;
    padding: 6px 12px 6px 12px;
    border-bottom: 1px solid var(--line);
  }

  .key,
  .value {
    line-height: var(--leading);
  }

  .key {
    color: var(--fg-2);
  }

  .value {
    overflow-wrap: anywhere;
  }

  .value.null {
    color: var(--fg-3);
    font-style: italic;
  }

  .value :global(pre) {
    margin: 0;
    font: inherit;
    white-space: pre-wrap;
  }

  /* Revealed on hover so twenty fields are not twenty buttons. */
  .copy {
    visibility: hidden;
    align-self: center;
  }

  .field:hover .copy {
    visibility: visible;
  }
</style>
