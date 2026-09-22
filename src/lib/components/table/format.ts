/**
 * What a cell reads as: the pure half of `snippets.svelte`, so that the two
 * rules a reader actually depends on — what nothing looks like, and what a
 * value with nothing in it looks like — can be tested without a DOM.
 */
import { isDictionary, isList, isStruct, type DataType } from "./types";

/** Bytes past which a cell stops spelling a value out. The grid is where a row
 *  is found, not where a blob is read; the inspector is where the rest is. */
const HEX_CELL_BYTES = 256;

/**
 * What a null reads as. Drawn blank it was indistinguishable from `''`, from
 * `X''`, and from an array with nothing in it — every one of them an empty
 * cell, and "is this column set for this row" is most of what a reader is
 * scanning a column for. It is written in the cell and muted rather than left
 * out, because a varchar holding the text `NULL` is a value and has to go on
 * reading as one: the colour is what says which of the two this is.
 */
export const NULL_TEXT = "NULL";

/** Trino's null, and a row shorter than its schema — both of which the grid
 *  draws the same way, since neither has a value to show. */
export const isNull = (value: unknown): boolean => value === null || value === undefined;

/**
 * `0x` and the bytes. A value with no bytes is *blank*, not `0x`: the prefix
 * on its own names a notation rather than a value, and beside a null now
 * reading `NULL` the empty cell is the honest drawing of an empty one.
 */
function hex(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const shown = bytes.subarray(0, HEX_CELL_BYTES);
  let out = "0x";
  for (const b of shown) out += b.toString(16).padStart(2, "0");
  return bytes.length > shown.length ? out + "…" : out;
}

/** One line of text for a cell. Anything with an inside is counted rather than
 *  opened — the inspector is what opens it. */
export function formatCell(value: any, dataType: DataType): string {
  if (isNull(value)) return NULL_TEXT;
  if (dataType === "binary" && value instanceof Uint8Array) return hex(value);
  if (isList(dataType)) {
    const n = Array.isArray(value) ? value.length : 0;
    return `[${n} item${n !== 1 ? "s" : ""}]`;
  }
  if (isStruct(dataType)) {
    const n = dataType.fields.length;
    return `{${n} field${n !== 1 ? "s" : ""}}`;
  }
  if (isDictionary(dataType)) {
    const n = typeof value === "object" ? Object.keys(value).length : 0;
    return `{${n} ${n !== 1 ? "entries" : "entry"}}`;
  }
  return String(value);
}
