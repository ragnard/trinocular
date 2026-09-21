import { describe, expect, test } from "bun:test";
import { fileLineMessage } from "./errors";

describe("fileLineMessage", () => {
  test("moves the line in the prefix to file lines", () => {
    expect(fileLineMessage("line 1:22: Schema must be specified", 3)).toBe(
      "line 3:22: Schema must be specified"
    );
    expect(fileLineMessage("line 4:1: mismatched input 'FROM'", 10)).toBe(
      "line 13:1: mismatched input 'FROM'"
    );
  });

  test("leaves a statement at the top of the file alone", () => {
    expect(fileLineMessage("line 2:5: Column 'x' cannot be resolved", 1)).toBe(
      "line 2:5: Column 'x' cannot be resolved"
    );
  });

  test("leaves a message with no location alone", () => {
    expect(fileLineMessage("Query exceeded maximum time limit", 7)).toBe(
      "Query exceeded maximum time limit"
    );
  });

  test("only rewrites the prefix", () => {
    expect(fileLineMessage("line 1:1: See line 1:9 too", 5)).toBe("line 5:1: See line 1:9 too");
    expect(fileLineMessage("Failed at line 1:1", 5)).toBe("Failed at line 1:1");
  });
});
