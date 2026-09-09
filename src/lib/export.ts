/**
 * Saving a result to a file, entirely in the browser: the rows are already
 * here, and asking the cluster to run the query a second time to render it
 * would be a different query — a different snapshot, a different cost, and a
 * second thing that can fail — for bytes we are already holding.
 *
 * A format is one entry in `EXPORT_FORMATS`. The menu is drawn from that list,
 * so adding ndjson later is a serializer and an entry, and nothing in the UI.
 */
import type { DataType, Field, Struct } from "./components/table/types";

export interface ExportFormat {
  id: string;
  /** What the menu offers. */
  label: string;
  /** Appended to the query id to name the file. */
  extension: string;
  mimeType: string;
  /**
   * The rows exactly as Trino sent them — not the converted values the table
   * renders. Conversion exists to put a value on screen (binary becomes a
   * `Uint8Array` so a cell can show its bytes), and every one of those
   * decisions is the wrong one for a file: base64 is what a varbinary column
   * arrived as and what any reader on the other side will expect back.
   */
  serialize(fields: Field[], rows: readonly unknown[][]): string;
}

function isStruct(dataType: DataType): dataType is Struct {
  return typeof dataType === "object" && !Array.isArray(dataType) && "fields" in dataType;
}

/**
 * A structured value shaped for JSON. Trino sends a row as an *array* of its
 * field values, so the names only exist in the type — putting them back is the
 * difference between `[1,"x"]` and `{"a":1,"b":"x"}`, and only one of those can
 * be read without the query beside it. Arrays recurse into their element type;
 * a map already arrives as a JSON object and is left alone.
 */
function toJson(value: unknown, dataType: DataType): unknown {
  if (value === null || value === undefined) return null;
  if (isStruct(dataType) && Array.isArray(value)) {
    return Object.fromEntries(
      dataType.fields.map((field, i) => [field.name, toJson(value[i], field.dataType)])
    );
  }
  if (Array.isArray(dataType) && Array.isArray(value)) {
    return value.map((element) => toJson(element, dataType[0]));
  }
  return value;
}

/** `,` `"` and the line endings are the whole of what CSV reserves. */
const CSV_RESERVED = /[",\r\n]/;

function csvField(text: string): string {
  return CSV_RESERVED.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Anything with an inside becomes JSON — a row, an array, a map, and anything
 * else that arrives as an object. `JSON.stringify` without an indent argument
 * emits no newline of its own and escapes any newline inside a string, so a
 * nested value stays on the one line its cell occupies.
 *
 * A null becomes an empty field, which CSV cannot tell from an empty string.
 * That ambiguity is CSV's, and quoting nulls instead would only move it.
 */
function csvValue(value: unknown, dataType: DataType): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(toJson(value, dataType));
  return String(value);
}

function serializeCsv(fields: Field[], rows: readonly unknown[][]): string {
  const lines = [fields.map((field) => csvField(field.name)).join(",")];
  for (const row of rows) {
    lines.push(fields.map((field, i) => csvField(csvValue(row[i], field.dataType))).join(","));
  }
  // CRLF, per RFC 4180. Readers that do not care accept it anyway.
  return lines.join("\r\n") + "\r\n";
}

export const EXPORT_FORMATS: ExportFormat[] = [
  {
    id: "csv",
    label: "CSV",
    extension: "csv",
    mimeType: "text/csv;charset=utf-8",
    serialize: serializeCsv
  }
];

/** Hands the browser a file it did not fetch. */
export function downloadText(filename: string, mimeType: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Not synchronously: the click only *starts* the download, and revoking the
  // url in the same task has been enough to cancel it before it reads.
  setTimeout(() => URL.revokeObjectURL(url));
}
