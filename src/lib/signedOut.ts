/**
 * What the browser does with a 401: the session is gone — it reached
 * `maxLifetimeSeconds`, or was signed out in another tab — and every request
 * this page can make will be refused the same way, so the page goes to login
 * and comes back here afterwards. The Trino proxy and the file store sit
 * behind one gate and answer with the same status, and this is the one place
 * either answer is turned into a navigation: a result that meets it stops
 * polling, and the save queue stops retrying (`SaverHooks.signedOut`), since
 * asking again would not change the answer — before this the file store's
 * 401 was retried with backoff forever behind `Not saved`.
 *
 * The login path is the gate's own, from layout data: `/auth/login` is the
 * password form, while OIDC's login trigger lives under `paths.prefix`, so a
 * hard-coded path sent one of them to the wrong page. `page` may be read at
 * any time in the browser, and every caller here runs after the page has
 * rendered — `+page.ts` runs before it and is the one caller that lets a 401
 * throw instead, since the gate has just let that navigation through.
 */

import { page } from "$app/state";
import { HttpError } from "$lib/trino";

/** True when the error was a 401, in which case the page is on its way to
 *  login and the caller should stop. */
export function signedOut(e: unknown): boolean {
  if (!(e instanceof HttpError && e.status === 401)) return false;
  const returnTo = window.location.pathname + window.location.search;
  window.location.href = `${page.data.loginPath}?returnTo=${encodeURIComponent(returnTo)}`;
  return true;
}
