import type { FitViewOptions } from "@xyflow/svelte";

/**
 * How the graph is fitted to the pane, on first draw and from the button: a
 * wide plan shrinks to fit and is panned into, but a small one is not blown
 * up past its own size — two cards at twice scale is not an overview.
 */
export const FIT: FitViewOptions = { padding: 0.1, maxZoom: 1 };
