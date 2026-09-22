import { describe, expect, test } from "bun:test";
import { toFunctionInfos } from "./functions";

/** A `SHOW FUNCTIONS` row, in the column order Trino answers with. */
const row = (
  name: string,
  returnType: string,
  argumentTypes: string,
  functionType: string,
  description = ""
) => [name, returnType, argumentTypes, functionType, true, description];

describe("toFunctionInfos", () => {
  test("folds the overloads of one name into one entry", () => {
    const infos = toFunctionInfos([
      row("abs", "bigint", "bigint", "scalar", "Absolute value"),
      row("abs", "double", "double", "scalar", "Absolute value"),
      row("abs", "real", "real", "scalar", "Absolute value")
    ]);

    expect(infos).toEqual([
      {
        name: "abs",
        kind: "scalar",
        signatures: ["(bigint) → bigint", "(double) → double", "(real) → real"],
        description: "Absolute value"
      }
    ]);
  });

  test("keeps a name that is two kinds of function apart", () => {
    // `sequence` really is both on a stock cluster, and the two are written in
    // places that have nothing to do with each other.
    const infos = toFunctionInfos([
      row("sequence", "array(bigint)", "bigint, bigint", "scalar"),
      row("sequence", "table", "bigint, bigint", "table")
    ]);

    expect(infos.map((f) => f.kind)).toEqual(["scalar", "table"]);
    expect(infos.every((f) => f.name === "sequence")).toBe(true);
  });

  test("writes a zero-argument function as empty parentheses", () => {
    const infos = toFunctionInfos([row("now", "timestamp(3) with time zone", "", "scalar")]);
    expect(infos[0].signatures).toEqual(["() → timestamp(3) with time zone"]);
  });

  test("takes the first description that says anything", () => {
    const infos = toFunctionInfos([
      row("greatest", "bigint", "bigint, bigint", "scalar", ""),
      row("greatest", "double", "double, double", "scalar", "Get the largest of the arguments"),
      row("greatest", "real", "real, real", "scalar", "Something else entirely")
    ]);
    expect(infos[0].description).toBe("Get the largest of the arguments");
  });

  test("does not repeat an identical signature", () => {
    const infos = toFunctionInfos([
      row("count", "bigint", "", "aggregate"),
      row("count", "bigint", "", "aggregate")
    ]);
    expect(infos[0].signatures).toEqual(["() → bigint"]);
  });

  test("reads an unknown function type as scalar, so it stays offerable", () => {
    const infos = toFunctionInfos([row("something_new", "bigint", "bigint", "quantum")]);
    expect(infos[0].kind).toBe("scalar");
  });

  test("keeps the cluster's order", () => {
    const infos = toFunctionInfos([
      row("abs", "bigint", "bigint", "scalar"),
      row("acos", "double", "double", "scalar"),
      row("avg", "double", "double", "aggregate")
    ]);
    expect(infos.map((f) => f.name)).toEqual(["abs", "acos", "avg"]);
  });

  test("skips a row with no name and survives missing columns", () => {
    const infos = toFunctionInfos([row("", "bigint", "bigint", "scalar"), ["trim"]]);
    expect(infos).toEqual([
      { name: "trim", kind: "scalar", signatures: ["() → "], description: "" }
    ]);
  });

  test("has nothing to say about nothing", () => {
    expect(toFunctionInfos([])).toEqual([]);
  });
});
