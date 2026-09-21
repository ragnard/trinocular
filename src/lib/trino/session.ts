/**
 * A Trino session is nothing but headers the client carries: there is no
 * server-side session to speak of. `USE` answers with `X-Trino-Set-Catalog`
 * and `X-Trino-Set-Schema`, `SET SESSION` with `X-Trino-Set-Session`,
 * `PREPARE` with `X-Trino-Added-Prepare`, and it is the client's job to fold
 * each of those into what it sends next — which is why a client thrown away
 * after every statement made `USE` a statement that did nothing.
 *
 * This module is the pure half: what a response *changed* (`sessionDelta`),
 * folding that into a state (`applyDelta`), and the request headers a state
 * amounts to (`sessionHeaders`). No runes and no `$lib` imports, so `bun test`
 * can cover it; `TrinoSession.svelte.ts` is the reactive holder around it.
 *
 * The encoding is the Java client's: a property or a prepared statement
 * travels as `name=value` with the value URL-encoded, several of them as
 * several headers of the same name — which `fetch` hands back joined with
 * `, `, safe to split on because the encoding leaves no comma in a value —
 * and the request direction accepts the same list comma-joined in one header.
 */

export interface SessionState {
  readonly catalog?: string;
  readonly schema?: string;
  readonly path?: string;
  readonly timeZone?: string;
  /** Session properties, `SET SESSION`. Keys may be catalog-qualified. */
  readonly properties: Readonly<Record<string, string>>;
  /** Prepared statements by name, `PREPARE`. The value is the SQL. */
  readonly prepared: Readonly<Record<string, string>>;
}

export const EMPTY_SESSION: SessionState = Object.freeze({
  properties: Object.freeze({}),
  prepared: Object.freeze({})
});

/**
 * What one response asked the session to change. Absent means untouched.
 * `ignored` names the kinds of change this client deliberately does not carry
 * (see `IGNORED_HEADERS`), so the statement that asked can be told.
 */
export interface SessionDelta {
  readonly catalog?: string;
  readonly schema?: string;
  readonly path?: string;
  readonly timeZone?: string;
  readonly set: Readonly<Record<string, string>>;
  readonly clear: readonly string[];
  readonly prepared: Readonly<Record<string, string>>;
  readonly deallocated: readonly string[];
  readonly ignored: readonly IgnoredChange[];
}

export type IgnoredChange = "role" | "authorization" | "transaction";

/**
 * Session changes a response can carry that are *not* folded in, and why:
 *
 *  - roles: the proxy refuses to forward `X-Trino-Role` on purpose, since it
 *    selects a role inside a catalog's access control and the request must
 *    not get to say who to act as beyond what the gate established;
 *  - authorization: `SET AUTHORIZATION` is identity, which is the proxy's to
 *    set and nobody else's;
 *  - transactions: `X-Trino-Transaction-Id` is not forwarded either, and a
 *    transaction that spans statements is a feature of its own.
 *
 * Rather than silently succeeding — which is exactly the bug `USE` had — the
 * statement that asked is told, through `ignored`.
 */
const IGNORED_HEADERS: ReadonlyArray<[header: string, change: IgnoredChange]> = [
  ["x-trino-set-role", "role"],
  ["x-trino-set-authorization-user", "authorization"],
  ["x-trino-reset-authorization-user", "authorization"],
  ["x-trino-started-transaction-id", "transaction"],
  ["x-trino-clear-transaction-id", "transaction"]
];

/** Java's `URLEncoder` writes a space as `+`; `decodeURIComponent` does not read it. */
const decode = (value: string): string => decodeURIComponent(value.replace(/\+/g, " "));
const encode = (value: string): string => encodeURIComponent(value);

