import { error, redirect, type Handle, type RequestEvent } from "@sveltejs/kit";
import * as client from "openid-client";
import type { Session, SessionStore } from "./session";

import { env } from "$env/dynamic/private";
import { logger } from "./logging";

interface OIDCOptions {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  scope: string;
  redirectPath: string;
  userIdClaim: string;
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
    this.#log.info({ sessionId: session.sessionId }, "refreshing token");
    const response = await client.refreshTokenGrant(this.#config, data.refreshToken!);
    const newData = createSessionData(response, data);
    await session.set("oidc", newData);
    this.#log.info({ sessionId: session.sessionId }, "token refreshed");
    return newData;
  }
}

export const OIDCHandler = async (opts: OIDCOptions): Promise<Handle> => {
  const config: client.Configuration = await client.discovery(
    opts.issuer,
    opts.clientId,
    opts.clientSecret
  );

  const coalescer = new TokenRefreshCoalescer(config);

  const redirectUri = env.ORIGIN + opts.redirectPath;

  const redirectToProvider = async (session: Session, event: RequestEvent) => {
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

    const returnToUrl = event.url.pathname + event.url.search;
    const providerUrl = client.buildAuthorizationUrl(config, parameters);

    await session.set("oidc-callback", { codeVerifier, returnToUrl, state, nonce });

    redirect(303, providerUrl);
  };

  const handleCallback = async (session: Session, event: RequestEvent) => {
    const callbackData = await session.take<OIDCCallbackData>("oidc-callback");
    if (!callbackData) {
      error(500, "callback data missing from session");
    }

    const tokens = await client.authorizationCodeGrant(config, event.url, {
      pkceCodeVerifier: callbackData.codeVerifier,
      expectedState: callbackData.state,
      expectedNonce: callbackData.nonce,
    });

    const sessionData = createSessionData(tokens);
    await session.set<OIDCSessionData>("oidc", sessionData);

    const returnTo = isSafeReturnUrl(callbackData.returnToUrl) ? callbackData.returnToUrl : "/";
    redirect(303, returnTo);
  };

  return async ({ event, resolve }) => {
    const session: Session = event.locals.session;
    if (!session) {
      error(500, "No session in request event");
    }

    // is this an auth callback request?
    if (event.url.pathname === opts.redirectPath && event.request.method === "GET") {
      return await handleCallback(session, event);
    }

    // do we have OIDC session data?
    let oidcData = await session.get<OIDCSessionData>("oidc");
    if (!oidcData) {
      event.locals.logger.info("no oidc data in session, redirecting to provider");
      return await redirectToProvider(session, event);
    }

    // if access token is expired, refresh before proceeding
    if (expired(oidcData.accessTokenExpiresAt)) {
      if (oidcData.refreshToken) {
        try {
          oidcData = await coalescer.refresh(session, oidcData);
        } catch (e) {
          event.locals.logger.warn({ error: e }, "refresh failed, redirecting to provider");
          return await redirectToProvider(session, event);
        }
      } else {
        return await redirectToProvider(session, event);
      }
    } else if (nearExpiry(oidcData.accessTokenExpiresAt, 30) && oidcData.refreshToken) {
      // proactive fire-and-forget refresh for next request
      coalescer.refresh(session, oidcData).catch((e) => {
        event.locals.logger.warn({ error: e }, "proactive refresh failed");
      });
    }

    // validate audience and issuer on stored claims
    if (oidcData.claims) {
      const aud = oidcData.claims.aud;
      const audValid = aud === opts.clientId ||
        (Array.isArray(aud) && aud.includes(opts.clientId));
      if (!audValid) {
        event.locals.logger.warn("ID token audience mismatch, re-authenticating");
        return await redirectToProvider(session, event);
      }
      const issuer = opts.issuer.toString().replace(/\/$/, "");
      if (oidcData.claims.iss !== issuer) {
        event.locals.logger.warn("ID token issuer mismatch, re-authenticating");
        return await redirectToProvider(session, event);
      }
    }

    const claims = oidcData.claims;
    const userId = claims != null ? claims[opts.userIdClaim] : null;

    event.locals.accessToken = oidcData.accessToken;
    event.locals.claims = claims;
    event.locals.userId = userId as string;

    const res = await resolve(event);

    return res;
  };
};
