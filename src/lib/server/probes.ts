import type { Handle } from "@sveltejs/kit";

import type { FileStore } from "./fileStore";
import { logger } from "./logging";
import type { SessionStore } from "./sessionStore";

export const LIVEZ_PATH = "/livez";
export const READYZ_PATH = "/readyz";

/** How long readiness waits on the store before calling it not ready. Shorter
 *  than the store's own command timeout on purpose: a kubelet's default
 *  `timeoutSeconds` is 1, and a store that takes seconds to answer a ping is
 *  not one this replica can serve requests from anyway. */
const READY_DEADLINE_MS = 2_000;

const withDeadline = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms}ms`)), ms);
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e))
    );
  });

const probeResponse = (status: number, body: unknown, method: string): Response =>
  new Response(method === "HEAD" ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });

/**
 * The Kubernetes probes, answered here rather than by routes so that they are
 * answered by as little of the server as possible.
 *
 * Liveness asks whether the process should be restarted, and the only honest
 * yes is "it no longer answers HTTP" — so `/livez` consults nothing. A store
 * outage must not fail it: restarting a pod does not bring Valkey back, and a
 * fleet restarting in a loop is how a store outage becomes an app outage.
 *
 * Readiness asks whether this replica should be receiving traffic, and the
 * dependencies a request here cannot do without are the stores this replica
 * holds open — every OIDC request reads the session, every save writes a
 * file, and a `load` that rejects is a 500. The Trino
 * clusters and the identity provider are deliberately *not* checked: they are
 * shared by every replica, so failing readiness on them would take every
 * replica out of rotation together and turn "cannot run a query" into "cannot
 * reach the site", for the people already signed in included. The probe hands
 * back which check failed and nothing more; the reason goes to the log, the
 * same way the access gate treats a denial.
 *
 * It sits before the session handler so a probe is never issued a cookie and
 * never has authn read the store on its behalf — which for liveness would make
 * the probe depend on the very thing it must not — and before the logging
 * handler so that two probes every ten seconds are not most of the log. What
 * is worth writing down, a refused readiness and why, this handler writes
 * itself.
 */
export const ProbeHandler = (store: SessionStore, fileStore: FileStore | null = null): Handle => {
  const log = logger.child({ component: "probes" });
  // Each dependency a request cannot be served without, by the name the body
  // reports it under. Null means there is nothing to reach.
  const checks: [name: string, ping: (() => Promise<void>) | undefined][] = [
    ["sessionStore", store.ping?.bind(store)],
    ["fileStore", fileStore?.ping?.bind(fileStore)]
  ];

  return async ({ event, resolve }) => {
    const { pathname } = event.url;
    if (pathname !== LIVEZ_PATH && pathname !== READYZ_PATH) return await resolve(event);

    const { method } = event.request;
    if (method !== "GET" && method !== "HEAD") {
      return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
    }

    if (pathname === LIVEZ_PATH) {
      return probeResponse(200, { status: "ok" }, method);
    }

    const results: Record<string, "ok" | "failed"> = {};
    for (const [name, ping] of checks) {
      try {
        if (ping) await withDeadline(ping(), READY_DEADLINE_MS);
        results[name] = "ok";
      } catch (err) {
        log.warn({ err, check: name }, "not ready: store did not answer");
        results[name] = "failed";
      }
    }
    const ready = Object.values(results).every((r) => r === "ok");
    return probeResponse(
      ready ? 200 : 503,
      { status: ready ? "ok" : "unavailable", checks: results },
      method
    );
  };
};
