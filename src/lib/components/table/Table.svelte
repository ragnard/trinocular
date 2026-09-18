<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import type {
    Field,
    DataType,
    Schema,
    Selection,
    CellRendererLookup,
    RowSource,
    ValueConverter
  } from "./types";
  import { defaultCell, formatCell } from "./snippets.svelte";
  import { textMeasurer } from "$lib/textWidth";

  /** `--h-row` and `--h-rail` in style.css: the virtual scroll needs the
   *  numbers, so they are repeated here rather than read off the stylesheet.
   *  The header is a rail, like every other pane header in the app. */
  const DEFAULT_ROW_HEIGHT = 30;
  const HEADER_HEIGHT = 36;
  const DEFAULT_BUFFER_ROWS = 5;
  const DEFAULT_COLUMN_WIDTH = 150;
  const MIN_COLUMN_WIDTH = 50;
  const MAX_COLUMN_WIDTH = 400;
  const FIT_MAX_WIDTH = 1200;
  const SAMPLE_ROWS = 200;
  const FIT_ROWS = 5000;
  /** 12px padding a side, the header's 1px rule, and a pixel for rounding. */
  const CELL_PADDING = 26;
  /** The caller's header puts a 14px type icon and a 6px gap beside the name. */
  const HEADER_EXTRA = 20;
  const DEFAULT_SPACER_MIN_WIDTH = 100;
  const ROW_NUMBER_WIDTH = 52;

  const identity: ValueConverter = (value) => value;

  interface Props {
    schema?: Schema;
    rows?: RowSource;
    rowHeight?: number;
    bufferRows?: number;
    spacerMinWidth?: number;
    header?: Snippet<[Field]>;
    empty?: Snippet;
    cellRenderer?: CellRendererLookup;
    valueConverter?: ValueConverter;
    selection?: Selection | null;
    /**
     * What a copy of the selection puts on the clipboard, given the selected
     * fields and the rows as they were handed in — not converted, since a
     * value converted to be drawn is the wrong one to paste. Without it the
     * browser's own copy stands.
     */
    clipboardText?: (fields: Field[], rows: readonly (readonly unknown[])[]) => string;
    /** Enter on a selection: the caller's chance to open it somewhere bigger. */
    onopen?: () => void;
  }

  let {
    schema,
    rows,
    rowHeight = DEFAULT_ROW_HEIGHT,
    bufferRows = DEFAULT_BUFFER_ROWS,
    spacerMinWidth = DEFAULT_SPACER_MIN_WIDTH,
    header,
    empty,
    cellRenderer: cellRendererProp,
    valueConverter = identity,
    selection = $bindable(null),
    clipboardText,
    onopen
  }: Props = $props();

  let scrollContainer: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let containerHeight = $state(0);
  let containerWidth = $state(0);
  /** Content widths measured from the first rows; `pinned` is where a column
   *  the user has sized stands instead, and takes no share of the slack. */
  let measured: number[] = $state([]);
  let pinned: (number | null)[] = $state([]);
  let sampled = $state(-1);
  let resizing = $state(false);
  let dragging = $state(false);

  let totalRows = $derived(rows?.length ?? 0);
  let fieldCount = $derived(schema?.fields?.length ?? 0);
  let colCount = $derived(fieldCount + 2);

  let layout = $derived.by(() => {
    const widths = Array.from(
      { length: fieldCount },
      (_, i) => pinned[i] ?? measured[i] ?? DEFAULT_COLUMN_WIDTH
    );
    const flex = widths.flatMap((_, i) => (pinned[i] == null ? [i] : []));
    const flexTotal = flex.reduce((sum, i) => sum + widths[i], 0);
    const slack = containerWidth - ROW_NUMBER_WIDTH - widths.reduce((sum, w) => sum + w, 0);
    if (slack <= 0 || flexTotal === 0) return { widths, filled: false };
    let given = 0;
    for (const i of flex) {
      const share = Math.floor((slack * widths[i]) / flexTotal);
      widths[i] += share;
      given += share;
    }
    widths[flex[flex.length - 1]] += slack - given;
    return { widths, filled: true };
  });
  let columnWidths = $derived(layout.widths);
  let columnsWidth = $derived(ROW_NUMBER_WIDTH + columnWidths.reduce((sum, w) => sum + w, 0));

  const defaultCellRenderer: CellRendererLookup = () => defaultCell;
  let cellRenderer = $derived(cellRendererProp ?? defaultCellRenderer);
  let resolvedRenderers = $derived(schema?.fields?.map((f) => cellRenderer(f)) ?? []);
  // Every numeric Trino type maps to "integer" (see trino/table.ts).
  let numeric = $derived(schema?.fields?.map((f) => f.dataType === "integer") ?? []);

  let startIndex = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - bufferRows));
  let endIndex = $derived(
    Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / rowHeight) + bufferRows)
  );
  let visibleRows = $derived(rows?.slice(startIndex, endIndex) ?? []);
  let offsetY = $derived(startIndex * rowHeight);
  let bottomSpacerHeight = $derived((totalRows - endIndex) * rowHeight);

  // --- Cell selection state ---
  interface CellCoord {
    row: number;
    col: number;
  }

  let anchor: CellCoord | null = $state(null);
  let active: CellCoord | null = $state(null);
  let rowSelection = $state(false);

  let selectionRect = $derived.by(() => {
    if (!anchor || !active) return null;
    return {
      minRow: Math.min(anchor.row, active.row),
      maxRow: Math.max(anchor.row, active.row),
      minCol: rowSelection ? 0 : Math.min(anchor.col, active.col),
      maxCol: rowSelection ? fieldCount - 1 : Math.max(anchor.col, active.col)
    };
  });

  /**
   * Tints the gutter for every row the selection touches, not only in
   * whole-row mode: it is what ties a document in the inspector back to the
   * row it came from.
   */
  function isRowNumSelected(row: number) {
    return selectionRect !== null && row >= selectionRect.minRow && row <= selectionRect.maxRow;
  }

  function cellFlags(row: number, col: number) {
    const selected =
      selectionRect !== null &&
      row >= selectionRect.minRow &&
      row <= selectionRect.maxRow &&
      col >= selectionRect.minCol &&
      col <= selectionRect.maxCol;
    const isActive = active !== null && active.row === row && active.col === col;
    return { selected, isActive };
  }

  function handleMousedown(event: MouseEvent) {
    if (event.button !== 0) return;

    const td = (event.target as HTMLElement).closest("td");
    if (!td) return;

    const tr = td.closest("tr");
    if (!tr) return;

    const rowIndex = Number(tr.dataset.rowIndex);
    if (Number.isNaN(rowIndex)) return;

    if (td.classList.contains("row-num")) {
      const coord: CellCoord = { row: rowIndex, col: 0 };
      if (event.shiftKey && anchor) {
        event.preventDefault();
        active = { row: rowIndex, col: active?.col ?? 0 };
      } else {
        anchor = coord;
        active = coord;
      }
      rowSelection = true;
      dragging = true;
      document.addEventListener("mousemove", handleDragMove);
      document.addEventListener("mouseup", handleDragEnd);
      scrollContainer?.focus();
      return;
    }

    const cellIndex = Array.from(tr.children).indexOf(td) - 1;
    if (cellIndex < 0 || cellIndex >= fieldCount) return;

    const coord: CellCoord = { row: rowIndex, col: cellIndex };

    if (event.shiftKey && anchor) {
      event.preventDefault();
      active = coord;
    } else {
      anchor = coord;
      active = coord;
    }

    dragging = true;
    document.addEventListener("mousemove", handleDragMove);
    document.addEventListener("mouseup", handleDragEnd);

    scrollContainer?.focus();
  }

  function resolveCell(x: number, y: number): CellCoord | null {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const td = el.closest("td");
    if (!td || td.classList.contains("row-num") || td.classList.contains("spacer")) return null;
    const tr = td.closest("tr");
    if (!tr) return null;
    const rowIndex = Number(tr.dataset.rowIndex);
    if (Number.isNaN(rowIndex)) return null;
    const cellIndex = Array.from(tr.children).indexOf(td) - 1;
    if (cellIndex < 0 || cellIndex >= fieldCount) return null;
    return { row: rowIndex, col: cellIndex };
  }

  function handleDragMove(event: MouseEvent) {
    if (!dragging) return;
    const coord = resolveCell(event.clientX, event.clientY);
    if (coord) {
      active = coord;
    }
  }

  function handleDragEnd() {
    dragging = false;
    document.removeEventListener("mousemove", handleDragMove);
    document.removeEventListener("mouseup", handleDragEnd);
  }

  const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

  function handleKeydown(event: KeyboardEvent) {
    if (!active) return;

    if (event.key === "Escape") {
      anchor = null;
      active = null;
      rowSelection = false;
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      rowSelection = !rowSelection;
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      onopen?.();
      return;
    }

    if (!ARROW_KEYS.has(event.key)) return;

    event.preventDefault();

    switch (event.key) {
      case "ArrowUp":
        move(-1, 0, event.shiftKey);
        break;
      case "ArrowDown":
        move(1, 0, event.shiftKey);
        break;
      case "ArrowLeft":
        move(0, -1, event.shiftKey);
        break;
      case "ArrowRight":
        move(0, 1, event.shiftKey);
        break;
    }
  }

  const clamp = (n: number, max: number) => Math.min(Math.max(0, n), Math.max(0, max));

  function move(rows: number, cols: number, extend: boolean) {
    if (!active) return;
    const next: CellCoord = {
      row: clamp(active.row + rows, totalRows - 1),
      col: clamp(active.col + cols, fieldCount - 1)
    };
    active = next;
    if (!extend) anchor = next;
    scrollActiveIntoView();
  }

  /** Moves the selection `delta` rows (±Infinity for either end); with
   *  `extend`, the anchor stays put. What the inspector's navigator drives,
   *  so the selection keeps one owner. */
  export function step(delta: number, extend = false) {
    move(delta, 0, extend);
  }

  /** Collapses the selection to the active cell's whole row. */
  export function selectRow() {
    if (!active) return;
    anchor = active;
    rowSelection = true;
    scrollActiveIntoView();
  }

  function handleCopy(event: ClipboardEvent) {
    if (document.activeElement !== scrollContainer) return;
    const rect = selectionRect;
    if (!rect || !schema || !rows || !clipboardText || !event.clipboardData) return;
    const fields = schema.fields.slice(rect.minCol, rect.maxCol + 1);
    const selected = rows
      .slice(rect.minRow, rect.maxRow + 1)
      .map((row) => row.slice(rect.minCol, rect.maxCol + 1));
    event.clipboardData.setData("text/plain", clipboardText(fields, selected));
    event.preventDefault();
  }

  function scrollActiveIntoView() {
    if (!active || !scrollContainer) return;

    const headerHeight = HEADER_HEIGHT;

    const rowTop = active.row * rowHeight;
    const rowBottom = rowTop + rowHeight;
    const viewTop = scrollContainer.scrollTop + headerHeight;
    const viewBottom = scrollContainer.scrollTop + containerHeight;

    if (rowTop < viewTop) {
      scrollContainer.scrollTop = rowTop - headerHeight;
    } else if (rowBottom > viewBottom) {
      scrollContainer.scrollTop = rowBottom - containerHeight + headerHeight;
    }

    let colLeft = ROW_NUMBER_WIDTH;
    for (let i = 0; i < active.col; i++) colLeft += columnWidths[i];
    const colRight = colLeft + columnWidths[active.col];
    const viewLeft = scrollContainer.scrollLeft + ROW_NUMBER_WIDTH;
    const viewRight = scrollContainer.scrollLeft + scrollContainer.clientWidth;

    if (colLeft < viewLeft) {
      scrollContainer.scrollLeft = colLeft - ROW_NUMBER_WIDTH;
    } else if (colRight > viewRight) {
      scrollContainer.scrollLeft = colRight - scrollContainer.clientWidth;
    }
  }

  let measure: ((text: string) => number) | null = null;

  function textWidth(text: string): number {
    measure ??= textMeasurer(scrollContainer!);
    return measure(text);
  }

  /** Numeric cells draw tabular figures, which a canvas cannot be asked for;
   *  every digit measured as a zero is the same width. */
  function contentWidth(col: number, sample: readonly (readonly unknown[])[], max: number) {
    const field = schema!.fields[col];
    let width = textWidth(field.name) + HEADER_EXTRA;
    for (const row of sample) {
      let text = formatCell(valueConverter(row[col], field, col), field.dataType);
      if (numeric[col]) text = text.replace(/\d/g, "0");
      width = Math.max(width, textWidth(text));
      if (width + CELL_PADDING >= max) break;
    }
    return Math.min(max, Math.max(MIN_COLUMN_WIDTH, Math.ceil(width) + CELL_PADDING));
  }

  function fitColumn(col: number) {
    if (!rows) return;
    pinned[col] = contentWidth(col, rows.slice(0, FIT_ROWS), FIT_MAX_WIDTH);
  }

  let lastHandlePress: { col: number; time: number } | null = null;

  function handleResizePointerdown(event: PointerEvent, colIndex: number) {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    event.stopPropagation();
    // Also suppresses the compatibility mouse events, `dblclick` among them,
    // so a double press is recognised here.
    event.preventDefault();

    const press = { col: colIndex, time: event.timeStamp };
    if (lastHandlePress?.col === colIndex && press.time - lastHandlePress.time < 400) {
      lastHandlePress = null;
      fitColumn(colIndex);
      return;
    }
    lastHandlePress = press;

    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startWidth = columnWidths[colIndex];
    resizing = true;

    const onPointermove = (e: PointerEvent) => {
      const delta = e.clientX - startX;
      pinned[colIndex] = Math.max(MIN_COLUMN_WIDTH, startWidth + delta);
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

  // Reset selection and column widths when schema changes (i.e., new query)
  $effect(() => {
    schema;
    anchor = null;
    active = null;
    rowSelection = false;
    measured = [];
    pinned = Array(schema?.fields?.length ?? 0).fill(null);
    sampled = -1;
  });

  // Measure from the header alone until the first rows land, then once from
  // those. Later pages do not re-measure: widths must not shift under a
  // reader while a result streams.
  $effect(() => {
    if (!schema || !rows || !scrollContainer) return;
    if (sampled > 0 || (sampled === 0 && rows.length === 0)) return;
    const sample = rows.slice(0, SAMPLE_ROWS);
    measured = schema.fields.map((_, i) => contentWidth(i, sample, MAX_COLUMN_WIDTH));
    sampled = sample.length;
  });

  // Sync selection prop from internal selection state.
  //
  // `rows` is deliberately not a dependency: a result's `Rows` is a new
  // reference on every page that arrives, so a selection open during a long
  // stream was rebuilt — and the inspector re-flattened and re-drew every
  // selected document — about once a megabyte. The rows a selection covers
  // are the ones already here, and they do not change; `getData` reads
  // whatever the table holds when it is called, untracked so the caller's
  // effect does not pick the dependency up in this one's place.
  $effect(() => {
    const rect = selectionRect;
    if (!rect || !schema) {
      selection = null;
      return;
    }
    const { minRow, maxRow, minCol, maxCol } = rect;
    const s = schema;
    const vc = valueConverter;
    selection = {
      minRow,
      maxRow,
      minCol,
      maxCol,
      getData() {
        const r = untrack(() => rows);
        const fields = s.fields.slice(minCol, maxCol + 1);
        const selectedRows = (r?.slice(minRow, maxRow + 1) ?? []).map((row) =>
          fields.map((field, i) => vc(row[minCol + i], field, minCol + i))
        );
        return { fields, rows: selectedRows };
      }
    };
  });
</script>

<svelte:document oncopy={handleCopy} />

{#if schema}
  <div
    class="table-container"
    class:dragging
    bind:this={scrollContainer}
    bind:clientHeight={containerHeight}
    bind:clientWidth={containerWidth}
    role="grid"
    tabindex="0"
    onkeydown={handleKeydown}
    onmousedown={handleMousedown}
    onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
  >
    <table
      style:width="100%"
      style:min-width="{columnsWidth + (layout.filled ? 0 : spacerMinWidth)}px"
    >
      <colgroup>
        <col style:width="{ROW_NUMBER_WIDTH}px" />
        {#each columnWidths as w}
          <col style:width="{w}px" />
        {/each}
        <col class="spacer-col" />
      </colgroup>
      <thead>
        <tr style:height="{HEADER_HEIGHT}px">
          <th class="row-num"></th>
          {#each schema.fields as field, colIdx}
            <th class:numeric={numeric[colIdx]}>
              {#if header}
                {@render header(field)}
              {:else}
                {field.name}
              {/if}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="resize-handle"
                onpointerdown={(e) => handleResizePointerdown(e, colIdx)}
              ></div>
            </th>
          {/each}
          <th class="spacer"></th>
        </tr>
      </thead>
      {#if totalRows === 0 && empty}
        <tbody>
          <tr>
            <td colspan={colCount} class="empty-cell">
              <div class="empty-state" style:top="{HEADER_HEIGHT}px">
                {#if empty}
                  {@render empty()}
                {:else}
                  <span>No data</span>
                {/if}
              </div>
            </td>
          </tr>
        </tbody>
      {:else}
        <tbody>
          {#if offsetY > 0}
            <tr aria-hidden="true" style:height="{offsetY}px">
              <td colspan={colCount}></td>
            </tr>
          {/if}

          {#each visibleRows as row, i (startIndex + i)}
            {@const absRow = startIndex + i}
            <tr style:height="{rowHeight}px" data-row-index={absRow}>
              <td class="row-num meta" class:selected={isRowNumSelected(absRow)}>{absRow + 1}</td>
              {#each row as cell, colIdx}
                {@const flags = cellFlags(absRow, colIdx)}
                {@const renderCell = resolvedRenderers[colIdx]}
                <td
                  class:numeric={numeric[colIdx]}
                  class:selected={flags.selected}
                  class:active={flags.isActive}
                  >{@render renderCell(
                    schema.fields[colIdx],
                    valueConverter(cell, schema.fields[colIdx], colIdx)
                  )}</td
                >
              {/each}
              <td class="spacer"></td>
            </tr>
          {/each}

          {#if bottomSpacerHeight > 0}
            <tr aria-hidden="true" style:height="{bottomSpacerHeight}px">
              <td colspan={colCount}></td>
            </tr>
          {/if}
        </tbody>
      {/if}
    </table>
  </div>

  {#if resizing}
    <div class="resize-overlay"></div>
  {/if}
{/if}

<style>
  /* Hairlines run one way only. Vertical rules turned every cell into a box;
     column tracking is carried instead by the header's separators, the
     row-number gutter, and right-aligned tabular numerics. */
  .table-container {
    position: relative;
    flex: 1;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: auto;
    /* An arrow, not an I-beam: a drag here sweeps out a range of cells, and
       the caret would be promising a text selection the grid never makes. The
       resize handles set their own cursor over it. */
    cursor: default;
  }

  .table-container:focus {
    outline: none;
  }

  .table-container.dragging {
    user-select: none;
  }

  table {
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
  }

  th {
    position: sticky;
    top: 0;
    z-index: 3;
    padding: 0 12px;
    background: var(--s1);
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line-strong);
    text-align: left;
    vertical-align: middle;
    font-weight: 400;
    overflow: hidden;
  }

  th.row-num {
    left: 0;
    z-index: 4;
    padding: 0;
  }

  td {
    padding: 0 12px;
    border-bottom: 1px solid var(--line);
    background: var(--s0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  td.row-num {
    position: sticky;
    left: 0;
    z-index: 2;
    background: var(--s1);
    border-right: 1px solid var(--line);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  th.numeric,
  td.numeric {
    text-align: right;
  }

  td.numeric {
    font-variant-numeric: tabular-nums;
  }

  td.selected {
    background: var(--accent-bg);
  }

  td.row-num.selected {
    background: linear-gradient(var(--accent-bg), var(--accent-bg)), var(--s1);
    color: var(--accent);
  }

  /* One inset ring, not a 2px outline: at 30px rows a heavy ring on the
     active cell reads as a second grid. */
  td.active {
    background: var(--accent-bg);
    box-shadow: inset 0 0 0 1px var(--accent-line);
  }

  tr[aria-hidden="true"] td,
  th.spacer,
  td.spacer {
    padding: 0;
  }

  th.spacer {
    border-right: none;
  }

  td.spacer {
    pointer-events: none;
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

  .resize-handle:hover {
    background: var(--accent-line);
  }

  .resize-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    cursor: col-resize;
  }

  .empty-cell {
    height: 100%;
    padding: 0;
    border: none;
  }

  .empty-state {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
