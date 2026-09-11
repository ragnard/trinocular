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

/**
 * An output column of an operator. Current Trino names it `name`; the
 * example in the docs, and the releases it was written against, say
 * `symbol`. Read with `symbolName`.
 */
export interface PlanSymbol {
  name?: string;
  symbol?: string;
  type: string;
}

export function symbolName(output: PlanSymbol): string {
  return output.name ?? output.symbol ?? "";
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