/** A `, `-joined multi-valued header as its values, trimmed and non-empty. */
function values(headers: Headers, name: string): string[] {
  const joined = headers.get(name);
  if (!joined) return [];
  return joined
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** `name=encoded` entries as a map, with the value decoded. */
function pairs(headers: Headers, name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of values(headers, name)) {
    const eq = entry.indexOf("=");
    if (eq === -1) continue;
    out[entry.slice(0, eq).trim()] = decode(entry.slice(eq + 1).trim());
  }
  return out;
}

/** What `headers` asked the session to change, or null if nothing. */
export function sessionDelta(headers: Headers): SessionDelta | null {
  const catalog = headers.get("x-trino-set-catalog") ?? undefined;
  const schema = headers.get("x-trino-set-schema") ?? undefined;
  const path = headers.get("x-trino-set-path") ?? undefined;
  const timeZone = headers.get("x-trino-set-time-zone") ?? undefined;
  const set = pairs(headers, "x-trino-set-session");
  const clear = values(headers, "x-trino-clear-session");
  const prepared = pairs(headers, "x-trino-added-prepare");
  const deallocated = values(headers, "x-trino-deallocated-prepare");
  const ignored: IgnoredChange[] = [];
  for (const [header, change] of IGNORED_HEADERS) {
    if (headers.has(header) && !ignored.includes(change)) ignored.push(change);
  }

  const empty =
    catalog === undefined &&
    schema === undefined &&
    path === undefined &&
    timeZone === undefined &&
    Object.keys(set).length === 0 &&
    clear.length === 0 &&
    Object.keys(prepared).length === 0 &&
    deallocated.length === 0 &&
    ignored.length === 0;
  if (empty) return null;

  return { catalog, schema, path, timeZone, set, clear, prepared, deallocated, ignored };
}

/** `state` with `delta` folded in. A new object: the state is held in a
 *  `$state.raw`, which notices a change by reference. */
export function applyDelta(state: SessionState, delta: SessionDelta): SessionState {
  const properties = { ...state.properties };
  for (const key of delta.clear) delete properties[key];
  Object.assign(properties, delta.set);

  const prepared = { ...state.prepared };
  for (const name of delta.deallocated) delete prepared[name];
  Object.assign(prepared, delta.prepared);

  return {
    catalog: delta.catalog ?? state.catalog,
    schema: delta.schema ?? state.schema,
    path: delta.path ?? state.path,
    timeZone: delta.timeZone ?? state.timeZone,
    properties,
    prepared
  };
}

/** The request headers `state` amounts to. Only what is set is named. */
export function sessionHeaders(state: SessionState): Record<string, string> {
  const headers: Record<string, string> = {};
  if (state.catalog) headers["X-Trino-Catalog"] = state.catalog;
  if (state.schema) headers["X-Trino-Schema"] = state.schema;
  if (state.path) headers["X-Trino-Path"] = state.path;
  if (state.timeZone) headers["X-Trino-Time-Zone"] = state.timeZone;
  const properties = Object.entries(state.properties);
  if (properties.length > 0) {
    headers["X-Trino-Session"] = properties.map(([k, v]) => `${k}=${encode(v)}`).join(",");
  }
  const prepared = Object.entries(state.prepared);
  if (prepared.length > 0) {
    headers["X-Trino-Prepared-Statement"] = prepared.map(([k, v]) => `${k}=${encode(v)}`).join(",");
  }
  return headers;
}

/** True when there is nothing to reset. */
export function isEmptySession(state: SessionState): boolean {
  return (
    !state.catalog &&
    !state.schema &&
    !state.path &&
    !state.timeZone &&
    Object.keys(state.properties).length === 0 &&
    Object.keys(state.prepared).length === 0
  );
}

/** What a statement is told about a change that was not carried. */
export function describeIgnored(change: IgnoredChange): string {
  switch (change) {
    case "role":
      return "SET ROLE is not carried between statements: the proxy does not forward roles.";
    case "authorization":
      return "SET AUTHORIZATION is not carried between statements: who a query runs as is set by the server.";
    case "transaction":
      return "Transactions are not carried between statements; each statement runs on its own.";
  }
}
