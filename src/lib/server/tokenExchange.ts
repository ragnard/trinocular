import { createHash } from "crypto";

import type { TokenExchangeConfig } from "./config";

/** What a provider answered an exchange with. Only `token` is cached: a
 *  refusal is asked again on the next run, and an outage on the next poll,
 *  which the client already spaces out. */
export type ExchangeOutcome =
  | { kind: "token"; token: string; expiresIn: number }
  /** The provider answered with an OAuth error — the feature is off for this
   *  client, the audience is not permitted, the subject token was not accepted.
   *  Asking again would get the same answer. */
  | { kind: "refused"; error: string; description?: string }
  /** The provider could not be reached, or failed. */
  | { kind: "unavailable"; message: string };

export interface ExchangeRequest {
  subjectToken: string;
  audience: string;
  scope?: string;
}

/** The call to the provider, handed in so the cache can be tested without one. */
export type Exchange = (request: ExchangeRequest) => Promise<ExchangeOutcome>;

interface Cached {
  token: string;
  expiresAt: number;
}

export interface TokenExchangerOptions {
  /** Seconds before a cached token's expiry at which it is exchanged afresh,
   *  so a token handed to a request never expires in flight. */
  marginSeconds?: number;
  now?: () => number;
}

/**
 * Trades the user's access token for one issued for a cluster, and remembers
 * the answer for as long as it is good.
 *
 * The cache is this process's alone, on purpose. Every replica already holds
 * what it needs to rebuild an entry — the user's own token, in the shared
 * session store — and the exchanged token is a five-minute derivative of it
 * with no refresh token of its own, so sharing it would put one more bearer
 * at rest to save a call that happens a few times an hour per user. Keeping
 * it out of the session store also keeps the store's writes what they are
 * (login, refresh, logout): an exchange on the polling path writing the
 * session document from whichever replica served the poll would make the
 * known cross-replica refresh race routine.
 *
 * Entries are keyed by the *subject token* (hashed) and the connection, not
 * by the session. A refreshed subject token therefore misses and is exchanged
 * again with no bookkeeping, and an exchanged token is never used past the
 * token it came from. Concurrent misses on one key share one call, the way
 * refreshes do, so two statements started together cost the provider one
 * request.
 */
export class TokenExchanger {
  #exchange: Exchange;
  #cache = new Map<string, Cached>();
  #inflight = new Map<string, Promise<ExchangeOutcome>>();
  #margin: number;
  #now: () => number;
  #nextSweep = 0;

  constructor(exchange: Exchange, opts: TokenExchangerOptions = {}) {
    this.#exchange = exchange;
    this.#margin = opts.marginSeconds ?? 30;
    this.#now = opts.now ?? (() => Date.now() / 1000);
  }

  token(
    subjectToken: string,
    connectionId: string,
    exchange: TokenExchangeConfig
  ): Promise<ExchangeOutcome> {
    const key = connectionId + "\u001f" + createHash("sha256").update(subjectToken).digest("hex");
    const cached = this.#cache.get(key);
    if (cached && cached.expiresAt - this.#margin > this.#now()) {
      return Promise.resolve({
        kind: "token",
        token: cached.token,
        expiresIn: cached.expiresAt - this.#now()
      });
    }
    const existing = this.#inflight.get(key);
    if (existing) return existing;

    const promise = this.#exchange({ subjectToken, ...exchange })
      .then((outcome) => {
        if (outcome.kind === "token" && outcome.expiresIn > this.#margin) {
          this.#cache.set(key, {
            token: outcome.token,
            expiresAt: this.#now() + outcome.expiresIn
          });
        }
        return outcome;
      })
      .finally(() => {
        this.#inflight.delete(key);
        this.#sweep();
      });
    this.#inflight.set(key, promise);
    return promise;
  }

  /** How many tokens are held; for tests and the log. */
  get size(): number {
    return this.#cache.size;
  }

  /** Drops expired entries, no more than once a minute. The map is bounded by
   *  sessions × connections regardless; this only keeps a long-running
   *  process from holding on to tokens of sessions that have ended. */
  #sweep() {
    const now = this.#now();
    if (now < this.#nextSweep) return;
    this.#nextSweep = now + 60;
    for (const [key, entry] of this.#cache) {
      if (entry.expiresAt <= now) this.#cache.delete(key);
    }
  }
}
