import {
  EMPTY_SESSION,
  applyDelta,
  isEmptySession,
  type SessionDelta,
  type SessionState
} from "./session";

/**
 * The session one connection's statements run in, kept by the workspace for
 * the life of the page and outliving every run: each run's client starts
 * from `state` and folds what its responses changed back in through `apply`.
 *
 * One per connection and not one for the workspace, because `USE tpch.tiny`
 * on one cluster says nothing about a cluster that has no `tpch` — the same
 * reason the catalog tree is kept per connection. Session-only, like results:
 * a reload starts clean, as reopening the CLI does, rather than a `USE` from
 * last week silently re-pointing today's unqualified names.
 *
 * `state` is `$state.raw` and `applyDelta` returns a new object, so a change
 * is noticed by reference; nothing here is mutated in place.
 */
export class TrinoSession {
  state: SessionState = $state.raw(EMPTY_SESSION);

  apply(delta: SessionDelta) {
    this.state = applyDelta(this.state, delta);
  }

  reset() {
    this.state = EMPTY_SESSION;
  }

  empty: boolean = $derived(isEmptySession(this.state));

  /** `catalog.schema`, `catalog`, or nothing — what an unqualified name resolves against. */
  location: string | undefined = $derived.by(() => {
    const { catalog, schema } = this.state;
    if (catalog && schema) return `${catalog}.${schema}`;
    return catalog ?? undefined;
  });

  /** One line per thing set, for a tooltip. */
  summary: string[] = $derived.by(() => {
    const { catalog, schema, path, timeZone, properties, prepared } = this.state;
    const lines: string[] = [];
    if (catalog) lines.push(`catalog: ${catalog}`);
    if (schema) lines.push(`schema: ${schema}`);
    if (path) lines.push(`path: ${path}`);
    if (timeZone) lines.push(`time zone: ${timeZone}`);
    for (const [k, v] of Object.entries(properties)) lines.push(`${k} = ${v}`);
    for (const name of Object.keys(prepared)) lines.push(`prepared: ${name}`);
    return lines;
  });
}
