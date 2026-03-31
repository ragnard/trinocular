import fs from "fs";
import path from "path";
import { type } from "arktype";

import { logger } from "./logging";
import { env } from "$env/dynamic/private";

const Connection = type({
  id: "string",
  name: "string",
  uri: "string.url",
});

const Session = type({
  cookieName: type("string").default("trinette-session"),
  cookieSecret: "string",
});

const NoAuthn = type({
  kind: "'none'",
  user: "string",
});

const OIDCAuthn = type({
  kind: "'oidc'",
  issuer: "string.url",
  clientId: "string",
  clientSecret: "string",
  redirectPath: "string",
  scope: "string",
  userIdClaim: type("string").default("preferred_username"),
});

const Authn = NoAuthn.or(OIDCAuthn);

export const Config = type({
  session: Session,
  authn: Authn,
  "connections?": Connection.array(),
});

const DEFAULT_CONFIG = {
  authn: {
    kind: "none",
    user: "alice",
  },
  session: {
    cookieSecret: "8e04c69ea4adc52a4dfb0a13ba952ec4",
  },
};

export type Config = typeof Config.infer;
export type Connection = typeof Connection.infer;

function loadConfig(configPath?: string): Config {
  try {
    if (!configPath) {
      logger.warn("No config path specified, using defaults");
      return Config.assert(DEFAULT_CONFIG);
    }

    const resolvedPath = path.resolve(configPath);
    logger.info({ configPath, resolvedPath }, "loading config");

    const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
    return Config.assert(raw);
  } catch (err) {
    throw new Error(`Failed to load config from ${configPath}: ${err}`);
  }
}

let loadedConfig: Config | null = null;

export const getConfig = (): Config => {
  if (!loadedConfig) {
    loadedConfig = loadConfig(env.TRINETTE_CONFIG);
  }
  return loadedConfig;
};
