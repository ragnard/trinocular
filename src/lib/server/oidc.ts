import { redirect, type Handle, type RequestEvent } from "@sveltejs/kit";
import * as client from "openid-client";
import type { Session } from "./session";

import { env } from "$env/dynamic/private";
import { error } from "./errors";
import { logger } from "./logging";
import type { Claims } from "./identity";

interface OIDCOptions {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  scope: string;
  userIdClaim: string;
  claimsFrom: "id_token" | "access_token";
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
  /** The identity's claims, from whichever token `claimsFrom` names. */
  claims?: Claims;
  /** Kept solely as the `id_token_hint` for RP-initiated logout: it is what
   *  tells the provider whose session to end. */
  idToken?: string;
}

interface OIDCCallbackData {
  codeVerifier: string;
  returnToUrl: string;
  state: string;
  nonce: string;
}

const nowInSeconds = () => Math.floor(Date.now() / 1000);

/** Reads a JWT's payload without verifying it. Safe here and nowhere else:
 *  this token came back over TLS from the provider's own token endpoint, in a
 *  back-channel call we made, so there is no untrusted party between us and
 *  the issuer whose signature there would be anything to check. */
const decodePayload = (token: string): Claims | undefined => {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    return typeof payload === "object" && payload !== null ? payload : undefined;
  } catch {
    return undefined;
  }
};

const claimsFor = (
  claimsFrom: OIDCOptions["claimsFrom"],
  response: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
  previous?: { claims?: Claims }
): Claims | undefined => {
  if (claimsFrom === "access_token") {
    const claims = decodePayload(response.access_token);
    if (!claims) {
      // Nothing to fall back on: an opaque access token cannot be made to
      // yield claims, and carrying the previous ones forward would leave a
      // refreshed session judged on a token it no longer holds.
      logger.warn("claimsFrom is access_token but the access token is not a readable JWT");
    }
    return claims;
  }
  // A refresh need not return a new ID token; the identity it described is
  // still the one the session is for.
  return response.id_token ? response.claims() : previous?.claims;
};

const createSessionData = (
  response: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
  claimsFrom: OIDCOptions["claimsFrom"],
  previous?: OIDCSessionData
): OIDCSessionData => {
  if (!response.expires_in) {
    throw new Error('No "expires_in" in token response');
  }
  return {
    accessToken: response.access_token,
    accessTokenExpiresAt: nowInSeconds() + response.expires_in,
    refreshToken: response.refresh_token ?? previous?.refreshToken,
    claims: claimsFor(claimsFrom, response, previous),
    idToken: response.id_token ?? previous?.idToken
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
const hasValidUserId = (claims: Claims | undefined, userIdClaim: string): claims is Claims => {
  if (!claims) return false;
  const userId = claims[userIdClaim];
  return typeof userId === "string" && userId !== "";
};

class TokenRefreshCoalescer {
  #inflight = new Map<string, Promise<OIDCSessionData>>();
  #config: client.Configuration;
  #claimsFrom: OIDCOptions["claimsFrom"];
  #log;

  constructor(config: client.Configuration, claimsFrom: OIDCOptions["claimsFrom"]) {
    this.#config = config;
    this.#claimsFrom = claimsFrom;
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
    const newData = createSessionData(response, this.#claimsFrom, data);
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

  const coalescer = new TokenRefreshCoalescer(config, opts.claimsFrom);

  const callbackPath = opts.paths.prefix + "/" + opts.paths.callback;
  const logoutPath = opts.paths.prefix + "/" + opts.paths.logout;
  const errorPath = opts.paths.prefix + "/" + opts.paths.error;
  const redirectUri = env.ORIGIN + callbackPath;

  const loginPath = opts.paths.prefix + "/" + opts.paths.login;

  /** RP-initiated logout. Dropping our own session is only half of signing out:
   *  the provider keeps its own SSO cookie, so the next visit to the login path
   *  is answered without a prompt and the same person comes straight back. That
   *  makes "sign out" a no-op from the user's side — and on the forbidden page,
   *  where signing out is the only move a refused user has, it makes the button
   *  a lie. `post_logout_redirect_uri` has to be registered with the provider
   *  (in Keycloak: the client's "Valid post logout redirect URIs"). */
  const endSessionSupported = Boolean(config.serverMetadata().end_session_endpoint);
  if (!endSessionSupported) {
    logger.warn(
      "provider advertises no end_session_endpoint: signing out will not end the provider's session"
    );
  }
  const endSessionUrl = (idToken?: string): string | undefined => {
    if (!endSessionSupported) return undefined;
    const parameters: Record<string, string> = { post_logout_redirect_uri: env.ORIGIN + "/" };
    // Without the hint the provider may ask which session to end; with it the
    // logout is unattended, which is the point.
    if (idToken) parameters.id_token_hint = idToken;
    return client.buildEndSessionUrl(config, parameters).href;
  };

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

    const sessionData = createSessionData(tokens, opts.claimsFrom);

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
      // Read the hint before the session goes, then hand the user to the
      // provider to finish the job. Falling back to "/" leaves them signed in
      // there, which is the best a provider without the endpoint allows.
      const endSession = endSessionUrl(oidcData?.idToken);
      await session.destroy();
      redirect(303, endSession ?? "/");
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
        event.locals.identity = {
          userId: oidcData.claims![opts.userIdClaim] as string,
          claims: oidcData.claims!
        };
      }
    }

    return await resolve(event);
  };
};
