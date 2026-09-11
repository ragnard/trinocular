import type { Field, Selection } from "$lib/components/table/types";
import { symbolName, type PlanNode } from "./types";

/**
 * A plan operator as something the inspector can read. The inspector takes a
 * `Selection` — a block of typed cells with a `getData` — and flattens maps
 * and arrays into dotted paths, so a node's `descriptor` typed as a map comes
 * out as `descriptor.type`, `descriptor.keys`, and its `details` as
 * `details[1]`, `details[2]`: the same reading a row with a map column gets,
 * and no second inspector to draw it.
 *
 * Estimates are kept as they arrived. The planner writes `"NaN"` for a cost
 * it did not compute, and a null in its place would be hidden by the pane's
 * default — the absence of an estimate is worth a line.
 */
export function selectionForNode(node: PlanNode, fragmentId: string): Selection {
  const text: Field = { name: "", dataType: "string", dataTypeName: "varchar", nullable: false };
  const map = (name: string): Field => ({
    name,
    dataType: { key: "string", value: "string" },
    dataTypeName: "map(varchar, varchar)",
    nullable: false
  });
  const fields: Field[] = [
    { ...text, name: "name" },
    { ...text, name: "id" },
    { ...text, name: "fragment" },
    map("descriptor"),
    map("outputs"),
    { name: "details", dataType: ["string"], dataTypeName: "array(varchar)", nullable: false },
    map("estimates")
  ];
  const row = [
    node.name,
    node.id,
    fragmentId,
    node.descriptor,
    Object.fromEntries(node.outputs.map((o) => [symbolName(o), o.type])),
    node.details,
    Object.fromEntries(Object.entries(node.estimates[0] ?? {}).map(([k, v]) => [k, String(v)]))
  ];
  return {
    minRow: 0,
    maxRow: 0,
    minCol: 0,
    maxCol: fields.length - 1,
    getData: () => ({ fields, rows: [row] }),
    title: `${node.name} · node ${node.id}`,
    rowTitle: () => `Fragment ${fragmentId}`
  };
}
