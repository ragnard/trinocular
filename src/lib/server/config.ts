import fs from "fs";
import path from "path";
import { z } from "zod";

import { logger } from "./logging";
import { env } from "$env/dynamic/private";



const CookieSchema = z.object({
  name: z.string().default("trinette-session"),
  secret: z.string().min(32, "cookie secret must be at least 32 characters for adequate security"),
  path: z.string().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(["strict", "lax", "none"]).optional(),
  domain: z.string().optional(),
  maxAge: z.number().int().positive().optional(),
});

const SessionSchema = z.object({
  cookie: CookieSchema,
  maxLifetimeSeconds: z.number().int().positive().default(86400),
});

const NoAuthnSchema = z.object({
  kind: z.literal("none"),
  user: z.string(),
  // Claims to hand the authorizer for a user nobody authenticated. There is no
  // provider here to ask, so the only way to exercise an authz rule without
  // standing up an identity provider is to write the claims down.
  claims: z.record(z.string(), z.unknown()).default({}),
});

const OIDCAuthnSchema = z.object({
  kind: z.literal("oidc"),
  issuer: z.url(),
  clientId: z.string(),
  clientSecret: z.string(),
  scope: z.string(),
  userIdClaim: z.string().default("preferred_username"),
  // Which token the identity's claims are read from. The ID token is who the
  // user is and is the right default; but Keycloak puts client roles in the
  // access token unless the "Add to ID token" box is ticked on the client
  // roles mapper, so a role-based authz rule often wants the other one.
  claimsFrom: z.enum(["id_token", "access_token"]).default("id_token"),
  paths: z.object({
    prefix: z.string().default("/auth"),
    callback: z.string().default("callback"),
    login: z.string().default("login"),
    logout: z.string().default("logout"),
    error: z.string().default("error"),
  }).default({
    prefix: "/auth",
    callback: "callback",
    login: "login",
    logout: "logout",
    error: "error",
  }),
});

const AllowAuthzSchema = z.object({
  kind: z.literal("allow"),
});

const RequireRoleAuthzSchema = z.object({
  kind: z.literal("require-role"),
  role: z.string(),
  // The OIDC client whose roles are consulted. Defaults to this application's
  // own clientId, which is what "the role I granted Trinette in Keycloak"
  // means; name another client to reuse its roles.
  client: z.string().optional(),
  // Escape hatch for a provider that does not lay roles out the way Keycloak
  // does: a dotted claim path to a list of strings, e.g. `realm_access.roles`
  // for realm-wide Keycloak roles, or plain `groups`. Overrides `client`.
  claim: z.string().optional(),
});

/** The same policy vocabulary wherever a policy is written — once at the top
 *  level for the application, and optionally again under a connection. */
const AuthzSchema = z.discriminatedUnion("kind", [AllowAuthzSchema, RequireRoleAuthzSchema]);

export type AuthzConfig = z.infer<typeof AuthzSchema>;

const ConnectionSchema = z.object({
  name: z.string(),
  uri: z.url(),
  // Who may use *this cluster*, on top of the application-wide rule rather
  // than instead of it: a connection rule can only ever narrow. Absent means
  // the connection adds no condition of its own, which is not the same as
  // "anyone" — the top-level policy has already been applied.
  authz: AuthzSchema.optional(),
});

const ConfigSchema = z.object({
  session: SessionSchema,
  authn: z.discriminatedUnion("kind", [NoAuthnSchema, OIDCAuthnSchema]),
  authz: AuthzSchema.default({ kind: "allow" }),
  connections: z.record(z.string(), ConnectionSchema).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type Connection = z.infer<typeof ConnectionSchema>;

const DEFAULT_CONFIG = {
  authn: {
    kind: "none",
    user: "alice",
  },
  session: {
    cookie: {
      secret: crypto.randomUUID().replace(/-/g, ""),
    },
  },
};

function parseFile(content: string, filePath: string): unknown {
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    return Bun.YAML.parse(content);
  }
  return JSON.parse(content);
}

function loadConfig(configPath?: string): Config {
  if (!configPath) {
    logger.warn(
      "No config path specified, using defaults with random cookie secret (sessions will not persist across restarts)"
    );
    return ConfigSchema.parse(DEFAULT_CONFIG);
  }

  const resolvedPath = path.resolve(configPath);
  logger.info({ configPath, resolvedPath }, "loading config");

  let raw: unknown;
  try {
    raw = parseFile(fs.readFileSync(resolvedPath, "utf-8"), resolvedPath);
  } catch (err) {
    logger.error(`Failed to read config from ${resolvedPath}: ${err}`);
    process.exit(1);
  }

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    logger.error("Config validation failed:\n" + z.prettifyError(result.error));
    process.exit(1);
  }

  return result.data;
}

export const config: Config = loadConfig(env.TRINETTE_CONFIG);

/** The auth pages — login, error, forbidden — are SvelteKit routes, so they sit
 *  at a fixed `/auth/*` however `paths.prefix` is configured. Only the paths the
 *  OIDC handler intercepts itself (callback, logout, the login trigger) move
 *  with the prefix. Both subtrees have to be exempt from the access gate: if
 *  only the configured prefix were, a deployment that renamed it would send a
 *  refused user to a forbidden page that the gate then refused as well, which
 *  is a redirect loop rather than an explanation. */
const AUTH_PAGES = "/auth";
export const authPrefix = config.authn.kind === "oidc" ? config.authn.paths.prefix : AUTH_PAGES;

const within = (prefix: string, pathname: string) =>
  pathname === prefix || pathname.startsWith(prefix + "/");

export const isAuthPath = (pathname: string) =>
  within(AUTH_PAGES, pathname) || within(authPrefix, pathname);

/** Where the gate sends a signed-out user. This one *is* handler-intercepted,
 *  so it follows the configured prefix and segment. */
export const loginPath =
  config.authn.kind === "oidc"
    ? `${authPrefix}/${config.authn.paths.login}`
    : `${AUTH_PAGES}/login`;

/** Where the gate sends a refused user: a page, so a fixed route. */
export const forbiddenPath = `${AUTH_PAGES}/forbidden`;
