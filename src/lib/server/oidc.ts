import { redirect, type Handle, type RequestEvent } from "@sveltejs/kit";
import * as client from "openid-client";
import type { Session } from "./session";

import { env } from "$env/dynamic/private";
import { error as error } from "./errors";
import { logger } from "./logging";

interface OIDCOptions {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  scope: string;
  userIdClaim: string;
  paths: {
    prefix: string;
    callback: string;
    login: string;
    logout: string;
    error: string;
  };
}

interface OIDCSessionData {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken?: string;
  claims?: client.IDToken;
}

interface OIDCCallbackData {
  codeVerifier: string;
  returnToUrl: string;
  state: string;
  nonce: string;
}

const nowInSeconds = () => Math.floor(Date.now() / 1000);

const createSessionData = (
  response: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
  previous?: { claims?: client.IDToken; refreshToken?: string }
): OIDCSessionData => {
  if (!response.expires_in) {
    throw new Error('No "expires_in" in token response');
  }
  return {
    accessToken: response.access_token,
    accessTokenExpiresAt: nowInSeconds() + response.expires_in,
    refreshToken: response.refresh_token ?? previous?.refreshToken,
    claims: response.id_token ? response.claims() : previous?.claims
  };
};

const nearExpiry = (timestampInSeconds: number, thresholdSeconds: number): boolean => {
  return timestampInSeconds - nowInSeconds() <= thresholdSeconds;
};

const expired = (timestampInSeconds: number): boolean => nearExpiry(timestampInSeconds, 0);

const isSafeReturnUrl = (url: string): boolean => {
  return url.startsWith("/") && !url.startsWith("//");
};

/** Checks that the session has claims with a usable userId. The library
 *  already validates aud/iss/sub/exp/nonce at token exchange time. */
const hasValidUserId = (
  claims: client.IDToken | undefined,
  userIdClaim: string
): claims is client.IDToken => {
  if (!claims) return false;
  const userId = claims[userIdClaim];
  return typeof userId === "string" && userId !== "";
};

class TokenRefreshCoalescer {
  #inflight = new Map<string, Promise<OIDCSessionData>>();
  #config: client.Configuration;
  #log;

  constructor(config: client.Configuration) {
    this.#config = config;
    this.#log = logger.child({ component: "token-refresh" });
  }

  refresh(session: Session, data: OIDCSessionData): Promise<OIDCSessionData> {
    const existing = this.#inflight.get(session.sessionId);
    if (existing) return existing;

    const promise = this.#doRefresh(session, data).finally(() => {
      this.#inflight.delete(session.sessionId);
    });

    this.#inflight.set(session.sessionId, promise);
    return promise;
  }

  async #doRefresh(session: Session, data: OIDCSessionData): Promise<OIDCSessionData> {
    if (!data.refreshToken) {
      throw new Error("Cannot refresh: no refresh token");
    }
    this.#log.info({ sessionId: session.sessionId.slice(0, 8) }, "refreshing token");
    const response = await client.refreshTokenGrant(this.#config, data.refreshToken);
    const newData = createSessionData(response, data);
    await session.set("oidc", newData);
    this.#log.info({ sessionId: session.sessionId.slice(0, 8) }, "token refreshed");
    return newData;
  }
}

