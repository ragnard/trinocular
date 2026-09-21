import { describe, expect, test } from "bun:test";
import { EXPORT_FORMATS, clipboardText } from "./export";
import type { Field } from "./components/table/types";

const format = (id: string) => EXPORT_FORMATS.find((f) => f.id === id)!;

const fields: Field[] = [
  { name: "id", dataType: "integer", dataTypeName: "integer", nullable: true },
  { name: "name", dataType: "string", dataTypeName: "varchar", nullable: true },
  {
    name: "point",
    dataType: {
      fields: [{ name: "x", dataType: "integer", dataTypeName: "integer", nullable: true }]
    },
    dataTypeName: "row(x integer)",
    nullable: true
  }
];

const rows = [
  [1, "a,b", [10]],
  [2, "=cmd", null],
  [-3, null, [20]]
];

describe("csv", () => {
  test("yields one terminated line per row after the header", () => {
    const lines = Array.from(format("csv").serialize(fields, rows));
    expect(lines).toEqual([
      "id,name,point\r\n",
      '1,"a,b","{""x"":10}"\r\n',
      "2,'=cmd,\r\n",
      '-3,,"{""x"":20}"\r\n'
    ]);
  });

  test("a result with no rows is the header alone", () => {
    expect(Array.from(format("csv").serialize(fields, []))).toEqual(["id,name,point\r\n"]);
  });
});

describe("ndjson", () => {
  test("yields one terminated object per row, with the row's field names put back", () => {
    const lines = Array.from(format("ndjson").serialize(fields, rows));
    expect(lines).toEqual([
      '{"id":1,"name":"a,b","point":{"x":10}}\n',
      '{"id":2,"name":"=cmd","point":null}\n',
      '{"id":-3,"name":null,"point":{"x":20}}\n'
    ]);
  });

  test("a result with no rows is an empty file", () => {
    expect(Array.from(format("ndjson").serialize(fields, []))).toEqual([]);
  });
});

describe("every format", () => {
  // The whole point of yielding lines: a file bigger than the largest string
  // the engine allows can still be handed to a Blob, part by part, so nothing
  // on the way there may concatenate the file.
  test("never joins the file into one string", () => {
    const wide: Field[] = [
      { name: "v", dataType: "string", dataTypeName: "varchar", nullable: true }
    ];
    const value = "x".repeat(1_000);
    const many = {
      *[Symbol.iterator]() {
        for (let i = 0; i < 10_000; i++) yield [value];
      }
    };
    for (const f of EXPORT_FORMATS) {
      let count = 0;
      let longest = 0;
      for (const part of f.serialize(wide, many)) {
        count++;
        longest = Math.max(longest, part.length);
      }
      expect(count).toBeGreaterThanOrEqual(10_000);
      expect(longest).toBeLessThan(2_000);
    }
  });
});

describe("clipboard", () => {
  test("one cell is the bare value", () => {
    expect(clipboardText([fields[1]], [["a,b"]])).toBe("a,b");
    expect(clipboardText([fields[2]], [[[10]]])).toBe('{"x":10}');
  });

  test("a block is CSV rows without the header", () => {
    expect(clipboardText(fields, rows.slice(0, 2))).toBe('1,"a,b","{""x"":10}"\n2,\'=cmd,');
  });
});
