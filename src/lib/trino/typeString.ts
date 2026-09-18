/**
 * Reads the type *strings* that `SHOW COLUMNS` hands back — `row("a" integer,
 * "b" array(varchar))` and friends — into something the schema browser can
 * hang a tree off.
 *
 * This is deliberately not `table.ts`'s job. That one walks a `TypeSignature`,
 * the parsed structure Trino attaches to query *results*; the catalog only ever
 * reports a rendered string, and re-running each column through the engine to
 * recover the structure would mean a query per column.
 *
 * What Trino actually emits, verified against the engine rather than assumed:
 *
 *   row("a" integer, "b" varchar)          named fields, always quoted
 *   row(integer, varchar)                  anonymous fields, bare types
 *   row("has""quote" integer)              "" escapes a quote inside a name
 *   row("weird name.with dot" varchar)     names carry dots and spaces
 *   map(varchar, row("a" integer))
 *   array(row("a" integer))
 *   decimal(10,2)                          parameters, not fields
 *   timestamp(6) with time zone            words *after* the parameter list
 */

/** A child of a structured type: a row's field, or a map's key/value half. */
export interface TypeField {
  name: string;
  type: string;
}

export type TypeCategory =
  "row" | "array" | "map" | "numeric" | "text" | "temporal" | "binary" | "boolean" | "other";

/**
 * `varchar(255)` → base `varchar`, args `255`
 * `timestamp(6) with time zone` → base `timestamp`, args `6`
 * `row("a" integer)` → base `row`, args `"a" integer`
 * `interval day to second` → base `interval`, no args
 *
 * `base` is the first word, so the multi-word types (`double precision`,
 * `time with time zone`) land on the word that decides what they are.
 */
function decompose(type: string): { base: string; args: string | null } {
  const open = type.indexOf("(");
  const head = (open === -1 ? type : type.slice(0, open)).trim();
  const base = head.split(/\s+/, 1)[0].toLowerCase();
  if (open === -1) return { base, args: null };

  const close = matchingParen(type, open);
  if (close === -1) return { base, args: null };
  return { base, args: type.slice(open + 1, close) };
}

/** Index of the `)` closing the `(` at `open`, or -1 if the string is truncated. */
function matchingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      i = endOfQuoted(s, i);
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Index of the closing `"` of the quoted identifier starting at `start`,
 * or the last index if it never closes. `""` is an escaped quote, not the end.
 */
function endOfQuoted(s: string, start: number): number {
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] !== '"') continue;
    if (s[i + 1] === '"') i++;
    else return i;
  }
  return s.length - 1;
}

/** Splits an argument list at the commas that are not inside parens or quotes. */
function splitArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === '"') i = endOfQuoted(args, i);
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(args.slice(start).trim());
  return parts;
}

/**
 * Peels the field name off one `row` argument. A leading quote is the only
 * signal there is a name at all: Trino quotes every named field and leaves
 * anonymous ones as a bare type, so `"a" integer` is named and `integer` is not.
 */
function splitFieldName(arg: string): { name: string | null; type: string } {
  if (!arg.startsWith('"')) return { name: null, type: arg };
  const close = endOfQuoted(arg, 0);
  return {
    name: arg.slice(1, close).replaceAll('""', '"'),
    type: arg.slice(close + 1).trim()
  };
}

/**
 * The child nodes to show under a value of this type — empty for anything
 * without an inside.
 *
 * An array unwraps to its *element's* children rather than contributing a level
 * of its own, so `array(row("a" integer))` expands straight to `a`. The element
 * level would be a node per array that never says anything the parent's own
 * type text did not already say, and it would push every genuinely nested field
 * one indent further right for no information.
 */
export function typeChildren(type: string): TypeField[] {
  let children = childrenOf.get(type);
  if (!children) {
    children = parseChildren(type);
    // Bounded, so a session that browses a great many distinct types cannot
    // grow it without limit; a miss after a clear is one parse.
    if (childrenOf.size >= CHILDREN_CACHE_LIMIT) childrenOf.clear();
    childrenOf.set(type, children);
  }
  return children;
}

/**
 * Parsed once per distinct type string. The schema browser rebuilds its tree
 * whenever the cache learns something — a table's columns landing, say — and
 * every column already on screen is parsed again on the way; most of a cluster
 * shares a few hundred type strings, so this is the difference between a
 * rebuild that parses and one that looks up. The arrays are handed out shared,
 * and nobody writes to them.
 */
const childrenOf = new Map<string, TypeField[]>();
const CHILDREN_CACHE_LIMIT = 10_000;

function parseChildren(type: string): TypeField[] {
  const { base, args } = decompose(type);
  if (args === null || args.trim() === "") return [];

  switch (base) {
    case "row":
      return splitArgs(args).map((arg, i) => {
        const { name, type } = splitFieldName(arg);
        // Anonymous fields are read out of a row by position, so name them the
        // way you would have to reach them: `r[1]`.
        return { name: name ?? `[${i + 1}]`, type };
      });
    case "array":
      return typeChildren(args.trim());
    case "map": {
      const parts = splitArgs(args);
      if (parts.length !== 2) return [];
      return [
        { name: "key", type: parts[0] },
        { name: "value", type: parts[1] }
      ];
    }
    default:
      // decimal(10,2), varchar(255), timestamp(6): those parens hold
      // parameters, not fields.
      return [];
  }
}

/** Which icon a type gets, and nothing else — the tree draws no other meaning. */
export function typeCategory(type: string): TypeCategory {
  const { base } = decompose(type);
  switch (base) {
    case "row":
      return "row";
    case "array":
      return "array";
    case "map":
      return "map";
    case "tinyint":
    case "smallint":
    case "integer":
    case "int":
    case "bigint":
    case "real":
    case "double":
    case "decimal":
      return "numeric";
    case "varchar":
    case "char":
    case "json":
    case "uuid":
    case "ipaddress":
    case "ipprefix":
      return "text";
    case "date":
    case "time":
    case "timestamp":
    case "interval":
      return "temporal";
    case "varbinary":
      return "binary";
    case "boolean":
      return "boolean";
    default:
      return "other";
  }
}

/**
 * The type as a label for a node you can expand: the parts that are on screen
 * one click below are dropped, so `row` stands in for a whois column whose
 * full text runs to three hundred characters and would set the width of the
 * whole tree. The chevron beside it is what says there is more. Scalars are
 * left exactly as Trino wrote them — `decimal(10,2)` has nothing underneath
 * it, so there is nothing to defer.
 */
export function abbreviateType(type: string): string {
  const { base, args } = decompose(type);
  if (args === null) return type;

  switch (base) {
    case "row":
      return "row";
    case "array":
      return `array(${abbreviateType(args.trim())})`;
    case "map": {
      const parts = splitArgs(args);
      if (parts.length !== 2) return type;
      return `map(${abbreviateType(parts[0])}, ${abbreviateType(parts[1])})`;
    }
    default:
      return type;
  }
}
