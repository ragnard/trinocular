import type { ConnectionAuth } from "./config";

/**
 * The credential a proxied request carries to the cluster: the principal its
 * authenticator sees, as distinct from the user the query runs as (which is
 * always `X-Trino-User`, set by the proxy from the gate's identity and never
 * decided here).
 *
 * `none` sends nothing. `basic` is the connection's service account, and the
 * cluster then impersonates the user on its behalf, subject to its own
 * access control. `user-token` is the signed-in user's own OIDC access token —
 * `undefined` here cannot happen for a request the gate let through, since the
 * OIDC handler sets the token and the identity together, so it is treated as
 * signed out rather than sent on with no credential. Pure, so it can be tested
 * without the config module, which reads the environment at import.
 */
export function upstreamAuthHeaders(
  auth: ConnectionAuth,
  accessToken: string | undefined
): Record<string, string> | "unauthenticated" {
  switch (auth.kind) {
    case "none":
      return {};
    case "basic":
      return {
        authorization:
          "Basic " + Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString("base64")
      };
    case "user-token":
      if (!accessToken) return "unauthenticated";
      return { authorization: "Bearer " + accessToken };
  }
}
