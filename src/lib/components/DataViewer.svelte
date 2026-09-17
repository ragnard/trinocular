<script lang="ts">
  import type {
    Selection,
    SelectionData,
    DataType,
    Field,
    Struct,
    List,
    Dictionary
  } from "./table/types";
  import { Copy, Eye, Search } from "@lucide/svelte";
  import FilterBox from "./FilterBox.svelte";
  import Menu from "./Menu.svelte";
  import {
    DEFAULT_FORMAT,
    formatsFor,
    render,
    resolveFormat,
    type ViewFormat
  } from "$lib/viewFormats";

  interface Props {
    selection?: Selection | null;
    hideNulls?: boolean;
    hideEmpty?: boolean;
    /** How to draw each field, by its path. See `SqlFile.viewFormats`. */
    formats?: Record<string, string>;
    onpick?: (path: string, formatId: string) => void;
  }

  let {
    selection = null,
    hideNulls = true,
    hideEmpty = true,
    formats = {},
    onpick
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
    /**
     * What the field is called on screen, and what a view format is normally
     * remembered against: `items[3].meta`, indices and all. A varchar array
     * can hold a JSON document in one element and a sentence in the next, so
     * the index is part of what was picked.
     */
    key: string;
    /**
     * The same path with its array indices dropped — `items[].meta` — which is
     * the other thing the picker can write, for an array whose elements do
     * agree. It is built here rather than read back out of `key`, because
     * `flatten` is the only thing that knows which brackets it put there.
     * Equal to `key` when nothing along the way was an array element, and that
     * is exactly the test for whether there is a second choice to offer.
     */
    path: string;
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

  function isDictionary(dt: DataType): dt is Dictionary {
    return typeof dt === "object" && !Array.isArray(dt) && "key" in dt;
  }

  /** Structs, maps and arrays become dotted paths, which is what makes a row
      read as a document rather than a handful of unopenable cells. A map's
      entries read like a row's fields, and a view format picked for one is
      kept by key: the key is data rather than schema, but the same key in
      another row is far more likely the same kind of value than not. */
  function flatten(value: any, field: Field, key: string, path: string): FlatEntry[] {
    const { dataType } = field;
    if (value === null || value === undefined) {
      return [{ key, path, value: null, field }];
    }
    if (isStruct(dataType) && Array.isArray(value)) {
      const entries = dataType.fields.flatMap((f, i) =>
        flatten(value[i], f, key ? `${key}.${f.name}` : f.name, path ? `${path}.${f.name}` : f.name)
      );
      return entries.length ? entries : [{ key, path, value: "{}", field, empty: true }];
    }
    if (isList(dataType) && Array.isArray(value)) {
      if (value.length === 0) {
        return [{ key, path, value: "[]", field, empty: true }];
      }
      const elementField: Field = {
        name: "",
        dataType: dataType[0],
        dataTypeName: field.dataTypeName,
        nullable: true
      };
      return value.flatMap((element, i) =>
        flatten(element, elementField, `${key}[${i + 1}]`, `${path}[]`)
      );
    }
    if (isDictionary(dataType) && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        return [{ key, path, value: "{}", field, empty: true }];
      }
      const valueField: Field = {
        name: "",
        dataType: dataType.value,
        dataTypeName: field.dataTypeName,
        nullable: true
      };
      return entries.flatMap(([k, v]) =>
        flatten(v, valueField, key ? `${key}.${k}` : k, path ? `${path}.${k}` : k)
      );
    }
    return [{ key, path, value, field }];
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
      let entries = data!.fields.flatMap((field, c) =>
        flatten(row[c], field, field.name, field.name)
      );
      if (hideNulls) entries = entries.filter((e) => e.value !== null);
      if (hideEmpty) entries = entries.filter((e) => !e.empty);
      if (needle) {
        entries = entries.filter(
          (e) =>
            e.key.toLowerCase().includes(needle) || String(e.value).toLowerCase().includes(needle)
        );
      }
      return { row: firstRow + i + 1, entries };
    });
  });

  let fieldCount = $derived(documents[0]?.entries.length ?? 0);

  /**
   * The picker: one menu for the whole pane, pointed at by every row's button.
   * A `Dropdown` per field would put a popover element behind every row of
   * every selected document, and only one of them can ever be open.
   */
  const menuId = $props.id();
  let picker: ReturnType<typeof Menu> | undefined = $state();
  let picking: FlatEntry | null = $state.raw(null);
  let anchor: HTMLElement | null = $state(null);

  // Runs before the button's own `popovertarget` toggle, so the menu is placed
  // against the right row and drawn with the right field's formats.
  function startPick(entry: FlatEntry, button: HTMLElement) {
    picking = entry;
    anchor = button;
  }

  /**
   * `path` is either the element's own (`items[3]`) or its array's
   * (`items[]`); the menu offers both, and the element wins when both are set.
   */
  function pick(format: ViewFormat, path: string) {
    onpick?.(path, format.id);
  }

  /** The element's own choice, or failing that its array's. */
  const formatId = (entry: FlatEntry) => formats[entry.key] ?? formats[entry.path];

  function copy(value: string) {
    void navigator.clipboard.writeText(value);
  }

  /** What the row shows, in full: the cap is on the screen, not on the value. */
  function copyValue(entry: FlatEntry) {
    copy(render(entry.value, entry.field, formatId(entry)).text);
  }

  /**
   * A document and a whole selection copy the values Trino sent, not the ones
   * the pane drew. A view choice says how to read a field here; it has no
   * business deciding what lands in somebody's clipboard as JSON — the same
   * line `export.ts` draws.
   */
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
    <Search size={14} />
    <span class="ell title">
      {#if selection}
        {documents.length} rows &times; {fieldCount} fields
      {:else}
        Inspector
      {/if}
    </span>
    <button
      class="chip square"
      onclick={copyAll}
      disabled={!documents.length}
      title="Copy selection as JSON"
    >
      <Copy size={14} />
    </button>
  </div>

  <FilterBox bind:value={filter} placeholder="Filter fields…" label="Filter fields" />

  <div class="stack" onscroll={() => picker?.close()}>
    {#if !documents.length}
      <p class="empty">Select cells in the results to inspect them.</p>
    {/if}
    {#each documents as doc (doc.row)}
      <div class="doc-head">
        <span class="caps">Row {doc.row}</span>
        <span class="fill"></span>
        <button
          class="chip square"
          onclick={() => copyDocument(doc.entries)}
          title="Copy row as JSON"
        >
          <Copy size={12} />
        </button>
      </div>
      {#each doc.entries as entry (entry.key)}
        {@const choices = formatsFor(entry.field)}
        {@const chosen = resolveFormat(entry.field, formatId(entry))}
        {@const { view } = render(entry.value, entry.field, formatId(entry))}
        <div class="field">
          <span class="key ell" title={entry.key}>{entry.key}</span>
          <!-- Whatever the format drew: text with its own cap, a frame, an
               image. This row does not know which, and does not need to. -->
          <div class="value" class:null={entry.value === null}>
            <view.component {...view.props} title={entry.key} />
          </div>
          <div class="controls">
            {#if choices.length > 1}
              <button
                class="chip square pick"
                class:set={chosen.id !== DEFAULT_FORMAT}
                popovertarget={menuId}
                onclick={(e) => startPick(entry, e.currentTarget)}
                title={`Show "${entry.key}" as… (${chosen.label})`}
              >
                <Eye size={12} />
              </button>
            {/if}
            <button class="chip square copy" onclick={() => copyValue(entry)} title="Copy value">
              <Copy size={12} />
            </button>
          </div>
        </div>
      {/each}
    {/each}
  </div>
</div>

<!-- One menu, shared. `picking` is whichever row's button last opened it. -->
<Menu bind:this={picker} id={menuId} {anchor}>
  {#snippet menu()}
    {#if picking}
      <!-- Held in a const because the buttons' handlers outlive the narrowing
           that `{#if picking}` gives the expressions around them. -->
      {@const entry = picking}
      {@const choices = formatsFor(entry.field)}
      {@const chosen = resolveFormat(entry.field, formatId(entry))}
      {@const everyId = formats[entry.path]}
      <p class="scope meta ell" title={entry.key}>{entry.key}</p>
      {#each choices as format (format.id)}
        <button class:selected={format === chosen} onclick={() => pick(format, entry.key)}>
          {format.label}
        </button>
      {/each}
      <!-- An array whose elements do agree, for the case where clicking down
           two hundred of them is not an answer. Only offered when there is an
           index to drop: for a plain column the two paths are one path. -->
      {#if entry.path !== entry.key}
        <div class="separator"></div>
        <p class="scope meta ell" title={entry.path}>every {entry.path}</p>
        {#each choices as format (format.id)}
          <button class:selected={everyId === format.id} onclick={() => pick(format, entry.path)}>
            {format.label}
          </button>
        {/each}
      {/if}
    {/if}
  {/snippet}
</Menu>

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
    position: relative;
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
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

  /* Over the value's top-right corner rather than in a column of their own:
     a column cost every row 58px of width for two buttons that are only
     there on hover. Up where the field's name is, not beside the middle of
     it — a value can be two hundred lines tall. Each button carries the
     pane's surface so the text under it is covered rather than overprinted,
     and a hidden button hides its surface with it, so the one that stays
     lit (below) masks its own 24px and nothing more. */
  .controls {
    position: absolute;
    top: 4px;
    right: 8px;
    display: flex;
  }

  .controls .chip {
    background: var(--s1);
  }

  .controls .chip:hover {
    background: var(--s2);
  }

  /* Revealed on hover so twenty fields are not forty buttons — except a picker
     that has been used, which stays lit: it is the only thing on screen saying
     this field is not being shown the way the others are, and the only way
     back. */
  .pick,
  .copy {
    visibility: hidden;
  }

  .field:hover .pick,
  .field:hover .copy {
    visibility: visible;
  }

  .pick.set {
    visibility: visible;
    color: var(--accent);
  }

  /* The menu around these rows belongs to `Menu`, so what the rows say about
     themselves is all this component can style. */
  .selected {
    color: var(--accent);
  }

  /* Names what the buttons under it will write. Two of these when the field
     is an array element, which is the only thing telling the two groups
     apart. */
  .scope {
    margin: 0;
    padding: 4px 12px 2px;
  }
</style>
