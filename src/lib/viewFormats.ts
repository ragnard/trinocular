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
 * already uses: the menu is drawn from the list, and what a format draws is
 * a component it names, so base64 later is a `render`, a component if it
 * needs one, and an entry — nothing in the inspector, which mounts what it
 * is handed and never learns what kinds of value there are. `applies` is what
 * keeps the menu honest — an integer column is not offered JSON, and a field
 * with only one format on offer gets no picker at all.
 *
 * Detection deliberately is not a format. Decoding varbinary to text is not a
 * guess (there is no other way to show bytes), but the old "starts with `{\"`,
 * so pretty-print it" sniff in the inspector's caller was exactly the guess
 * this replaces: one that was right often enough to be relied on and wrong
 * with no way to say so.
 *
 * HTML and Markdown are drawn in a sandboxed frame rather than sanitised into
 * the pane: the point of the app's CSP is that a string in a result cell can
 * never become script, and the browser's own sandbox (no script, no forms, no
 * navigation, an origin that is nobody's) holds that line without a parser
 * of ours in front of it. The frame carries a policy of its own besides,
 * under which a document may request nothing: no image, no stylesheet, no
 * script, from anywhere — a `data:` image and inline styles are all it gets.
 */
import { marked } from "marked";
import type { Component } from "svelte";
import HtmlFrame from "./components/HtmlFrame.svelte";
import ImageValue from "./components/ImageValue.svelte";
import TextValue from "./components/TextValue.svelte";
import type { Field } from "./components/table/types";

/** What the row draws: a component and what to hand it. The inspector adds
 *  the field's display key as `title`, for the frame's and the image's sake. */
export interface View {
  component: Component<any>;
  props: Record<string, unknown>;
}

export interface Rendered {
  /** The value as text, which is what the per-field copy button hands over:
   *  the source of a document, and what `Text` would show for an image. */
  text: string;
  view: View;
}

const view = <P extends Record<string, unknown>>(component: Component<P>, props: P): View => ({
  component,
  props
});

export interface ViewFormat {
  id: string;
  /** What the menu offers. */
  label: string;
  /** Whether this is worth offering for a field. */
  applies(field: Field): boolean;
  render(value: unknown, field: Field): Rendered;
}

/** Beyond this a value is shown as it arrived rather than formatted: parsing
 *  and re-emitting half a megabyte to then show four thousand characters of it
 *  (`TextValue` caps what reaches the screen) is work nobody asked for. */
const FORMAT_LIMIT = 256_000;

/** Bytes beyond which a varbinary is not handed to the image decoder. */
const IMAGE_LIMIT = 16 * 1024 * 1024;

const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Remembered per byte array: the array is the same object for as long as the
 * selection is, and the inspector re-renders every row of it on any change,
 * so a megabyte of hex or base64 is not something to build again each time.
 */
function memo<T>(compute: (bytes: Uint8Array) => T): (bytes: Uint8Array) => T {
  const cache = new WeakMap<Uint8Array, T>();
  return (bytes) => {
    let value = cache.get(bytes);
    if (value === undefined) {
      value = compute(bytes);
      cache.set(bytes, value);
    }
    return value;
  };
}

