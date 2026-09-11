/**
 * Saving a result to a file, entirely in the browser: the rows are already
 * here, and asking the cluster to run the query a second time to render it
 * would be a different query — a different snapshot, a different cost, and a
 * second thing that can fail — for bytes we are already holding.
 *
 * A format is one entry in `EXPORT_FORMATS`. The menu is drawn from that list,
 * so adding ndjson later is a serializer and an entry, and nothing in the UI.
 */
import type { DataType, Dictionary, Field, Struct } from "./components/table/types";
import { toBase64 } from "./trino/table";

export interface ExportFormat {
  id: string;
  /** What the menu offers. */
  label: string;
  /** Appended to the query id to name the file. */
  extension: string;
  mimeType: string;
  /**
   * The rows as the result holds them. Only one thing in them is not already
   * a JSON value — a varbinary, decoded to a `Uint8Array` when its page
   * arrived — and `toJson` is where it becomes base64 again, which is what it
   * arrived as and what any reader on the other side will expect back.
   */
  serialize(fields: Field[], rows: Iterable<readonly unknown[]>): string;
}

function isStruct(dataType: DataType): dataType is Struct {
  return typeof dataType === "object" && !Array.isArray(dataType) && "fields" in dataType;
}

function isDictionary(dataType: DataType): dataType is Dictionary {
  return typeof dataType === "object" && !Array.isArray(dataType) && "key" in dataType;
}

/**
 * A value shaped for JSON. Trino sends a row as an *array* of its field
 * values, so the names only exist in the type — putting them back is the
 * difference between `[1,"x"]` and `{"a":1,"b":"x"}`, and only one of those can
 * be read without the query beside it. Arrays recurse into their element type,
 * and a map — already a JSON object, keys and all — into its value type, so a
 * row inside one gets its names back too. Bytes become base64, at whatever
 * depth they sit: this is the one place a value is encoded to leave, and the
 * inspector's row copies come through it for the same reason the files do.
 */
export function toJson(value: unknown, dataType: DataType): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return toBase64(value);
  if (isStruct(dataType) && Array.isArray(value)) {
    return Object.fromEntries(
      dataType.fields.map((field, i) => [field.name, toJson(value[i], field.dataType)])
    );
  }
  if (Array.isArray(dataType) && Array.isArray(value)) {
    return value.map((element) => toJson(element, dataType[0]));
  }
  if (isDictionary(dataType) && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, toJson(v, dataType.value)])
    );
  }
  return value;
}

/** `,` `"` and the line endings are the whole of what CSV reserves. */
const CSV_RESERVED = /[",\r\n]/;

/**
 * The characters a spreadsheet reads as "this cell is a formula" rather than
 * text. Excel, LibreOffice and Sheets all evaluate a cell opening with one of
 * these, so `=HYPERLINK(...)` or `=cmd|'/c calc'!A0` sitting in a varchar
 * column is code that runs when somebody opens the file — the value came out
 * of a shared warehouse, where the person who wrote the row and the person who
 * exports it need not be the same person.
 */
const CSV_FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * A number, written the way a number is written. `-3` and `+1.5e9` open with a
 * character from the list above and are not formulas, and a numeric column is
 * mostly what a `-` at the front of a cell actually is — escaping those would
 * turn every negative figure in the file into text, which is a worse file than
 * the one the escape was protecting.
 */
const CSV_PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Quoting is not the defence: a spreadsheet strips the quotes and evaluates
 * what is inside. A leading apostrophe is, because that is the escape those
 * programs already use for "treat this as text", and it is what they strip
 * back off on display. It does mean the CSV holds a byte the query did not
 * return — which is why it is spent only on the cells that would otherwise be
 * executable, and why ndjson, where the question does not arise, is the format
 * to reach for when the file is going somewhere that will parse it.
 */
function csvField(text: string): string {
  const executable = CSV_FORMULA_LEAD.test(text) && !CSV_PLAIN_NUMBER.test(text);
  const escaped = executable ? `'${text}` : text;
  return CSV_RESERVED.test(escaped) ? `"${escaped.replaceAll('"', '""')}"` : escaped;
}

/**
 * Anything with an inside becomes JSON — a row, an array, a map. Bytes are the
 * exception, being one value and not a structure: they go in as base64, bare.
 * `JSON.stringify` without an indent argument emits no newline of its own and
 * escapes any newline inside a string, so a nested value stays on the one
 * line its cell occupies.
 *
 * A null becomes an empty field, which CSV cannot tell from an empty string.
 * That ambiguity is CSV's, and quoting nulls instead would only move it.
 */
function csvValue(value: unknown, dataType: DataType): string {
  if (value === null || value === undefined) return "";
  const json = toJson(value, dataType);
  return typeof json === "object" ? JSON.stringify(json) : String(json);
}

function csvRow(fields: Field[], row: readonly unknown[]): string {
  return fields.map((field, i) => csvField(csvValue(row[i], field.dataType))).join(",");
}

function serializeCsv(fields: Field[], rows: Iterable<readonly unknown[]>): string {
  const lines = [fields.map((field) => csvField(field.name)).join(",")];
  for (const row of rows) {
    lines.push(csvRow(fields, row));
  }
  // CRLF, per RFC 4180. Readers that do not care accept it anyway.
  return lines.join("\r\n") + "\r\n";
}

/**
 * What copying the table's selection puts on the clipboard. One cell is the
 * value and nothing else — no quoting, no formula escape — because a cell is
 * copied to be pasted somewhere as itself; a value with an inside is JSON,
 * as it would be in a file. Anything larger is CSV rows without the header
 * line: the header was not selected, and a block pasted beside other data
 * should not bring a title row with it.
 */
export function clipboardText(fields: Field[], rows: readonly (readonly unknown[])[]): string {
  if (rows.length === 1 && fields.length === 1) return csvValue(rows[0][0], fields[0].dataType);
  return rows.map((row) => csvRow(fields, row)).join("\n");
}

/**
 * One JSON object per row, one row per line. Nothing is flattened or rendered
 * on the way out: a row is an object, an array is an array, all the way down,
 * which is the reason to pick this format over CSV — CSV has one dimension and
 * has to spend a quoted string on anything that has two.
 *
 * Two columns of the same name (`SELECT a, a`) collapse into one key, since an
 * object cannot hold both. Trino allows it; JSON does not; CSV is the format
 * that can carry it.
 */
function serializeNdjson(fields: Field[], rows: Iterable<readonly unknown[]>): string {
  const lines: string[] = [];
  for (const row of rows) {
    const object: Record<string, unknown> = {};
    fields.forEach((field, i) => {
      object[field.name] = toJson(row[i], field.dataType);
    });
    lines.push(JSON.stringify(object));
  }
  // Trailing newline: every line is terminated, so appending to the file or
  // `cat`ing two of them together cannot fuse two records into one.
  return lines.length ? lines.join("\n") + "\n" : "";
}

export const EXPORT_FORMATS: ExportFormat[] = [
  {
    id: "csv",
    label: "CSV",
    extension: "csv",
    mimeType: "text/csv;charset=utf-8",
    serialize: serializeCsv
  },
  {
    id: "ndjson",
    label: "NDJSON",
    extension: "ndjson",
    mimeType: "application/x-ndjson;charset=utf-8",
    serialize: serializeNdjson
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
