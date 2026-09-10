import type { Handle } from "@sveltejs/kit";

/**
 * The two response headers a CSP does not cover.
 *
 * `nosniff` matters more here than in most apps: the Trino proxy streams an
 * upstream body through with whatever `content-type` the cluster gave it, so
 * without this a cluster answering with something unexpected could have its
 * body sniffed into a type of the browser's choosing, on this app's origin.
 *
 * `Referrer-Policy: same-origin` because the app deliberately links out — the
 * `Details` link on a failed statement goes to the cluster's own web UI, at an
 * address that is not ours. Same-origin keeps the referrer for navigation
 * within the app and sends nothing at all across an origin, so the cluster's UI
 * never learns the URL of the page that linked to it.
 *
 * Clickjacking is already handled: the CSP in `svelte.config.ts` sets
 * `frame-ancestors 'none'`, which is the modern form of `X-Frame-Options` and
 * is what browsers consult when both are present.
 *
 * First in the sequence, so it wraps every response the handlers below return —
 * including the gate's 401 and 403. A thrown redirect is the exception: it
 * propagates past this handler for SvelteKit to turn into a response above us,
 * so it goes out without these. That is not worth contorting the sequence for,
 * a 303 carrying no body having nothing to sniff or leak.
 */
export const SecurityHeadersHandler = (): Handle => {
  return async ({ event, resolve }) => {
    const response = await resolve(event);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "same-origin");
    return response;
  };
};
