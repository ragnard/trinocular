import type { DistributedPlan, PlanNode } from "./types";

/**
 * A fragment's operators flattened for drawing as a card: children before
 * their parent, so the list reads top to bottom in the order data moves
 * through the fragment, with the fragment's root — what it sends on — last.
 * `depth` is indentation and counts branch points only, not ancestors: a
 * chain of operators sits flush, and the two inputs of a join step in one
 * level under it. It is the only trace of branching left after flattening.
 */
export interface FragmentRow {
  node: PlanNode;
  depth: number;
}

export interface Fragment {
  id: string;
  root: PlanNode;
  rows: FragmentRow[];
  /** The `RemoteSource` nodes in this fragment, each with the fragments it reads. */
  inputs: { node: PlanNode; from: string[] }[];
}

/** Data flows from fragment `from` into the `RemoteSource` node `into` of fragment `to`. */
export interface FragmentEdge {
  from: string;
  to: string;
  into: string;
}

export function fragmentsOf(plan: DistributedPlan): Fragment[] {
  return Object.entries(plan).map(([id, root]) => {
    const rows: FragmentRow[] = [];
    const inputs: Fragment["inputs"] = [];
    const walk = (node: PlanNode, depth: number) => {
      const inner = node.children.length > 1 ? depth + 1 : depth;
      for (const child of node.children) walk(child, inner);
      rows.push({ node, depth });
      if (node.name === "RemoteSource") inputs.push({ node, from: sourceFragmentIds(node) });
    };
    walk(root, 0);
    return { id, root, rows, inputs };
  });
}

export function edgesOf(fragments: Fragment[]): FragmentEdge[] {
  return fragments.flatMap((fragment) =>
    fragment.inputs.flatMap(({ node, from }) =>
      from.map((source) => ({ from: source, to: fragment.id, into: node.id }))
    )
  );
}

/** `"[1, 2]"` → `["1", "2"]`. The descriptor stringifies its lists. */
export function sourceFragmentIds(node: PlanNode): string[] {
  const list = node.descriptor.sourceFragmentIds ?? "";
  return list
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The one thing worth saying about a node beside its name, for the card. What
 * that is depends on the operator: a scan is its table, an aggregate its
 * step, an exchange its partitioning. Anything else says nothing, since the
 * inspector has the rest.
 */
export function summarize(node: PlanNode): string {
  const d = node.descriptor;
  if (node.name.startsWith("Scan") || node.name === "TableScan") return d.table ?? "";
  switch (node.name) {
    case "RemoteSource":
      return (
        "← " +
        sourceFragmentIds(node)
          .map((id) => `Fragment ${id}`)
          .join(", ")
      );
    case "Aggregate":
      return (d.type ?? "").toLowerCase();
    case "LocalExchange":
    case "Exchange":
      return (d.partitioning ?? "").toLowerCase();
    case "Output":
      return (d.columnNames ?? "").replace(/^\[|\]$/g, "");
    default:
      return "";
  }
}

/** The planner's row estimate, or `undefined` where it declined to guess. */
export function rowsEstimate(node: PlanNode): number | undefined {
  const rows = node.estimates[0]?.outputRowCount;
  return typeof rows === "number" && Number.isFinite(rows) ? rows : undefined;
}
