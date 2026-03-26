<script lang="ts" module>
  export interface Schema {
    fields: Field[];
  }

  export interface Field {
    name: string;
    dataType: DataType;
    nullable: boolean;
  }

  export interface Struct {
    fields: Field[];
  }

  export type List = DataType[];

  export type DataType = "string" | "integer" | Struct | List;

  export interface TableData {
    schema: Schema;
    data: any[][];
  }
</script>

<script lang="ts">
  const DEFAULT_ROW_HEIGHT = 28;
  const DEFAULT_BUFFER_ROWS = 5;
  const DEFAULT_COLUMN_WIDTH = 150;
  const MIN_COLUMN_WIDTH = 50;
  const DEFAULT_SPACER_MIN_WIDTH = 100;
  const ROW_NUMBER_WIDTH = 60;

  import type { Snippet } from "svelte";

  interface Props {
    data: TableData;
    rowHeight?: number;
    bufferRows?: number;
    columnWidth?: number;
    spacerMinWidth?: number;
    header?: Snippet<[Field]>;
  }

  let {
    data,
    rowHeight = DEFAULT_ROW_HEIGHT,
    bufferRows = DEFAULT_BUFFER_ROWS,
    columnWidth = DEFAULT_COLUMN_WIDTH,
    spacerMinWidth = DEFAULT_SPACER_MIN_WIDTH,
    header
  }: Props = $props();

  let scrollContainer: HTMLDivElement = $state() as HTMLDivElement;
  let scrollTop = $state(0);
  let containerHeight = $state(0);
  let columnWidths: number[] = $state([]);
  let resizing = $state(false);

  let totalRows = $derived(data?.data?.length ?? 0);
  let fieldCount = $derived(data?.schema?.fields?.length ?? 0);
  let colCount = $derived(fieldCount + 2);
  let columnsWidth = $derived(ROW_NUMBER_WIDTH + columnWidths.reduce((sum, w) => sum + w, 0));

  let startIndex = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - bufferRows));
  let endIndex = $derived(
    Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / rowHeight) + bufferRows)
  );
  let visibleRows = $derived(data?.data?.slice(startIndex, endIndex) ?? []);
  let offsetY = $derived(startIndex * rowHeight);
  let bottomSpacerHeight = $derived((totalRows - endIndex) * rowHeight);

  // --- Cell selection state ---
  interface CellCoord {
    row: number;
    col: number;
  }

  let anchor: CellCoord | null = $state(null);
  let active: CellCoord | null = $state(null);

  let selectionRect = $derived.by(() => {
    if (!anchor || !active) return null;
    return {
      minRow: Math.min(anchor.row, active.row),
      maxRow: Math.max(anchor.row, active.row),
      minCol: Math.min(anchor.col, active.col),
      maxCol: Math.max(anchor.col, active.col)
    };
  });

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
    const td = (event.target as HTMLElement).closest("td");
    if (!td || td.classList.contains("row-num")) return;

    const tr = td.closest("tr");
    if (!tr) return;

    const rowIndex = Number(tr.dataset.rowIndex);
    if (Number.isNaN(rowIndex)) return;

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

    scrollContainer.focus();
  }

  const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

  function handleKeydown(event: KeyboardEvent) {
    if (!active || !ARROW_KEYS.has(event.key)) return;

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

  function scrollActiveIntoView() {
    if (!active || !scrollContainer) return;

    const headerHeight = rowHeight;

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

  // Reset selection and column widths when data changes
  $effect(() => {
    data;
    anchor = null;
    active = null;
    columnWidths = Array(data?.schema?.fields?.length ?? 0).fill(columnWidth);
  });

  $effect(() => {
    if (!scrollContainer) return;

    const onScroll = () => {
      scrollTop = scrollContainer.scrollTop;
    };

    scrollContainer.addEventListener("scroll", onScroll, { passive: true });

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerHeight = entry.contentRect.height;
      }
    });
    resizeObserver.observe(scrollContainer);

    return () => {
      scrollContainer.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  });
</script>

{#if data}
  <div
    class="table-container"
    bind:this={scrollContainer}
    tabindex="0"
    onkeydown={handleKeydown}
    onmousedown={handleMousedown}
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
        <tr style:height="{rowHeight}px">
          <th class="row-num">#</th>
          {#each data.schema.fields as field, colIdx}
            <th>
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
      <tbody>
        {#if offsetY > 0}
          <tr aria-hidden="true" style:height="{offsetY}px">
            <td colspan={colCount}></td>
          </tr>
        {/if}

        {#each visibleRows as row, i (startIndex + i)}
          {@const absRow = startIndex + i}
          <tr style:height="{rowHeight}px" data-row-index={absRow}>
            <td class="row-num">{absRow + 1}</td>
            {#each row as cell, colIdx}
              {@const flags = cellFlags(absRow, colIdx)}
              <td class:selected={flags.selected} class:active={flags.isActive}>{cell ?? ""}</td>
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
    </table>
  </div>

  {#if resizing}
    <div class="resize-overlay"></div>
  {/if}
{/if}

<style>
  .table-container {
    overflow: auto;
    height: 100%;
    width: 100%;
    flex: 1;
    min-height: 0;
  }

  table {
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
  }

  thead {
    position: sticky;
    top: 0;
    z-index: 2;
  }

  th {
    position: sticky;
    top: 0;
    background: #f5f5f5;
    white-space: nowrap;
    text-align: left;
    padding: 0 14px 0 8px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  th.row-num {
    left: 0;
    z-index: 3;
  }

  td {
    padding: 0 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  td.row-num {
    position: sticky;
    left: 0;
    z-index: 1;
    background: #f5f5f5;
    text-align: right;
  }

  tr[aria-hidden="true"] td {
    padding: 0;
  }

  .table-container:focus {
    outline: none;
  }

  td.selected {
    background: rgba(14, 101, 235, 0.12);
  }

  td.active {
    outline: 2px solid #0e65eb;
    outline-offset: -2px;
    background: rgba(14, 101, 235, 0.06);
  }

  th.spacer,
  td.spacer {
    padding: 0;
    pointer-events: none;
  }

  .resize-handle {
    position: absolute;
    right: 0;
    top: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    touch-action: none;
  }

  .resize-handle:hover {
    background: rgba(0, 0, 0, 0.1);
  }

  .resize-overlay {
    position: fixed;
    inset: 0;
    cursor: col-resize;
    z-index: 9999;
  }
</style>
