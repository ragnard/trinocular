<script lang="ts">
  import type { Selection, DataType, Field, Struct, List } from "./table/types";
  import type { Snippet } from "svelte";

  interface Props {
    selection?: Selection | null;
    hideNulls?: boolean;
    hideEmpty?: boolean;
    formatValue?: Snippet<[Field, any]>;
  }

  let { selection = null, hideNulls = true, hideEmpty = true, formatValue }: Props = $props();

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
      if (entries.length === 0) {
        return [{ key: prefix, value: "{}", field, empty: true }];
      }
      return entries;
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
      return value.flatMap((element, i) => {
        const key = `${prefix}[${i + 1}]`;
        return flatten(element, elementField, key);
      });
    }
    return [{ key: prefix, value, field }];
  }

  function flattenRow(row: any[], fields: Selection["fields"]): FlatEntry[] {
    return fields.flatMap((field, i) => flatten(row[i], field, field.name));
  }

  let filter = $state("");
  let valueFilter = $state("");
  let theadHeight = $state(0);

  let rows = $derived(
    selection
      ? selection.rows.map((row) => {
          let entries = flattenRow(row, selection.fields);
          if (hideNulls) entries = entries.filter((e) => e.value !== null);
          if (hideEmpty) entries = entries.filter((e) => !e.empty);
          if (filter)
            entries = entries.filter((e) => e.key.toLowerCase().includes(filter.toLowerCase()));
          if (valueFilter)
            entries = entries.filter((e) =>
              String(e.value).toLowerCase().includes(valueFilter.toLowerCase())
            );
          return entries;
        })
      : []
  );
</script>

<div class="data-viewer">
  {#if selection}
    <table>
      <thead bind:clientHeight={theadHeight}>
        <tr>
          <th>
            <div>
              <span>Field</span>
              <input type="text" placeholder="Filter..." bind:value={filter} />
            </div>
          </th>
          <th>
            <div>
              <span>Value</span>
              <input type="text" placeholder="Filter..." bind:value={valueFilter} />
            </div>
          </th>
        </tr>
      </thead>
      {#each rows as entries, ri}
        <tbody>
          {#if selection.rows.length > 1}
            <tr class="row-header" style:--thead-h="{theadHeight}px">
              <td colspan="2">Row {ri + 1}</td>
            </tr>
          {/if}
          {#each entries as entry}
            <tr>
              <td class="field" title={entry.key}>
                {entry.key}
                <div class="cell-actions">
                  <button title="Copy field name" onclick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(entry.key); }}>📋</button>
                </div>
              </td>
              <td class="value" class:null={entry.value === null}>
                {#if formatValue}
                  <svelte:boundary>
                    {@render formatValue(entry.field, entry.value)}

                    {#snippet failed(error, reset)}
                      <span>Err: {error}</span>
                    {/snippet}
                  </svelte:boundary>
                {:else if entry.value === null || entry.value === undefined}
                  <span>null</span>
                {:else}
                  <span>{entry.value}</span>
                {/if}
                <div class="cell-actions">
                  <button title="Copy value" onclick={(e) => {
                    e.stopPropagation();
                    const text = entry.value == null ? "null"
                      : typeof entry.value === "object" ? JSON.stringify(entry.value)
                      : String(entry.value);
                    navigator.clipboard.writeText(text);
                  }}>📋</button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      {/each}
    </table>
  {:else}
    <div class="placeholder">Select cells to inspect</div>
  {/if}
</div>

<style>
  .data-viewer {
    /* padding: 0.75em; */
    overflow: auto;
    height: 100%;
    font-size: 1em;
    padding-right: 1px;
  }

  table {
    width: 100%;
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
    /*border: 1px solid var(--border);*/
  }

  th {
    width: 50%;
    padding: 0.5em 0.5em;
    border-bottom: 1px solid var(--border-dark);
    text-align: left;
    background: var(--bg-0);
    position: sticky;
    top: 0;
    z-index: 2;
    font-size: var(--font-sm);
  }

  th div {
    display: flex;
    align-items: center;
    gap: 0.5em;
  }

  th input {
    flex: 1;
    min-width: 0;
    font-weight: normal;
  }

  td {
    padding: 0.5em 0.5em;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }

  /* tr:nth-child(even) {
    background: var(--bg-2, transparent);
    } */

  .row-header td {
    position: sticky;
    top: var(--thead-h, 0px);
    z-index: 1;
    background: var(--bg-0);
    font-weight: 600;
    font-size: 0.85em;
    color: var(--text-2);
    border-bottom: 1px solid var(--border-dark);
  }

  .field,
  .value {
    position: relative;
  }

  tr:not(.row-header) > td.field:hover,
  tr:not(.row-header) > td.value:hover {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .cell-actions {
    display: none;
    position: absolute;
    top: 2px;
    right: 2px;
    z-index: 3;
    gap: 2px;
    background: color-mix(in srgb, var(--bg-0) 85%, transparent);
    padding: 1px;
    border-radius: 3px;
  }

  td.field:hover .cell-actions,
  td.value:hover .cell-actions {
    display: flex;
  }

  .cell-actions button {
    all: unset;
    cursor: pointer;
    font-size: 0.75em;
    line-height: 1;
    padding: 3px 3px;
    border-radius: 3px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    opacity: 0.8;
  }

  .cell-actions button:hover {
    opacity: 1;
    background: var(--accent-bg);
    border-color: var(--accent);
  }

  .field {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-2);
    border-right: 1px solid var(--border);
    /* font-size: 0.8em;
      padding: 0.em 0.7em; */
  }

  .value {
    word-break: break-all;
  }

  .null {
    color: var(--text-2);
    font-style: italic;
  }

  .placeholder {
    color: var(--text-2);
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
  }
</style>
