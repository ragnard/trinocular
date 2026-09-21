<script lang="ts">
  import { isDictionary, isList, isStruct } from "./table/types";
  import { MARK, mark } from "$lib/perfMarks";
  import type { Selection, SelectionData, Field } from "./table/types";
  import { ChevronDown, ChevronUp, Copy, Eye, Maximize2, Search, X } from "@lucide/svelte";
  import Menu from "./Menu.svelte";
  import FilterBox from "./FilterBox.svelte";
  import {
    DEFAULT_FORMAT,
    formatsFor,
    render,
    resolveFormat,
    type Rendered,
    type ViewFormat
  } from "$lib/viewFormats";
  import { formatCount } from "$lib/format";
  import { textMeasurer } from "$lib/textWidth";
  import { tick } from "svelte";

  /** The key column's width, its own padding included: `.key` below. */
  const DEFAULT_KEY_WIDTH = 150;
  const MIN_KEY_WIDTH = 60;
  const KEY_PADDING = 7;
  /** What the value column is left at least, whatever the key is dragged to. */
  const MIN_VALUE_WIDTH = 160;
  const PAD = 12;

  interface Props {
    selection?: Selection | null;
    hideNulls?: boolean;
    hideEmpty?: boolean;
    /** How to draw each field, by its path. See `SqlFile.viewFormats`. */
    formats?: Record<string, string>;
    onpick?: (path: string, formatId: string) => void;
    /** Rows in the result the selection is of, for "of 3,500". */
    rowCount?: number;
    /**
     * Moves the selection by `delta` rows (±Infinity for either end), keeping
     * the anchor when `extend`. Given, the rail grows a navigator and the
     * arrow keys step; the selection itself stays the table's to own.
     */
    onstep?: (delta: number, extend: boolean) => void;
    /**
     * Full-window: the columns start at half the width each, the arrow keys
     * step wherever focus is, one row is shown at a time, and the filter takes
     * focus on open.
     */
    expanded?: boolean;
    /** Draws the chip that opens this pane full-window. */
    onexpand?: () => void;
    /** Draws the chip that closes it again. */
    onclose?: () => void;
  }

  let {
    selection = null,
    hideNulls = true,
    hideEmpty = true,
    formats = {},
    onpick,
    rowCount,
    onstep,
    expanded = false,
    onexpand,
    onclose
  }: Props = $props();

  let atFirst = $derived(!selection || selection.minRow === 0);
  let atLast = $derived(!selection || rowCount == null || selection.maxRow >= rowCount - 1);

  function handleKeydown(event: KeyboardEvent) {
    if (!onstep || !selection || event.altKey || event.ctrlKey || event.metaKey) return;
    const typing = event.target instanceof HTMLInputElement && event.target.value !== "";
    let delta: number;
    switch (event.key) {
      case "ArrowUp":
        delta = -1;
        break;
      case "ArrowDown":
        delta = 1;
        break;
      case "Home":
        if (typing) return;
        delta = -Infinity;
        break;
      case "End":
        if (typing) return;
        delta = Infinity;
        break;
      default:
        return;
    }
    event.preventDefault();
    onstep(delta, event.shiftKey && !expanded);
  }

  let fieldInput: FilterBox | undefined = $state();

  $effect(() => {
    if (expanded) void tick().then(() => fieldInput?.focus());
  });

  let stack: HTMLDivElement | undefined = $state();
  let stackWidth = $state(0);
  let pinnedKey: number | null = $state(null);
  let resizing = $state(false);

  const clampKey = (w: number) =>
    Math.max(MIN_KEY_WIDTH, Math.min(w, stackWidth - 2 * PAD - MIN_VALUE_WIDTH));

  /** Half the pane when expanded, until dragged; the pane then keeps it. */
  let keyWidth = $derived(
    pinnedKey ?? (expanded && stackWidth ? clampKey(stackWidth / 2) : DEFAULT_KEY_WIDTH)
  );

  function fitKey() {
    if (!stack) return;
    const measure = textMeasurer(stack);
    let width = 0;
    for (const doc of documents) {
      for (const entry of doc.entries) width = Math.max(width, measure(entry.key));
    }
    pinnedKey = clampKey(Math.ceil(width) + KEY_PADDING);
  }

  let lastHandlePress = 0;

  function handlePointerdown(event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();

    if (event.timeStamp - lastHandlePress < 400) {
      lastHandlePress = 0;
      fitKey();
      return;
    }
    lastHandlePress = event.timeStamp;

    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = keyWidth;
    resizing = true;

    const onPointermove = (e: PointerEvent) => {
      pinnedKey = clampKey(startWidth + e.clientX - startX);
    };
    const onPointerup = () => {
      resizing = false;
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener("pointermove", onPointermove);
      handle.removeEventListener("pointerup", onPointerup);
    };
    handle.addEventListener("pointermove", onPointermove);
    handle.addEventListener("pointerup", onPointerup);
  }

  let data: SelectionData | null = $state.raw(null);

  // A block is debounced because a drag changes it on every mousemove and it
  // can be hundreds of rows; one row is drawn as it is selected, or stepping
  // faster than the debounce would skip rows without ever showing them.
  $effect(() => {
    const sel = selection;
    if (!sel) {
      data = null;
      return;
    }
    if (sel.minRow === sel.maxRow) {
      data = sel.getData();
      return;
    }
    const timeout = setTimeout(() => {
      data = sel.getData();
    }, 100);
    return () => clearTimeout(timeout);
  });

  interface FlatEntry {
    /**
     * What the row list is keyed on: the column's index, then a field's
     * ordinal, an element's index or an entry's key at each level down. Not
     * `key`, which Trino does not keep unique — `SELECT 1 a, 2 a` is legal and
     * so is `row(a integer, a integer)` — and a keyed each throws on a repeat.
     */
    id: string;
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

  /** Structs, maps and arrays become dotted paths, which is what makes a row
      read as a document rather than a handful of unopenable cells. A map's
      entries read like a row's fields, and a view format picked for one is
      kept by key: the key is data rather than schema, but the same key in
      another row is far more likely the same kind of value than not. */
  function flatten(value: any, field: Field, id: string, key: string, path: string): FlatEntry[] {
    const { dataType } = field;
    if (value === null || value === undefined) {
      return [{ id, key, path, value: null, field }];
    }
    if (isStruct(dataType) && Array.isArray(value)) {
      const entries = dataType.fields.flatMap((f, i) =>
        flatten(
          value[i],
          f,
          `${id}.${i}`,
          key ? `${key}.${f.name}` : f.name,
          path ? `${path}.${f.name}` : f.name
        )
      );
      return entries.length ? entries : [{ id, key, path, value: "{}", field, empty: true }];
    }
    if (isList(dataType) && Array.isArray(value)) {
      if (value.length === 0) {
        return [{ id, key, path, value: "[]", field, empty: true }];
      }
      const elementField: Field = {
        name: "",
        dataType: dataType[0],
        dataTypeName: field.dataTypeName,
        nullable: true
      };
      return value.flatMap((element, i) =>
        flatten(element, elementField, `${id}[${i}]`, `${key}[${i + 1}]`, `${path}[]`)
      );
    }
    if (isDictionary(dataType) && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        return [{ id, key, path, value: "{}", field, empty: true }];
      }
      const valueField: Field = {
        name: "",
        dataType: dataType.value,
        dataTypeName: field.dataTypeName,
        nullable: true
      };
      return entries.flatMap(([k, v]) =>
        flatten(v, valueField, `${id}.${k}`, key ? `${key}.${k}` : k, path ? `${path}.${k}` : k)
      );
    }
    return [{ id, key, path, value, field }];
  }

  let fieldFilter = $state("");
  let valueFilter = $state("");

  /** A case-insensitive regex, or null for an empty box or one that will not
   *  compile — which is shown on the box, and filters nothing meanwhile. */
  function compile(source: string): RegExp | null {
    if (!source) return null;
    try {
      return new RegExp(source, "i");
    } catch {
      return null;
    }
  }

  let fieldPattern = $derived(compile(fieldFilter));
  let valuePattern = $derived(compile(valueFilter));
  let fieldInvalid = $derived(!!fieldFilter && !fieldPattern);
  let valueInvalid = $derived(!!valueFilter && !valuePattern);

  /** An entry with what the row will draw for it, which is also what the
   *  value filter reads: what you see is what you can search for. */
  type Entry = FlatEntry & { rendered: Rendered };

  let documents: { row: number; entries: Entry[] }[] = $derived.by(() => {
    if (!data || !selection) return [];
    const firstRow = selection.minRow;
    return data.rows.map((row, i) => {
      let flat = data!.fields.flatMap((field, c) =>
        flatten(row[c], field, String(c), field.name, field.name)
      );
      if (hideNulls) flat = flat.filter((e) => e.value !== null);
      if (hideEmpty) flat = flat.filter((e) => !e.empty);
      if (fieldPattern) flat = flat.filter((e) => fieldPattern.test(e.key));
      let entries = flat.map((e) => ({
        ...e,
        rendered: render(e.value, e.field, formatId(e))
      }));
      if (valuePattern) entries = entries.filter((e) => valuePattern.test(e.rendered.text));
      return { row: firstRow + i + 1, entries };
    });
  });

  let fieldCount = $derived(documents[0]?.entries.length ?? 0);

  $effect(() => {
    mark(MARK.inspectorRendered, { documents: documents.length, fields: fieldCount });
  });

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
  function copyValue(entry: Entry) {
    copy(entry.rendered.text);
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
</script>

<!-- Full-window there is nothing else to step, so the keys are the window's;
     in the pane they are only taken from inside it. -->
<svelte:window onkeydown={expanded ? handleKeydown : undefined} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="inspector"
  class:resizing
  style:--key="{keyWidth}px"
  onkeydown={expanded ? undefined : handleKeydown}
>
  <div class="rail">
    <Search size={14} />
    <span class="ell fill">
      {#if selection}
        {#if selection.minRow === selection.maxRow}
          Row {formatCount(selection.minRow + 1)}
        {:else}
          Rows {formatCount(selection.minRow + 1)}–{formatCount(selection.maxRow + 1)}
        {/if}
        {#if rowCount != null}of {formatCount(rowCount)}{/if}
        &middot; {fieldCount}
        {fieldCount === 1 ? "field" : "fields"}
      {:else}
        Inspector
      {/if}
    </span>
    {#if onstep}
      <button
        class="chip square"
        onclick={() => onstep(-1, false)}
        disabled={atFirst}
        title="Previous row (↑)"
      >
        <ChevronUp size={14} />
      </button>
      <button
        class="chip square"
        onclick={() => onstep(1, false)}
        disabled={atLast}
        title="Next row (↓)"
      >
        <ChevronDown size={14} />
      </button>
    {/if}
    {#if onexpand}
      <button
        class="chip square"
        onclick={onexpand}
        disabled={!selection}
        title="Open full window (Enter in the table)"
      >
        <Maximize2 size={14} />
      </button>
    {/if}
    {#if onclose}
      <button class="chip square" onclick={onclose} title="Close (Esc)">
        <X size={14} />
      </button>
    {/if}
  </div>

  <!-- The table's header, for the same reason: the separator is what says
       where the columns are, and its edge is the one place they are dragged.
       A second press within 400ms fits the keys. -->
  <div class="header">
    <span class="key">
      Field
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="resize-handle" onpointerdown={handlePointerdown}></span>
    </span>
    <span class="value">Value</span>
  </div>

  <div class="filters">
    <span class="key">
      <FilterBox
        bind:this={fieldInput}
        bind:value={fieldFilter}
        label="Filter fields"
        invalid={fieldInvalid}
        title={fieldInvalid ? "Not a valid regular expression" : "Regular expression"}
      />
    </span>
    <span class="value">
      <FilterBox
        bind:value={valueFilter}
        label="Filter values"
        invalid={valueInvalid}
        title={valueInvalid ? "Not a valid regular expression" : "Regular expression"}
      />
    </span>
  </div>

  <div
    class="stack"
    bind:this={stack}
    bind:clientWidth={stackWidth}
    onscroll={() => picker?.close()}
  >
    {#if !documents.length}
      <p class="empty">Select cells in the results to inspect them.</p>
    {/if}
    {#each documents as doc (doc.row)}
      <div class="doc-head">
        <span class="caps small">Row {doc.row}</span>
        <span class="fill"></span>
        <button
          class="chip square"
          onclick={() => copyDocument(doc.entries)}
          title="Copy row as JSON"
        >
          <Copy size={12} />
        </button>
      </div>
      {#each doc.entries as entry (entry.id)}
        {@const choices = formatsFor(entry.field)}
        {@const chosen = resolveFormat(entry.field, formatId(entry))}
        {@const { view } = entry.rendered}
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

  .stack {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .header,
  .filters,
  .field {
    display: grid;
    grid-template-columns: var(--key) minmax(0, 1fr);
    padding: 0 12px;
  }

  .header,
  .filters {
    flex: none;
    align-items: center;
    border-bottom: 1px solid var(--line-strong);
  }

  .header {
    height: var(--h-rail);
  }

  /* Tighter at the sides than the header, with the key track widened by the
     difference so the separator stays under the header's. */
  .filters {
    grid-template-columns: calc(var(--key) + 6px) minmax(0, 1fr);
    padding: 6px;
  }

  .header .key,
  .filters .key {
    position: relative;
    height: 100%;
    display: flex;
    align-items: center;
    border-right: 1px solid var(--line);
  }

  .header .key {
    color: var(--fg);
  }

  .filters .key {
    padding-right: 6px;
  }

  .filters .value {
    display: flex;
    padding-left: 6px;
  }

  .resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    touch-action: none;
  }

  .resize-handle:hover,
  .resizing .resize-handle {
    background: var(--accent-line);
  }

  .resizing {
    user-select: none;
    cursor: col-resize;
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
    font-weight: 600;
    letter-spacing: 0.055em;
    text-transform: uppercase;
  }

  .field {
    position: relative;
    align-items: start;
    padding-top: 6px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line);
  }

  .key,
  .value {
    line-height: var(--leading);
  }

  .key {
    padding-right: 6px;
    color: var(--fg-2);
  }

  .value {
    padding-left: 6px;
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

  /* Names what the buttons under it will write. Two of these when the field
     is an array element, which is the only thing telling the two groups
     apart. */
  .scope {
    margin: 0;
    padding: 4px 12px 2px;
  }
</style>
