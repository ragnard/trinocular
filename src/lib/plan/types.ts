/**
 * The document `EXPLAIN (TYPE DISTRIBUTED, FORMAT JSON)` returns: a map from
 * fragment id to the root of that fragment's operator tree. Fragments refer to
 * each other only through `RemoteSource` nodes, whose descriptor names the
 * fragments they read (`sourceFragmentIds: "[1, 2]"`). The fragment's own
 * partitioning (`SINGLE`, `HASH`, `SOURCE`) and output layout, which the text
 * form prints as a header, are not in this document at all.
 */
export interface PlanNode {
  id: string;
  name: string;
  /** Free-form per-operator attributes; every value is a string, lists included. */
  descriptor: Record<string, string>;
  outputs: PlanSymbol[];
  details: string[];
  /** Empty for operators the planner did not cost. */
  estimates: PlanEstimate[];
  children: PlanNode[];
}

export interface PlanSymbol {
  symbol: string;
  type: string;
}

/** An unknown estimate arrives as the string `"NaN"`, not a JSON number. */
export type PlanNumber = number | "NaN";

export interface PlanEstimate {
  outputRowCount: PlanNumber;
  outputSizeInBytes: PlanNumber;
  cpuCost: PlanNumber;
  memoryCost: PlanNumber;
  networkCost: PlanNumber;
}

export type DistributedPlan = Record<string, PlanNode>;
