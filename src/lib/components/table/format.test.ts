import { describe, expect, test } from "bun:test";
import { NULL_TEXT, formatCell } from "./format";
import type { Field } from "./types";

const field = (name: string): Field => ({
  name,
  dataType: "string",
  dataTypeName: "varchar",
  nullable: true
});

describe("formatCell", () => {
  test("a null is named, whatever its type", () => {
    expect(formatCell(null, "string")).toBe(NULL_TEXT);
    expect(formatCell(null, "integer")).toBe(NULL_TEXT);
    expect(formatCell(null, "binary")).toBe(NULL_TEXT);
    expect(formatCell(null, ["string"])).toBe(NULL_TEXT);
    expect(formatCell(null, { fields: [field("a")] })).toBe(NULL_TEXT);
    expect(formatCell(null, { key: "string", value: "string" })).toBe(NULL_TEXT);
  });

  test("a row too short for its schema reads as a null, not as undefined", () => {
    expect(formatCell(undefined, "string")).toBe(NULL_TEXT);
  });

  test("nothing at all is drawn for a value that is empty rather than absent", () => {
    expect(formatCell("", "string")).toBe("");
    expect(formatCell(new Uint8Array(), "binary")).toBe("");
  });

  test("bytes are hex, and a long value says it was cut", () => {
    expect(formatCell(new Uint8Array([0x01, 0x02, 0xff]), "binary")).toBe("0x0102ff");
    const long = formatCell(new Uint8Array(300), "binary");
    expect(long.startsWith("0x")).toBe(true);
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBe(2 + 256 * 2 + 1);
  });

  test("anything with an inside is counted rather than opened", () => {
    expect(formatCell([1, 2], ["integer"])).toBe("[2 items]");
    expect(formatCell([1], ["integer"])).toBe("[1 item]");
    expect(formatCell([], ["integer"])).toBe("[0 items]");
    expect(formatCell([1, "x"], { fields: [field("a"), field("b")] })).toBe("{2 fields}");
    expect(formatCell([1], { fields: [field("a")] })).toBe("{1 field}");
    expect(formatCell({ a: 1, b: 2 }, { key: "string", value: "integer" })).toBe("{2 entries}");
    expect(formatCell({ a: 1 }, { key: "string", value: "integer" })).toBe("{1 entry}");
  });

  test("a string that spells a null is still a value", () => {
    expect(formatCell("NULL", "string")).toBe("NULL");
    expect(formatCell(0, "integer")).toBe("0");
    expect(formatCell(false, "string")).toBe("false");
  });
});
