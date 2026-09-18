<script lang="ts">
  import type { Snippet } from "svelte";
  import type {
    Field,
    DataType,
    Schema,
    Selection,
    CellRendererLookup,
    RowSource,
    ValueConverter
  } from "./types";
  import { defaultCell } from "./snippets.svelte";

  const DEFAULT_ROW_HEIGHT = 30;
  /** The header is a rail, like every other pane header in the app. */
  const HEADER_HEIGHT = 36;
  const DEFAULT_BUFFER_ROWS = 5;
  const DEFAULT_COLUMN_WIDTH = 150;
  const MIN_COLUMN_WIDTH = 50;
  const DEFAULT_SPACER_MIN_WIDTH = 100;
  const ROW_NUMBER_WIDTH = 52;

  const identity: ValueConverter = (value) => value;

  interface Props {
    schema?: Schema;
    rows?: RowSource;
    rowHeight?: number;
    bufferRows?: number;
    columnWidth?: number;
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
  }

  let {
    schema,
    rows,
    rowHeight = DEFAULT_ROW_HEIGHT,
    bufferRows = DEFAULT_BUFFER_ROWS,
    columnWidth = DEFAULT_COLUMN_WIDTH,
    spacerMinWidth = DEFAULT_SPACER_MIN_WIDTH,
    header,
    empty,
    cellRenderer: cellRendererProp,
    valueConverter = identity,
    selection = $bindable(null),
    clipboardText
  }: Props = $props();

  let scrollContainer: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let containerHeight = $state(0);
  let columnWidths: number[] = $state([]);
  let resizing = $state(false);
  let dragging = $state(false);

  let totalRows = $derived(rows?.length ?? 0);
  let fieldCount = $derived(schema?.fields?.length ?? 0);
  let colCount = $derived(fieldCount + 2);
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

    if (!ARROW_KEYS.has(event.key)) return;

    event.preventDefault();

    let nextRow = active.row;
    let nextCol = active.col;

    switch (event.key) {
      case "ArrowUp":
        nextRow = Math.max(0, active.row - 1);
        break;
      case "ArrowDown":
        nextRow = Math.min(totalRows - 1, active.row + 1);
        break;
      case "ArrowLeft":
        nextCol = Math.max(0, active.col - 1);
        break;
      case "ArrowRight":
        nextCol = Math.min(fieldCount - 1, active.col + 1);
        break;
    }

    const next: CellCoord = { row: nextRow, col: nextCol };
    active = next;

    if (!event.shiftKey) {
      anchor = next;
    }

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

  function handleResizePointerdown(event: PointerEvent, colIndex: number) {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    event.stopPropagation();
    event.preventDefault();

    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startWidth = columnWidths[colIndex];
    resizing = true;

    const onPointermove = (e: PointerEvent) => {
      const delta = e.clientX - startX;
      columnWidths[colIndex] = Math.max(MIN_COLUMN_WIDTH, startWidth + delta);
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
    columnWidths = Array(schema?.fields?.length ?? 0).fill(columnWidth);
  });

  // Sync selection prop from internal selection state
  $effect(() => {
    const rect = selectionRect;
    if (!rect || !schema || !rows) {
      selection = null;
      return;
    }
    const { minRow, maxRow, minCol, maxCol } = rect;
    const s = schema;
    const r = rows;
    const vc = valueConverter;
    selection = {
      minRow,
      maxRow,
      minCol,
      maxCol,
      getData() {
        const fields = s.fields.slice(minCol, maxCol + 1);
        const selectedRows = r
          .slice(minRow, maxRow + 1)
          .map((row) => fields.map((field, i) => vc(row[minCol + i], field, minCol + i)));
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
    role="grid"
    tabindex="0"
    onkeydown={handleKeydown}
    onmousedown={handleMousedown}
    onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
  >
    <table style:width="100%" style:min-width="{columnsWidth + spacerMinWidth}px">
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
              <td class="row-num" class:selected={isRowNumSelected(absRow)}>{absRow + 1}</td>
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
    color: var(--fg-3);
    font-size: var(--text-sm);
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