/** Bytes as the text they spell, or as hex when they do not spell any. */
const decodeBytes = memo((bytes: Uint8Array): string => {
  try {
    return decoder.decode(bytes);
  } catch {
    return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
});

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const startsWith = (bytes: Uint8Array, at: number, ...magic: number[]) =>
  magic.every((b, i) => bytes[at + i] === b);

/**
 * The media type for the data URL. A browser sniffs an `<img>` for the raster
 * formats whatever it was told, so the only one that has to be right is SVG,
 * which is XML and is not sniffed; the rest are named so the row can say what
 * it is looking at.
 */
function imageType(bytes: Uint8Array): string {
  if (startsWith(bytes, 0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (startsWith(bytes, 0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(bytes, 0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (
    startsWith(bytes, 0, 0x52, 0x49, 0x46, 0x46) &&
    startsWith(bytes, 8, 0x57, 0x45, 0x42, 0x50)
  ) {
    return "image/webp";
  }
  if (startsWith(bytes, 0, 0x42, 0x4d)) return "image/bmp";
  if (startsWith(bytes, 0, 0x00, 0x00, 0x01, 0x00)) return "image/x-icon";
  if (startsWith(bytes, 4, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66)) return "image/avif";
  const head = new TextDecoder().decode(bytes.subarray(0, 512));
  if (/^\s*(<\?xml|<!--|<svg)/.test(head)) return "image/svg+xml";
  return "application/octet-stream";
}

const dataUrl = memo((bytes: Uint8Array) => `data:${imageType(bytes)};base64,${base64(bytes)}`);

function asText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Uint8Array) return decodeBytes(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** As text, with a note on why when it is not what was asked for. A value that
 *  came with newlines keeps them; one that did not is left to wrap, since
 *  `pre` on a single long line would give the pane a scrollbar. */
const asTextView = (text: string, note?: string, wrap = true): Rendered => ({
  text,
  view: view(TextValue, { text, pre: text.includes("\n"), note, wrap })
});

const NULL = asTextView("null");

const TEXT: ViewFormat = {
  id: "text",
  label: "Text",
  applies: () => true,
  render: (value) => asTextView(asText(value))
};

/** Text and bytes are the two things that can hold a document. Rows, arrays
 *  and maps are flattened before they get here, so nothing else can. */
const textual = (field: Field) => field.dataType === "string" || field.dataType === "binary";

const HEX_BYTES_PER_LINE = 8;

/** Bytes past which the dump stops: each line is 45 characters for 8 bytes,
 *  so this is already more than the expanded text cap will show. */
const HEX_LIMIT = 64 * 1024;

/** `hexdump -C` at eight bytes a line, which is what fits the pane. The last
 *  line is the length, as hexdump prints it, so an empty value still says
 *  something. */
function hexdump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += HEX_BYTES_PER_LINE) {
    const line = bytes.subarray(offset, offset + HEX_BYTES_PER_LINE);
    const hex = Array.from(line, (b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(line, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."));
    lines.push(
      `${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(HEX_BYTES_PER_LINE * 3 - 1)}  |${ascii.join("")}|`
    );
  }
  lines.push(bytes.length.toString(16).padStart(8, "0"));
  return lines.join("\n");
}

const encoder = new TextEncoder();

const HEX: ViewFormat = {
  id: "hex",
  label: "Hex",
  applies: textual,
  render: (value) => {
    if (value === null || value === undefined) return NULL;
    // A string is dumped as the UTF-8 it would be stored as, which is the
    // view that finds a BOM or a zero-width character that Text cannot show.
    const bytes = value instanceof Uint8Array ? value : encoder.encode(asText(value));
    if (bytes.length > HEX_LIMIT) {
      const note = `Showing the first ${HEX_LIMIT.toLocaleString()} of ${bytes.length.toLocaleString()} bytes`;
      return asTextView(hexdump(bytes.subarray(0, HEX_LIMIT)), note, false);
    }
    return asTextView(hexdump(bytes), undefined, false);
  }
};

const JSON_FORMAT: ViewFormat = {
  id: "json",
  label: "JSON",
  applies: textual,
  render: (value) => {
    if (value === null || value === undefined) return NULL;
    // Already structured: there is nothing to parse, only to indent.
    if (typeof value === "object" && !(value instanceof Uint8Array)) {
      return asTextView(JSON.stringify(value, null, 2));
    }
    const source = asText(value);
    if (source.length > FORMAT_LIMIT) return asTextView(source, "Too large to format");
    try {
      return asTextView(JSON.stringify(JSON.parse(source), null, 2));
    } catch {
      // Shown as it arrived, and said so. Drawing the raw string silently
      // would make the picker look broken rather than the value.
      return asTextView(source, "Not valid JSON");
    }
  }
};

/** A document in the sandboxed frame, with its source for the copy button. */
const asDocument = (text: string, html: string): Rendered => ({
  text,
  view: view(HtmlFrame, { html })
});

const HTML: ViewFormat = {
  id: "html",
  label: "HTML",
  applies: textual,
  render: (value) => {
    if (value === null || value === undefined) return NULL;
    const text = asText(value);
    if (text.length > FORMAT_LIMIT) return asTextView(text, "Too large to render");
    return asDocument(text, text);
  }
};

const MARKDOWN: ViewFormat = {
  id: "markdown",
  label: "Markdown",
  applies: textual,
  render: (value) => {
    if (value === null || value === undefined) return NULL;
    const text = asText(value);
    if (text.length > FORMAT_LIMIT) return asTextView(text, "Too large to render");
    try {
      return asDocument(text, marked.parse(text, { async: false, gfm: true }));
    } catch {
      return asTextView(text, "Could not render Markdown");
    }
  }
};

const IMAGE: ViewFormat = {
  id: "image",
  label: "Image",
  applies: (field) => field.dataType === "binary",
  render: (value) => {
    if (value === null || value === undefined) return NULL;
    if (!(value instanceof Uint8Array)) return asTextView(asText(value));
    // `text` is what Text would show: an image has no text of its own to
    // hand the copy button.
    const text = decodeBytes(value);
    if (value.length > IMAGE_LIMIT) return asTextView(text, "Too large to draw");
    return { text, view: view(ImageValue, { src: dataUrl(value) }) };
  }
};

export const VIEW_FORMATS: ViewFormat[] = [TEXT, HEX, JSON_FORMAT, MARKDOWN, HTML, IMAGE];

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

/** The value as the inspector shows it and copies it. Every value on screen
 *  goes through here. */
export function render(value: unknown, field: Field, id: string | undefined): Rendered {
  return resolveFormat(field, id).render(value, field);
}
