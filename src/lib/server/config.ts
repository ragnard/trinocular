import fs from "fs";
import path from "path";
import { z } from "zod";

import { logger } from "./logging";
import { env } from "$env/dynamic/private";

const ConnectionSchema = z.object({
  name: z.string(),
  uri: z.url(),
});

const SessionSchema = z.object({
  cookieName: z.string().default("trinette-session"),
  cookieSecret: z.string(),
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
  redirectPath: z.string(),
  scope: z.string(),
  userIdClaim: z.string().default("preferred_username"),
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
