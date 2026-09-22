import type { FunctionInfo, FunctionKind } from "monaco-language-trino";

/**
 * `SHOW FUNCTIONS` answers one row per *overload*:
 *
 *   Function | Return Type | Argument Types | Function Type | Deterministic | Description
 *   abs      | bigint      | bigint         | scalar        | true          | Absolute value
 *
 * On Trino 480 that is 870 rows for 417 names, so the rows are folded into one
 * entry per name before they are ever offered — a menu row has one line, and
 * seven of `abs` is not seven things to choose between.
 */
const NAME = 0;
const RETURN_TYPE = 1;
const ARGUMENT_TYPES = 2;
const FUNCTION_TYPE = 3;
const DESCRIPTION = 5;

const KINDS: ReadonlySet<string> = new Set<FunctionKind>([
  "scalar",
  "aggregate",
  "window",
  "table"
]);

/**
 * A `Function Type` the cluster has but this build does not know is read as
 * `scalar`, which is the only guess that can be useful: `table` is the one kind
 * that may not be written in an expression, and everything else may. Dropping
 * the row instead would make a function added by a later Trino invisible here
 * with nothing to say so.
 */
function toKind(value: unknown): FunctionKind {
  const text = String(value ?? "").toLowerCase();
  return KINDS.has(text) ? (text as FunctionKind) : "scalar";
}

function signature(returnType: string, argumentTypes: string): string {
  return `(${argumentTypes}) → ${returnType}`;
}

/**
 * The rows folded by name *and* kind, not by name alone: `sequence` is both a
 * scalar function and a table function on a stock cluster, and the two are
 * written in places that have nothing to do with each other. Folding them
 * together would offer one of them wherever the other belonged.
 *
 * Order is the cluster's — `SHOW FUNCTIONS` sorts by name — and within an entry
 * the signatures keep the order they arrived in.
 */
export function toFunctionInfos(rows: readonly unknown[][]): FunctionInfo[] {
  const byNameAndKind = new Map<string, FunctionInfo>();

  for (const row of rows) {
    const name = String(row[NAME] ?? "");
    if (name.length === 0) continue;

    const kind = toKind(row[FUNCTION_TYPE]);
    const description = String(row[DESCRIPTION] ?? "");
    const sig = signature(String(row[RETURN_TYPE] ?? ""), String(row[ARGUMENT_TYPES] ?? ""));

    const key = `${name}\u001f${kind}`;
    const existing = byNameAndKind.get(key);
    if (!existing) {
      byNameAndKind.set(key, { name, kind, signatures: [sig], description });
      continue;
    }
    if (!existing.signatures.includes(sig)) existing.signatures.push(sig);
    // Most overloads repeat the same description and some leave it empty, so
    // the first one that says anything is the one kept.
    if (existing.description.length === 0) existing.description = description;
  }

  return [...byNameAndKind.values()];
}
