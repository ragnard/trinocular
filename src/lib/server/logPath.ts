/**
 * What a log line says a request was *for*: the path, and never the query
 * string.
 *
 * Not a rule about one parameter but about all of them. A query string is the
 * channel a secret ends up in by accident, and this server already has two:
 * the OIDC callback arrives as `/auth/callback?code=…&state=…`, so an
 * authorization code was being written to the log at info on every login, and
 * the gate's redirect to `/auth/login?returnTo=…` carries whatever the visitor
 * was asking for — which, with `?sql=` links, is a query somebody wrote, often
 * with the literals that make it worth running. Neither is severe on its own
 * (a code is single-use and worthless without the PKCE verifier and the client
 * secret), and that is rather the point: the next parameter nobody remembers
 * is the one a denylist would miss. Dropping the lot is the only version of
 * this rule that does not rot.
 *
 * Nothing is lost that these lines are read for. Which request, what happened,
 * who and which one to quote in a bug report are the method, the path, the
 * status, `request_id` and `user_id`. A parameter that genuinely helps a
 * diagnosis gets logged as its own named field, deliberately, by whoever needs
 * it.
 *
 * The field it feeds is still called `url`, and still carries the origin for
 * an absolute one, so that log queries written against it go on working.
 */

/** A base for the relative URLs this is also handed — a redirect's `location`
 *  is usually `/auth/login?…`. `.invalid` is reserved by RFC 2606, so no real
 *  request can arrive claiming this origin and be mistaken for a relative one. */
const RELATIVE_BASE = "http://relative.invalid";

export const logPath = (url: string): string => {
  try {
    const parsed = new URL(url, RELATIVE_BASE);
    return parsed.origin === RELATIVE_BASE ? parsed.pathname : parsed.origin + parsed.pathname;
  } catch {
    // Never the input: a URL that will not parse is exactly the one whose
    // contents there is no reason to trust with a log file.
    return "";
  }
};
