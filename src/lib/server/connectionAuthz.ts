import { config } from "./config";
import { createAuthorizer, type Authorizer } from "./authz";
import { logger } from "./logging";
import type { Identity } from "./identity";

/**
 * Who may use which cluster.
 *
 * A connection's `authz` is the same vocabulary as the application-wide one —
 * `allow`, `require-role`, the same claim paths — because a policy is a policy
 * and there was no reason to invent a second way of writing one. What differs
 * is only what it governs.
 *
 * It **narrows, never widens**. The application-wide rule has already run in
 * `AccessHandler` by the time anything here is asked, and a connection rule is
 * a second condition on top of it. That direction is the whole safety property:
 * adding a rule to a connection can lock people out of that cluster but can
 * never let somebody past the front door, so a connection block is never a way
 * to accidentally grant access. A connection with no `authz` therefore adds no
 * condition of its own — which is not "anyone", since the top-level policy
 * still applied.
 *
 * The authorizers are built once, at startup, so a policy that cannot be built
 * exits the process then rather than refusing everybody at runtime with
 * nothing said about why.
 */
const authorizers = new Map<string, Authorizer>();

for (const [id, connection] of Object.entries(config.connections ?? {})) {
  if (!connection.authz) continue;
  authorizers.set(
    id,
    createAuthorizer(connection.authz, {
      defaultClient: config.authn.kind === "oidc" ? config.authn.clientId : undefined,
      where: `connection "${id}"`
    })
  );
}

/**
 * Logs what each connection's policy came out as, and — the reason it is a
 * function that `hooks.server.ts` calls rather than a line at the bottom of
 * this file — forces this module to be evaluated during startup.
 *
 * Nothing else imports it except the layout load and the proxy route, both of
 * which SvelteKit loads lazily on first use. Left to those, the authorizers
 * above would be built on the first request that happened to touch one, and a
 * policy that cannot be built would take the process down *then*, mid-request,
 * rather than refusing to start. Which is the failure this was written to
 * avoid, so it has to be reached from the startup path to mean anything.
 */
export function logConnectionAuthz(): void {
  if (authorizers.size === 0) return;
  logger.info(
    { connections: Object.fromEntries([...authorizers].map(([id, a]) => [id, a.name])) },
    "per-connection authz configured"
  );
}

/**
 * Whether this identity may use this connection. Unknown ids are refused: an
 * id the config does not declare has nothing to check a policy against, and
 * treating it as unconstrained would make a typo the way past every rule.
 */
export function mayUseConnection(identity: Identity, connectionId: string): boolean {
  if (!config.connections?.[connectionId]) return false;
  const authorizer = authorizers.get(connectionId);
  if (!authorizer) return true;
  return authorizer.authorize(identity).allowed;
}

/** The refusal reason, for the log only — never the response. It names claims
 *  the user cannot change and would tell an attacker which role to ask for. */
export function connectionDenialReason(identity: Identity, connectionId: string): string {
  const authorizer = authorizers.get(connectionId);
  if (!authorizer) return "no such connection";
  const decision = authorizer.authorize(identity);
  return decision.allowed ? "allowed" : decision.reason;
}

/** What the browser is told about a connection: enough to list it and to
 *  address the proxy, and nothing about its policy. */
export interface ClientConnection {
  id: string;
  name: string;
}

/**
 * The connections this identity may actually use, in config order.
 *
 * The browser is given only these. Listing a cluster somebody cannot query
 * would be a menu of things that answer 403 — and worse than cosmetic, because
 * `Workspace` heals a file pointing at an unknown connection back to the
 * *first* one in the list. If a forbidden connection were listed it could
 * become that default, and every document would come up aimed at a cluster
 * that refuses it.
 */
export function visibleConnections(identity: Identity | undefined): ClientConnection[] {
  if (!identity) return [];
  return Object.entries(config.connections ?? {})
    .filter(([id]) => mayUseConnection(identity, id))
    .map(([id, connection]) => ({ id, name: connection.name }));
}
