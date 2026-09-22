import { describe, expect, test } from "bun:test";
import { collectContext, dottedParts, functionKindsAt } from "./completionContext";

/**
 * The text is the statement up to the caret. A trailing word is what the user
 * is part-way through typing, and monaco would report it as the prefix, so it
 * is taken off the end here the same way.
 */
function at(text: string) {
  const word = /[A-Za-z_][A-Za-z0-9_]*$/.exec(text)?.[0] ?? "";
  const prefix = word.toUpperCase();
  const { candidates, onChannelTokens } = collectContext(text, prefix);
  return {
    kinds: functionKindsAt(candidates),
    parts: dottedParts(onChannelTokens, prefix)
  };
}

const kindsAt = (text: string) => {
  const kinds = at(text).kinds;
  return kinds ? [...kinds].sort() : undefined;
};

const EXPRESSION = ["aggregate", "scalar", "window"];

describe("functionKindsAt", () => {
  test("offers expression functions where an expression goes", () => {
    expect(kindsAt("SELECT ab")).toEqual(EXPRESSION);
    expect(kindsAt("SELECT ")).toEqual(EXPRESSION);
    expect(kindsAt("SELECT a, ")).toEqual(EXPRESSION);
    expect(kindsAt("SELECT * FROM t WHERE x = ab")).toEqual(EXPRESSION);
    expect(kindsAt("SELECT count(*) FROM t GROUP BY ab")).toEqual(EXPRESSION);
    expect(kindsAt("SELECT x FROM t ORDER BY ab")).toEqual(EXPRESSION);
    expect(kindsAt("SELECT * FROM t WHERE a IN (SELECT ma")).toEqual(EXPRESSION);
  });

  test("offers them inside a call, which is where a nested one goes", () => {
    expect(kindsAt("SELECT count(")).toEqual(EXPRESSION);
    expect(kindsAt("SELECT coalesce(a, ")).toEqual(EXPRESSION);
  });

  test("offers nothing where a relation goes", () => {
    // `FROM abs(...)` is not SQL — a table function is written `TABLE(abs(...))`.
    expect(kindsAt("SELECT * FROM ab")).toBeUndefined();
    expect(kindsAt("SELECT * FROM tpch.tiny.")).toBeUndefined();
    expect(kindsAt("INSERT INTO ab")).toBeUndefined();
  });

  test("offers only table functions inside TABLE(...)", () => {
    expect(kindsAt("SELECT * FROM TABLE(ab")).toEqual(["table"]);
    expect(kindsAt("SELECT * FROM TABLE(")).toEqual(["table"]);
  });

  test("still offers expression functions once inside a table function's arguments", () => {
    expect(kindsAt("SELECT * FROM TABLE(sequence(ab")).toEqual(EXPRESSION);
  });
});

describe("dottedParts", () => {
  test("has no parts for a bare word", () => {
    expect(at("SELECT ab").parts).toEqual([]);
    expect(at("SELECT ").parts).toEqual([]);
  });

  test("reads the parts before the caret, with or without a word after the dot", () => {
    expect(at("SELECT * FROM tpch.").parts).toEqual(["tpch"]);
    expect(at("SELECT * FROM tpch.ti").parts).toEqual(["tpch"]);
    expect(at("SELECT * FROM tpch.tiny.").parts).toEqual(["tpch", "tiny"]);
    expect(at("SELECT * FROM tpch.tiny.cus").parts).toEqual(["tpch", "tiny"]);
  });

  test("reads them in an expression too", () => {
    expect(at("SELECT tpch.tiny.fo").parts).toEqual(["tpch", "tiny"]);
  });

  test("keeps the name as written, since Trino lowercases it and this does not", () => {
    expect(at("SELECT * FROM TPCH.TINY.cus").parts).toEqual(["TPCH", "TINY"]);
  });

  test("takes a part that is also a keyword", () => {
    // `system` is a catalog on every cluster and a token in the grammar.
    expect(at("SELECT * FROM system.runtime.qu").parts).toEqual(["system", "runtime"]);
  });

  test("stops at something that is not a name", () => {
    expect(at("SELECT * FROM a JOIN b ON x.").parts).toEqual(["x"]);
    expect(at("SELECT 1 + ").parts).toEqual([]);
  });
});
