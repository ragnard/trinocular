/**
 * A link into the app that carries a query: `/?sql=SELECT%201`, with an
 * optional `name` for the document it opens. It is how another system — a
 * catalog, a dashboard, anything that generates SQL — puts an "Open in
 * Trinocular" button next to what it generated.
 *
 * The link opens the SQL as a **new document and never runs it**, and there is
 * deliberately no parameter that would: a link is something anyone can send,
 * the statements it carries run as whoever clicked it, and the one thing
 * standing between a link and somebody's warehouse is that a person has to
 * read the query and press Run. It is always a *new* document for the same
 * reason: a link must never be able to append to or replace what somebody is
 * editing.
 *
 * A query param rather than a `#sql=` fragment, although a fragment would keep
 * the SQL off the server entirely: the fragment does not survive the OIDC
 * round trip, so a link clicked by somebody not signed in would land them in
 * an empty editor. The query string does survive it — the gate puts the whole
 * path and query in `returnTo` — which is the case that matters, since a link
 * is most often followed by someone who is not already here. What the server
 * must then not do is write it down, which is why nothing logs a query string.
 */

/** The parameters a link may carry. Nothing here ever runs anything. */
export const SQL_PARAM = "sql";
export const NAME_PARAM = "name";

/**
 * The most SQL a link may carry. Node refuses a request whose headers exceed
 * 16KB — the request line included — so a longer link is answered by the
 * runtime with a 431 long before this, and in the ordinary deployment this cap
 * never fires. It is here for the one behind something with a larger limit,
 * and it *refuses* rather than truncates: half a statement is not a shorter
 * version of that statement, and cutting the tail off `DELETE FROM t WHERE id
 * = 3` leaves a statement that is still perfectly valid SQL and means
 * something else entirely.
 */
export const MAX_SQL_LENGTH = 16 * 1024;

/** A document name is a label in the header and the switcher, nothing more. */
export const MAX_NAME_LENGTH = 80;

export type LinkedQuery =
  | { ok: true; sql: string; name: string | null }
  /** Carried rather than thrown away, because the alternative to saying so is
   *  an empty editor that reads as a link that worked. */
  | { ok: false; reason: string };

/**
 * A name fit to draw: one line, no control characters, and bounded. It is
 * rendered as text by svelte wherever it appears, so this is not an escape —
 * it is what keeps a newline or a kilobyte of runes out of the file switcher.
 */
const cleanName = (raw: string): string | null => {
  const flat = raw.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
  return flat ? flat.slice(0, MAX_NAME_LENGTH) : null;
};

/** What a link asked for, or null when it asked for nothing. */
export const linkedQuery = (params: URLSearchParams): LinkedQuery | null => {
  const sql = params.get(SQL_PARAM);
  if (sql === null) return null;
  if (sql.length > MAX_SQL_LENGTH) {
    return { ok: false, reason: "The query in this link is too large to open." };
  }
  // An empty `?sql=` is a generator that produced nothing, not a request for
  // an empty document: there is already a way to make one of those.
  if (!sql.trim()) return null;
  return { ok: true, sql, name: cleanName(params.get(NAME_PARAM) ?? "") };
};

/** The same URL with the link's parameters taken off, so that a reload does
 *  not open the query a second time and the SQL does not sit in the address
 *  bar and the session history for the rest of the day. */
export const withoutLinkParams = (url: URL): URL => {
  const next = new URL(url);
  next.searchParams.delete(SQL_PARAM);
  next.searchParams.delete(NAME_PARAM);
  return next;
};
