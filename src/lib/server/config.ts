import fs from "fs";
import path from "path";
import { z } from "zod";

import { logger } from "./logging";
import { env } from "$env/dynamic/private";

const ConnectionSchema = z.object({
  name: z.string(),
  uri: z.url(),
});

const CookieSchema = z.object({
  path: z.string().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(["strict", "lax", "none"]).optional(),
  domain: z.string().optional(),
  maxAge: z.number().int().positive().optional(),
});

const SessionSchema = z.object({
  cookieName: z.string().default("trinette-session"),
  cookieSecret: z.string().min(32, "cookieSecret must be at least 32 characters for adequate security"),
  cookie: CookieSchema.optional(),
});

const NoAuthnSchema = z.object({
  kind: z.literal("none"),
  user: z.string(),
});

const OIDCAuthnSchema = z.object({
  kind: z.literal("oidc"),
  issuer: z.url(),
  clientId: z.string(),
  clientSecret: z.string(),
  scope: z.string(),
  userIdClaim: z.string().default("preferred_username"),
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

const ConfigSchema = z.object({
  session: SessionSchema,
  authn: z.discriminatedUnion("kind", [NoAuthnSchema, OIDCAuthnSchema]),
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
    cookieSecret: crypto.randomUUID().replace(/-/g, ""),
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
