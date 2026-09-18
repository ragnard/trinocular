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
  maxAge: z.number().int().positive().optional()
});

const MemoryStoreSchema = z.object({
  kind: z.literal("memory")
});

const ValkeyNodeSchema = (defaultPort: number) =>
  z.object({
    host: z.string(),
    port: z.number().int().positive().default(defaultPort)
  });

const ValkeyTlsSchema = z.union([
  z.boolean(),
  z.object({
    // Path to a PEM bundle for a private CA. `true` alone trusts the system's.
    ca: z.string().optional()
  })
]);

const ValkeyCommon = {
  kind: z.literal("valkey"),
  secret: z.string().min(32, "store secret must be at least 32 characters for adequate security"),
  keyPrefix: z.string().default("trinette:session:"),
  username: z.string().optional(),
  password: z.string().optional(),
  tls: ValkeyTlsSchema.default(false),
  connectTimeoutMs: z.number().int().positive().default(10_000),
  commandTimeoutMs: z.number().int().positive().default(5_000)
};

const ValkeySingleSchema = z.object({
  ...ValkeyCommon,
  mode: z.literal("single"),
  host: z.string().default("127.0.0.1"),
  port: z.number().int().positive().default(6379),
  db: z.number().int().nonnegative().default(0)
});

const ValkeyClusterSchema = z.object({
  ...ValkeyCommon,
  mode: z.literal("cluster"),
  nodes: z.array(ValkeyNodeSchema(6379)).min(1)
});

const ValkeySentinelSchema = z.object({
  ...ValkeyCommon,
  mode: z.literal("sentinel"),
  sentinels: z.array(ValkeyNodeSchema(26379)).min(1),
  name: z.string(),
  // Sentinels are often secured separately from the nodes they watch.
  sentinelUsername: z.string().optional(),
  sentinelPassword: z.string().optional(),
  db: z.number().int().nonnegative().default(0)
});

// `mode` is required rather than defaulting to `single`: zod matches a
// discriminator against the raw input, so a defaulted one never matches an
// absent key.
const ValkeyStoreSchema = z.discriminatedUnion("mode", [
  ValkeySingleSchema,
  ValkeyClusterSchema,
  ValkeySentinelSchema
]);

const StoreSchema = z
  .discriminatedUnion("kind", [MemoryStoreSchema, ValkeyStoreSchema])
  .default({ kind: "memory" });

export type StoreConfig = z.infer<typeof StoreSchema>;
export type ValkeyStoreConfig = z.infer<typeof ValkeyStoreSchema>;

const SessionSchema = z
  .object({
    cookie: CookieSchema,
    maxLifetimeSeconds: z.number().int().positive().default(86400),
    store: StoreSchema
  })
  .refine((s) => s.store.kind !== "valkey" || s.store.secret !== s.cookie.secret, {
    message: "store secret must differ from the cookie secret",
    path: ["store", "secret"]
  });

const NoAuthnSchema = z.object({
  kind: z.literal("none"),
  user: z.string(),
  // Claims to hand the authorizer for a user nobody authenticated. There is no
  // provider here to ask, so the only way to exercise an authz rule without
  // standing up an identity provider is to write the claims down.
  claims: z.record(z.string(), z.unknown()).default({})
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
  paths: z
    .object({
      prefix: z.string().default("/auth"),
      callback: z.string().default("callback"),
      login: z.string().default("login"),
      logout: z.string().default("logout"),
      error: z.string().default("error")
    })
    .default({
      prefix: "/auth",
      callback: "callback",
      login: "login",
      logout: "logout",
      error: "error"
    })
});

const AllowAuthzSchema = z.object({
  kind: z.literal("allow")
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
  claim: z.string().optional()
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
  authz: AuthzSchema.optional()
});

const BrandingSchema = z.object({
  name: z.string().min(1).default("trinette"),
  // HTML, shown in the middle of the top bar. It is the operator's, from the
  // same file as the security policy, and is rendered as written.
  message: z.string().optional()
});

export type Branding = z.infer<typeof BrandingSchema>;

const ConfigSchema = z.object({
  branding: BrandingSchema.prefault({}),
  session: SessionSchema,
  authn: z.discriminatedUnion("kind", [NoAuthnSchema, OIDCAuthnSchema]),
  authz: AuthzSchema.default({ kind: "allow" }),
  connections: z.record(z.string(), ConnectionSchema).optional()
});

export type Config = z.infer<typeof ConfigSchema>;
export type Connection = z.infer<typeof ConnectionSchema>;

const DEFAULT_CONFIG = {
  authn: {
    kind: "none",
    user: "alice"
  },
  session: {
    cookie: {
      secret: crypto.randomUUID().replace(/-/g, ""),
      // Nothing has been configured, so this is somebody's laptop until ORIGIN
      // says otherwise — and a Secure cookie is never sent back over plain http.
      secure: env.ORIGIN?.startsWith("https") ?? false
    }
  }
};

/** The whole configuration, from the one thing the app cannot guess. Offered
 *  only when there is no config file: `TRINO_URL` stands in for one rather than
 *  overriding it. */
function quickStartConfig(trinoUrl: string): unknown {
  let name = trinoUrl;
  try {
    name = new URL(trinoUrl).host;
  } catch {
    // ConfigSchema is what reports a URL that will not parse.
  }
  return { ...DEFAULT_CONFIG, connections: { trino: { name, uri: trinoUrl } } };
}

function parseFile(content: string, filePath: string): unknown {
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    return Bun.YAML.parse(content);
  }
  return JSON.parse(content);
}

function validate(raw: unknown, source: string): Config {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    logger.error(`Config validation failed (${source}):\n` + z.prettifyError(result.error));
    process.exit(1);
  }
  return result.data;
}

function loadConfig(configPath?: string, trinoUrl?: string): Config {
  if (configPath && trinoUrl) {
    logger.error(
      "TRINETTE_CONFIG and TRINO_URL are both set. TRINO_URL stands in for a config file; " +
        "write the connection into the file and unset it."
    );
    process.exit(1);
  }

  if (!configPath) {
    if (trinoUrl) {
      logger.warn(
        { trinoUrl },
        "No config path specified, using TRINO_URL: one connection, no login, sessions in memory"
      );
      return validate(quickStartConfig(trinoUrl), "TRINO_URL");
    }
    logger.warn(
      "No config path specified, using defaults with random cookie secret (sessions will not persist across restarts)"
    );
    return validate(DEFAULT_CONFIG, "defaults");
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

  return validate(raw, resolvedPath);
}

export const config: Config = loadConfig(env.TRINETTE_CONFIG, env.TRINO_URL);

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

/** Where `Sign out` posts. Undefined with no provider to sign out of, which is
 *  what makes the button disappear rather than offer a way out of a session
 *  `authn: none` never opened. */
export const logoutPath =
  config.authn.kind === "oidc" ? `${authPrefix}/${config.authn.paths.logout}` : undefined;
