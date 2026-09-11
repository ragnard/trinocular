import type { PlanNode } from "$lib/plan/types";

/**
 * Which operator is picked out in the graph. Shared with the cards through
 * context rather than through node data, because Svelte Flow copies node
 * data into each node object: pushing a selection change through that path
 * would mean rebuilding every node to highlight one row.
 */
export class PlanSelection {
  id = $state<string | null>(null);

  constructor(private readonly onselect?: (node: PlanNode, fragmentId: string) => void) {}

  select(node: PlanNode, fragmentId: string) {
    this.id = node.id;
    this.onselect?.(node, fragmentId);
  }
}

export const PLAN_SELECTION = Symbol("plan-selection");
