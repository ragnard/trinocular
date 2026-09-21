/**
 * Remembering a layout between visits: what of it is stored, and how what
 * was stored is read back against the layout the code declares.
 *
 * Only the sizes are stored. The bounds are the code's — a pane's `min` says
 * what the screen needs, not what the reader chose — and storing them would
 * let an old visit's bounds outlive the build that set them.
 */
import type { PaneLayout } from "./SplitPane.svelte";

/** What `withSizes` will take back: the panes' sizes, in order. */
export const sizesOf = (layout: PaneLayout[]): number[] => layout.map((p) => p.size);

/**
 * `layout` with `stored` sizes in place of its own, when they can stand in:
 * one finite, non-negative number per pane, not all zero, and — each taken as
 * its share of their total — every pane inside its percentage bounds.
 * Anything else is `layout` as declared.
 *
 * The bounds are applied in JS as well as CSS, so a size outside them must
 * never be reported, and a stored layout that breaks one is a layout from
 * another build's bounds. It is dropped whole rather than clamped: pulling one
 * pane inside its bound changes the total every other is measured against,
 * which can put the next pane out, and a layout half-repaired is one nobody
 * chose. A pixel bound cannot be judged before there is a container to
 * measure against; CSS holds the pane meanwhile, and the first resize goes
 * through the same clamp every other does.
 */
export function withSizes(layout: PaneLayout[], stored: unknown): PaneLayout[] {
  if (!Array.isArray(stored) || stored.length !== layout.length) return layout;
  if (!stored.every((s) => typeof s === "number" && Number.isFinite(s) && s >= 0)) return layout;
  const total = (stored as number[]).reduce((sum, s) => sum + s, 0);
  if (total <= 0) return layout;
  const sizes = stored as number[];
  const inside = layout.every((pane, i) => {
    const share = (sizes[i] / total) * 100;
    return share >= (percent(pane.min) ?? 0) && share <= (percent(pane.max) ?? 100);
  });
  if (!inside) return layout;
  return layout.map((pane, i) => ({ ...pane, size: sizes[i] }));
}

const percent = (length: string | undefined): number | undefined =>
  length?.endsWith("%") ? parseFloat(length) : undefined;