export const OIDCHandler = async (opts: OIDCOptions): Promise<Handle> => {
  if (!env.ORIGIN) {
    throw new Error("ORIGIN environment variable is required for OIDC");
  }

  const config: client.Configuration = await client.discovery(
    opts.issuer,
    opts.clientId,
    opts.clientSecret
  );

  const coalescer = new TokenRefreshCoalescer(config);

  const callbackPath = opts.paths.prefix + "/" + opts.paths.callback;
  const logoutPath = opts.paths.prefix + "/" + opts.paths.logout;
  const errorPath = opts.paths.prefix + "/" + opts.paths.error;
  const redirectUri = env.ORIGIN + callbackPath;

  const loginPath = opts.paths.prefix + "/" + opts.paths.login;

  const redirectToProvider = async (session: Session, returnToUrl: string) => {
    const codeVerifier: string = client.randomPKCECodeVerifier();
    const codeChallenge: string = await client.calculatePKCECodeChallenge(codeVerifier);
    const state: string = crypto.randomUUID();
    const nonce: string = crypto.randomUUID();

    const parameters: Record<string, string> = {
      redirect_uri: redirectUri,
      scope: opts.scope,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce
    };

    const providerUrl = client.buildAuthorizationUrl(config, parameters);

    await session.set("oidc-callback", { codeVerifier, returnToUrl, state, nonce });

    redirect(303, providerUrl);
  };

  const handleCallback = async (session: Session, event: RequestEvent) => {
    const callbackData = await session.get<OIDCCallbackData>("oidc-callback");
    if (!callbackData) {
      error(event.locals.logger, 500, "Internal server error", "callback data missing from session");
    }

    let tokens;
    try {
      tokens = await client.authorizationCodeGrant(config, event.url, {
        pkceCodeVerifier: callbackData.codeVerifier,
        expectedState: callbackData.state,
        expectedNonce: callbackData.nonce,
      });
    } catch (e) {
      event.locals.logger.error({ error: e }, "OIDC token exchange failed");
      await session.take("oidc-callback");
      await session.set("auth-error", {
        requestId: event.locals.requestId,
      });
      redirect(303, errorPath);
    }

    await session.take("oidc-callback");

    const sessionData = createSessionData(tokens);

    if (!hasValidUserId(sessionData.claims, opts.userIdClaim)) {
      error(
        event.locals.logger, 403,
        "Authentication failed: ID token missing or invalid required claims",
        "auth failed: missing or invalid userId claim",
        { claims: sessionData.claims }
      );
    }

    session.rotate();
    await session.set<OIDCSessionData>("oidc", sessionData);

    const returnTo = isSafeReturnUrl(callbackData.returnToUrl) ? callbackData.returnToUrl : "/";
    redirect(303, returnTo);
  };

  return async ({ event, resolve }) => {
    const session: Session = event.locals.session;
    if (!session) {
      error(event.locals.logger, 500, "Internal server error", "no session in request event");
    }

    // is this a logout request?
    if (event.url.pathname === logoutPath && event.request.method === "POST") {
      const oidcData = await session.get<OIDCSessionData>("oidc");
      if (oidcData?.refreshToken) {
        try {
          await client.tokenRevocation(config, oidcData.refreshToken);
        } catch (e) {
          event.locals.logger.warn({ error: e }, "token revocation failed");
        }
      }
      await session.destroy();
      redirect(303, "/");
    }

    // is this an auth callback request?
    if (event.url.pathname === callbackPath && event.request.method === "GET") {
      return await handleCallback(session, event);
    }

    // is this a login request?
    if (event.url.pathname === loginPath && event.request.method === "GET") {
      const returnTo = event.url.searchParams.get("returnTo") ?? "/";
      const returnToUrl = isSafeReturnUrl(returnTo) ? returnTo : "/";
      return await redirectToProvider(session, returnToUrl);
    }

    // allow unauthenticated access to auth pages (login, error)
    if (event.url.pathname.startsWith(opts.paths.prefix + "/")) {
      return await resolve(event);
    }

    // try to resolve valid tokens — if we can't, proceed without setting locals
    let oidcData = await session.get<OIDCSessionData>("oidc");
    if (oidcData) {
      if (expired(oidcData.accessTokenExpiresAt)) {
        if (oidcData.refreshToken) {
          try {
            oidcData = await coalescer.refresh(session, oidcData);
          } catch (e) {
            event.locals.logger.warn({ error: e }, "refresh failed");
            oidcData = undefined;
          }
        } else {
          oidcData = undefined;
        }
      } else if (nearExpiry(oidcData.accessTokenExpiresAt, 30) && oidcData.refreshToken) {
        try {
          oidcData = await coalescer.refresh(session, oidcData);
        } catch (e) {
          event.locals.logger.warn({ error: e }, "proactive refresh failed");
        }
      }

      if (oidcData && !hasValidUserId(oidcData.claims, opts.userIdClaim)) {
        event.locals.logger.warn("stored claims missing or invalid");
        oidcData = undefined;
      }

      if (oidcData) {
        event.locals.accessToken = oidcData.accessToken;
        event.locals.claims = oidcData.claims;
        event.locals.userId = oidcData.claims![opts.userIdClaim] as string;
      }
    }

    return await resolve(event);
  };
};
