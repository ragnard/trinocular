<script lang="ts" module>
  export type Axis = "horizontal" | "vertical";
  export type Length = `${number}%` | `${number}px`;

  /** One pane's share of the split. `size` is a weight relative to the other
   *  panes' — write them to sum to 100 and they read as percentages. `min`
   *  and `max` bound the pane itself, as a percentage of the split or in
   *  pixels. */
  export interface PaneLayout {
    size: number;
    min?: Length;
    max?: Length;
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    type: Axis;
    panes: Snippet[];
    layout?: PaneLayout[];
  }

  let { type, panes, layout = $bindable([]) }: Props = $props();

  const DIVIDER = 1;
  const STEP = 1;
  const BIG_STEP = 10;

  let container: HTMLDivElement;
  let dragging = $state(false);

  const horizontal = $derived(type === "horizontal");
  const total = $derived(layout.reduce((sum, pane) => sum + pane.size, 0));
  const pane = (i: number): PaneLayout => layout[i] ?? { size: 1 };

  const offset = (i: number) =>
    Math.round((layout.slice(0, i).reduce((sum, p) => sum + p.size, 0) / total) * 100);

  /** The length the panes share, in pixels: the container less its dividers. */
  function usable() {
    const rect = container.getBoundingClientRect();
    return (horizontal ? rect.width : rect.height) - DIVIDER * (panes.length - 1);
  }

  /** A bound in the same units as `size`. */
  function weight(length: Length | undefined, fallback: number, px: number): number {
    if (length === undefined) return fallback;
    const value = parseFloat(length);
    return length.endsWith("px")
      ? px > 0
        ? (value / px) * total
        : fallback
      : (value / 100) * total;
  }

  /** Move the divider after pane `i` so that pane `i` is `size` wide, taking
   *  the difference from its neighbour and no one else. Each of the two is
   *  held inside its own bounds; if those cannot both be met the pair stays
   *  where it is. */
  function resize(i: number, size: number, px: number) {
    const a = pane(i);
    const b = pane(i + 1);
    const pair = a.size + b.size;
    const lower = Math.max(weight(a.min, 0, px), pair - weight(b.max, total, px), 0);
    const upper = Math.min(weight(a.max, total, px), pair - weight(b.min, 0, px), pair);
    if (lower > upper) return;
    const next = Math.min(Math.max(size, lower), upper);
    layout = layout.map((p, j) =>
      j === i ? { ...p, size: next } : j === i + 1 ? { ...p, size: pair - next } : p
    );
  }

  let drag: { index: number; origin: number; size: number; px: number } | null = null;

  function onpointerdown(event: PointerEvent, index: number) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
    drag = {
      index,
      origin: horizontal ? event.clientX : event.clientY,
      size: pane(index).size,
      px: usable()
    };
    dragging = true;
  }

  function onpointermove(event: PointerEvent) {
    if (!drag) return;
    const point = horizontal ? event.clientX : event.clientY;
    const delta = ((point - drag.origin) / drag.px) * total;
    resize(drag.index, drag.size + delta, drag.px);
  }

  function onpointerend() {
    drag = null;
    dragging = false;
  }

  function onkeydown(event: KeyboardEvent, index: number) {
    const forward = horizontal ? "ArrowRight" : "ArrowDown";
    const backward = horizontal ? "ArrowLeft" : "ArrowUp";
    const px = usable();
    const size = pane(index).size;
    const step = ((event.shiftKey ? BIG_STEP : STEP) / 100) * total;

    switch (event.key) {
      case forward:
        resize(index, size + step, px);
        break;
      case backward:
        resize(index, size - step, px);
        break;
      case "Home":
        resize(index, 0, px);
        break;
      case "End":
        resize(index, total, px);
        break;
      default:
        return;
    }
    event.preventDefault();
  }
</script>

<div class="split {type}" class:dragging bind:this={container}>
  {#each panes as content, i (content)}
    {#if i > 0}
      <!-- A separator that is focusable and carries aria-valuenow is the ARIA
           widget for a movable split; the lint rule only knows the static kind. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="divider"
        role="separator"
        tabindex="0"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuenow={offset(i)}
        aria-valuemin={0}
        aria-valuemax={100}
        onpointerdown={(e) => onpointerdown(e, i - 1)}
        {onpointermove}
        onpointerup={onpointerend}
        onpointercancel={onpointerend}
        onlostpointercapture={onpointerend}
        onkeydown={(e) => onkeydown(e, i - 1)}
      ></div>
    {/if}
    <div
      class="pane"
      style:--size={pane(i).size}
      style:--min={pane(i).min ?? "0%"}
      style:--max={pane(i).max ?? "100%"}
    >
      {@render content()}
    </div>
  {/each}
</div>

<style>
  .split {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .horizontal {
    flex-direction: row;
  }

  .vertical {
    flex-direction: column;
  }

  /* Weights rather than lengths: a pane grows in proportion to its size from
     a zero basis, so the panes always fill exactly what the dividers leave
     and the sizes need not sum to anything in particular. */
  .pane {
    flex: var(--size) 1 0px;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .horizontal > .pane {
    min-width: var(--min);
    max-width: var(--max);
  }

  .vertical > .pane {
    min-height: var(--min);
    max-height: var(--max);
  }

  .pane > :global(*) {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  /* The rule is 1px of chrome; the thing you grab is a 12px zone centred on
     it, drawn by the pseudo-element so the neighbouring panes keep the full
     width they are owed. */
  .divider {
    position: relative;
    flex: 0 0 1px;
    background: var(--line-strong);
    touch-action: none;
    z-index: 1;
  }

  .divider::before {
    content: "";
    position: absolute;
  }

  .horizontal > .divider {
    cursor: ew-resize;
  }

  .horizontal > .divider::before {
    inset: 0 -6px;
  }

  .vertical > .divider {
    cursor: ns-resize;
  }

  .vertical > .divider::before {
    inset: -6px 0;
  }

  .dragging {
    user-select: none;
  }

  .horizontal.dragging :global(*) {
    cursor: ew-resize !important;
  }

  .vertical.dragging :global(*) {
    cursor: ns-resize !important;
  }
</style>
