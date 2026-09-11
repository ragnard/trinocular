/**
 * How the inspector draws a value, and how much of it.
 *
 * A varchar column holding a JSON document is the case this exists for: the
 * type says `varchar`, the string says `{"...`, and only the person reading it
 * knows which of those to believe. So the choice is theirs — per field,
 * remembered with the document in `SqlFile.viewFormats`. It is picked against
 * the field's *path* (`items[3].meta`) rather than against the value, so it
 * holds for that field in every row until it is picked again — but the path
 * keeps its array indices, because the elements of a varchar array need not
 * agree about what they hold.
 *
 * A format is one entry in `VIEW_FORMATS`, the arrangement `EXPORT_FORMATS`
 * already uses: the menu is drawn from the list, so hex, base64 or markdown
 * later is a `render` and an entry and nothing in the UI. `applies` is what
 * keeps the menu honest — an integer column is not offered JSON, and a field
 * with only one format on offer gets no picker at all.
 *
 * Detection deliberately is not a format. Decoding varbinary to text is not a
 * guess (there is no other way to show bytes), but the old "starts with `{\"`,
 * so pretty-print it" sniff in the inspector's caller was exactly the guess
 * this replaces: one that was right often enough to be relied on and wrong
 * with no way to say so.
 */
import type { Field } from "./components/table/types";
import { fromBase64 } from "./trino/table";

export interface Rendered {
  text: string;
  /** Whitespace is meaningful: the value goes in a `<pre>`. */
  pre?: boolean;
  /** Why what you asked for is not what you got. */
  note?: string;
}

export interface ViewFormat {
  id: string;
  /** What the menu offers. */
  label: string;
  /** Whether this is worth offering for a field. */
  applies(field: Field): boolean;
  render(value: unknown, field: Field): Rendered;
}

/**
 * How much of a value reaches the DOM, whatever format produced it — the one
 * cap, applied on the one path out, rather than a rule each format is trusted
 * to remember. A single varchar can be megabytes and a selection is a whole
 * block of them, laid out unvirtualised, so without this one cell decides how
 * long the inspector takes to draw.
 *
 * It is a display cap and nothing else: `render` still returns the whole value
 * and the row's copy button still hands over all of it. `EXPANDED` is what one
 * click gives you, and is still a cap — past it the browser, not the value, is
 * what you would be waiting for.
 */
export const DISPLAY_LIMIT = 4_000;
export const EXPANDED_LIMIT = 500_000;

/** Beyond this a value is shown as it arrived rather than formatted: parsing
 *  and re-emitting half a megabyte to then show four thousand characters of it
 *  is work nobody asked for. */
const FORMAT_LIMIT = 256_000;

const decoder = new TextDecoder("utf-8", { fatal: true });

/** Bytes as the text they spell, or as hex when they do not spell any. */
function decodeBytes(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch {
    return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
}

/**
 * The value as the inspector received it: what Trino sent, so a varbinary is
 * still its base64 here and is decoded by the field's type, not by sniffing
 * the value. That is what lets the row's copy buttons hand over base64 — the
 * table's `getData` does not convert, for the same reason `export.ts` does not.
 */
function asText(value: unknown, field: Field): string {
  if (value === null || value === undefined) return "null";
  if (field.dataType === "binary" && typeof value === "string") {
    return decodeBytes(fromBase64(value));
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** A value that came with newlines keeps them; one that did not is left to
 *  wrap, since `pre` on a single long line would give the pane a scrollbar. */
const preserve = (text: string): Rendered => ({ text, pre: text.includes("\n") });

const TEXT: ViewFormat = {
  id: "text",
  label: "Text",
  applies: () => true,
  render: (value, field) => preserve(asText(value, field))
};

const JSON_FORMAT: ViewFormat = {
  id: "json",
  label: "JSON",
  // Text and bytes are the two things that can hold a JSON document. Rows,
  // arrays and maps are flattened before they get here, so nothing else can.
  applies: (field) => field.dataType === "string" || field.dataType === "binary",
  render: (value, field) => {
    if (value === null || value === undefined) return { text: "null" };
    // Already structured: there is nothing to parse, only to indent.
    if (typeof value === "object") {
      return { text: JSON.stringify(value, null, 2), pre: true };
    }
    const source = asText(value, field);
    if (source.length > FORMAT_LIMIT) {
      return { ...preserve(source), note: "Too large to format" };
    }
    try {
      return { text: JSON.stringify(JSON.parse(source), null, 2), pre: true };
    } catch {
      // Shown as it arrived, and said so. Drawing the raw string silently
      // would make the picker look broken rather than the value.
      return { ...preserve(source), note: "Not valid JSON" };
    }
  }
};

export const VIEW_FORMATS: ViewFormat[] = [TEXT, JSON_FORMAT];

/**
 * Whether a stored key is one element of what `path` names — `items[3].meta`
 * under `items[].meta` — so that choosing for an array can clear the elements
 * that were chosen out of it one at a time.
 *
 * The inspector does not need this: `flatten` builds both strings as it goes
 * and knows which brackets it put there. This is for the stored map, where all
 * that is left is the strings. Only the `[]` positions become wildcards and
 * everything else is matched literally, so the only way to sweep a key that is
 * not an element is to have a column named `x[1]` beside an array named `x`.
 */
export function underPath(key: string, path: string): boolean {
  if (!path.includes("[]")) return false;
  const literal = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${path.split("[]").map(literal).join("\\[\\d+\\]")}$`).test(key);
}

export const DEFAULT_FORMAT = TEXT.id;

/** What the picker offers for a field. Fewer than two means no picker. */
export function formatsFor(field: Field): ViewFormat[] {
  return VIEW_FORMATS.filter((format) => format.applies(field));
}

/**
 * The format a field is actually drawn with. An id that no longer exists, or
 * one that does not apply to this field, reads as the default rather than as
 * an error: a stored choice outlives the query it was made against, and the
 * column called `payload` may well be an integer next time.
 */
export function resolveFormat(field: Field, id: string | undefined): ViewFormat {
  return formatsFor(field).find((format) => format.id === id) ?? TEXT;
}

export function render(value: unknown, field: Field, id: string | undefined): Rendered {
  return resolveFormat(field, id).render(value, field);
}

export interface Display extends Rendered {
  /** Characters of the full text, so the note can say what is missing. */
  total: number;
  truncated: boolean;
  /** Whether asking for more would actually show more. */
  expandable: boolean;
}

/** The value as the inspector shows it: rendered by the chosen format, then
 *  cut to the cap. Every value on screen goes through here. */
export function display(
  value: unknown,
  field: Field,
  id: string | undefined,
  expanded = false
): Display {
  const rendered = render(value, field, id);
  const limit = expanded ? EXPANDED_LIMIT : DISPLAY_LIMIT;
  const total = rendered.text.length;
  if (total <= limit) {
    return { ...rendered, total, truncated: false, expandable: false };
  }
  return {
    ...rendered,
    text: rendered.text.slice(0, limit),
    total,
    truncated: true,
    expandable: !expanded
  };
}
