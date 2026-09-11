import type { Fragment, FragmentEdge } from "./fragments";

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Where each fragment card goes, given how big each one turned out to be.
 *
 * The fragment graph is a tree — every fragment sends its output to exactly
 * one `RemoteSource`, and fragment 0 is the root — so this is a layered tree
 * drawn sideways: sources in the leftmost column, the output fragment on the
 * right, data flowing left to right the way the cards read top to bottom. A
 * fragment is centred on the block of fragments feeding it. That is all a
 * plan needs, and it is why nothing like dagre or ELK is here.
 *
 * Sizes have to come from the DOM, since a card is as tall as its rows, so
 * this runs after Svelte Flow has measured the nodes rather than before they
 * render.
 */
export function layoutFragments(
  fragments: Fragment[],
  edges: FragmentEdge[],
  sizeOf: (id: string) => Size,
  gap = { x: 56, y: 24 }
): Map<string, Point> {
  const children = new Map<string, string[]>(fragments.map((f) => [f.id, []]));
  const consumed = new Set<string>();
  for (const { from, to } of edges) {
    children.get(to)?.push(from);
    consumed.add(from);
  }
  const roots = fragments.map((f) => f.id).filter((id) => !consumed.has(id));

  // Depth from a root, and the widest card in each column.
  const depth = new Map<string, number>();
  const visit = (id: string, d: number) => {
    depth.set(id, d);
    for (const child of children.get(id) ?? []) visit(child, d + 1);
  };
  for (const root of roots) visit(root, 0);
  const maxDepth = Math.max(0, ...depth.values());
  const column = (id: string) => maxDepth - (depth.get(id) ?? 0);
  const columnWidth = new Array<number>(maxDepth + 1).fill(0);
  for (const f of fragments) {
    const c = column(f.id);
    columnWidth[c] = Math.max(columnWidth[c], sizeOf(f.id).width);
  }
  const columnX = new Array<number>(maxDepth + 1).fill(0);
  for (let c = 1; c <= maxDepth; c++) columnX[c] = columnX[c - 1] + columnWidth[c - 1] + gap.x;

  // The vertical extent of a fragment and everything feeding it.
  const block = new Map<string, number>();
  const measure = (id: string): number => {
    const own = sizeOf(id).height;
    const inputs = children.get(id) ?? [];
    const span =
      inputs.reduce((sum, child) => sum + measure(child), 0) + gap.y * (inputs.length - 1);
    const height = Math.max(own, span);
    block.set(id, height);
    return height;
  };

  const positions = new Map<string, Point>();
  const place = (id: string, top: number) => {
    const own = sizeOf(id).height;
    const height = block.get(id)!;
    positions.set(id, { x: columnX[column(id)], y: top + (height - own) / 2 });
    const inputs = children.get(id) ?? [];
    const span =
      inputs.reduce((sum, child) => sum + block.get(child)!, 0) + gap.y * (inputs.length - 1);
    let childTop = top + (height - span) / 2;
    for (const child of inputs) {
      place(child, childTop);
      childTop += block.get(child)! + gap.y;
    }
  };

  let top = 0;
  for (const root of roots) {
    measure(root);
    place(root, top);
    top += block.get(root)! + gap.y;
  }
  return positions;
}
