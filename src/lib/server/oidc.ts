import { error, redirect, type Handle, type RequestEvent } from "@sveltejs/kit";
import * as client from "openid-client";
import type { Session, SessionStore } from "./session";

import { env } from "$env/dynamic/private";
import { logger } from "./logging";
import { PriorityQueue } from "./priority_queue";

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
}

const nowInSeconds = () => Math.floor(Date.now() / 1000);

const createSessionData = (
  response: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
): OIDCSessionData => {
  if (!response.expires_in) {
    throw new Error('No "expires_in" in token response');
  }
  return {
    accessToken: response.access_token,
    accessTokenExpiresAt: nowInSeconds() + response.expires_in,
    refreshToken: response.refresh_token,
    claims: response.claims()
  };
};

const expired = (timestampInSeconds: number): boolean => {
  return timestampInSeconds - nowInSeconds() <= 0;
};

interface SessionToken {
  session: Session;
  data: OIDCSessionData;
}

class TokenRefresher {
  #config: client.Configuration;
  #queue: PriorityQueue<SessionToken>;
  #log;

  constructor(config: client.Configuration) {
    this.#config = config;
    this.#queue = new PriorityQueue<SessionToken>();
    this.#log = logger.child({ component: "token-refresher" });

    setInterval(() => this.#refresh(), 1000);
  }

  add(session: Session, data: OIDCSessionData) {
    this.#queue.enqueue({ session, data }, data.accessTokenExpiresAt);
  }

  async #refresh() {
    this.#log.info("refreshing: size=%d", this.#queue.size());

    let expiryThreshold = nowInSeconds() + 10;
    let tokensToRefresh = this.#queue.dequeueLessThan(expiryThreshold);

    this.#log.info("tokensToRefresh: %d", tokensToRefresh.length);
    tokensToRefresh.forEach((token) => this.#refreshToken(token));
  }

  async #refreshToken(token: SessionToken) {
    if (!token.data.refreshToken) {
      this.#log.warn({ sessionId: token.session.sessionId }, "session had no refresh token");
      return;
    }

    const session = token.session;

    try {
      this.#log.info({ sessionId: session.sessionId }, "refreshing token");

      const response = await client.refreshTokenGrant(this.#config, token.data.refreshToken);
      const sessionData = createSessionData(response);

      await session.set("oidc", sessionData);

      this.add(session, sessionData);

      this.#log.info({ sessionId: session.sessionId }, "token refreshed!");
    } catch (e) {
      this.#log.warn({ sessionId: session.sessionId, error: e }, "failed to refresh token");
    }
  }
}

export const OIDCHandler = async (opts: OIDCOptions): Promise<Handle> => {
  const config: client.Configuration = await client.discovery(
    opts.issuer,
    opts.clientId,
    opts.clientSecret
  );

  const tokenRefresher = new TokenRefresher(config);

  const redirectUri = env.TRINETTE_ORIGIN + opts.redirectPath;

  const redirectToProvider = async (session: Session, event: RequestEvent) => {
    const codeVerifier: string = client.randomPKCECodeVerifier();
    const codeChallenge: string = await client.calculatePKCECodeChallenge(codeVerifier);
    const state: string = crypto.randomUUID();

    const parameters: Record<string, string> = {
      redirect_uri: redirectUri,
      scope: opts.scope,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state
    };

    const returnToUrl = event.url.pathname;
    const providerUrl = client.buildAuthorizationUrl(config, parameters);

    await session.set("oidc-callback", { codeVerifier, returnToUrl, state });

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
    });

    const sessionData = createSessionData(tokens);
    await session.set<OIDCSessionData>("oidc", sessionData);

    tokenRefresher.add(session, sessionData);

    redirect(303, callbackData.returnToUrl);
  };

  return async ({ event, resolve }) => {
    const session: Session = event.locals.session;
    if (!session) {
      error(500, "No session in request event");
    }

    // is this an auth callback request?
    if (event.url.pathname == opts.redirectPath) {
      return await handleCallback(session, event);
    }

    // do we have OIDC session data?
    let oidcData = await session.get<OIDCSessionData>("oidc");
    if (!oidcData) {
      event.locals.logger.info("no oidc data in session, redirecting to provider");
      return await redirectToProvider(session, event);
    }

    // if access token is expired
    if (expired(oidcData.accessTokenExpiresAt)) {
      event.locals.logger.info("access token expired, redirecting to provider");
      return await redirectToProvider(session, event);
    }

    // verify audience/etc?

    // event.locals.logger.info({'oidcData': oidcData}, 'oidcData');

    let claims = oidcData.claims;
    let userId = claims != null ? claims[opts.userIdClaim] : null;

    event.locals.accessToken = oidcData.accessToken;
    event.locals.claims = claims;
    event.locals.userId = userId as string;

    const res = await resolve(event);

    return res;
  };
};
