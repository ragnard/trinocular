import type { Handle } from "@sveltejs/kit";
import { EncryptedCookie } from "./EncryptedCookie";

import type { CookieSerializeOptions } from "cookie";

import { logger } from "./logging";
import type { SessionData, SessionID, SessionStore } from "./sessionStore";

export interface SessionOptions {
  cookieName: string;
  cookieSecret: string;
  cookieOptions: CookieSerializeOptions & { path: string };
  maxLifetimeSeconds: number;
}

/** The browser's half of the session: what `Session` writes when its id
 *  changes or it is destroyed. It writes *at that moment* and not after the
 *  response, because SvelteKit refuses `cookies.set` once a route has produced
 *  its response — and a login that rotates the session from a form action is
 *  exactly a route doing so. A handler that rotates before calling `resolve`,
 *  as the OIDC callback does, never noticed the difference. */
export interface SessionCookie {
  set(sessionId: SessionID): Promise<void>;
  delete(): void;
}

export class Session {
  #store: SessionStore;
  #cookie: SessionCookie;
  #sessionId: SessionID;
  #previousSessionId: SessionID | null = null;
  #data: SessionData | null = null;
  #loadPromise: Promise<void> | null = null;
  #dirty = false;
  #destroyed = false;
  #maxLifetimeSeconds: number;

  constructor(
    store: SessionStore,
    cookie: SessionCookie,
    sessionId: SessionID,
    maxLifetimeSeconds: number
  ) {
    this.#store = store;
    this.#cookie = cookie;
    this.#sessionId = sessionId;
    this.#maxLifetimeSeconds = maxLifetimeSeconds;
  }

  get sessionId(): SessionID {
    return this.#sessionId;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  #ensureLoaded(): Promise<void> {
    if (this.#data !== null) return Promise.resolve();
    if (!this.#loadPromise) {
      this.#loadPromise = this.#store.load(this.#sessionId).then((data) => {
        this.#data = data ?? {};
      });
    }
    return this.#loadPromise;
  }

  async get<T>(key: string): Promise<T | undefined> {
    await this.#ensureLoaded();
    return this.#data![key] as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<T> {
    await this.#ensureLoaded();
    this.#data![key] = value;
    this.#dirty = true;
    return value;
  }

  async take<T>(key: string): Promise<T | undefined> {
    await this.#ensureLoaded();
    const value = this.#data![key] as T | undefined;
    if (value !== undefined) {
      delete this.#data![key];
      this.#dirty = true;
    }
    return value;
  }

  /** A fresh id for the same data, on login: an id handed out before it —
   *  planted in this browser, say — then names nothing. The old record is
   *  removed when the new one is committed. */
  async rotate(): Promise<void> {
    if (!this.#previousSessionId) {
      this.#previousSessionId = this.#sessionId;
    }
    this.#sessionId = crypto.randomUUID();
    await this.#cookie.set(this.#sessionId);
  }

  async destroy(): Promise<void> {
    await this.#store.destroy(this.#sessionId);
    if (this.#previousSessionId) {
      await this.#store.destroy(this.#previousSessionId);
    }
    this.#data = {};
    this.#dirty = false;
    this.#destroyed = true;
    this.#cookie.delete();
  }

  async commit(): Promise<void> {
    if (this.#destroyed) return;
    if (!this.#dirty && !this.#previousSessionId) return;

    if (this.#data !== null) {
      await this.#store.save(this.#sessionId, this.#data, this.#maxLifetimeSeconds);
    }

    if (this.#previousSessionId) {
      await this.#store.destroy(this.#previousSessionId);
    }
  }
}

type HandlerFactory = (store: SessionStore, opts: SessionOptions) => Promise<Handle>;

export const SessionHandler: HandlerFactory = async (store, opts) => {
  const cookie = await EncryptedCookie.create(opts.cookieName, opts.cookieSecret);

  return async ({ event, resolve }) => {
    let sessionId: string | null = null;
    try {
      sessionId = await cookie.getValue(event);
    } catch {
      logger.warn("failed to decrypt session cookie, issuing new session");
    }
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      await cookie.setValue(event, sessionId, opts.cookieOptions);
    }

    const session = new Session(
      store,
      {
        set: (id) => cookie.setValue(event, id, opts.cookieOptions),
        delete: () => event.cookies.delete(opts.cookieName, { path: opts.cookieOptions.path })
      },
      sessionId,
      opts.maxLifetimeSeconds
    );
    event.locals.session = session;

    try {
      return await resolve(event);
    } finally {
      // The store's half only: the cookie was written when the id changed,
      // while a response could still take it.
      try {
        await session.commit();
      } catch (e) {
        logger.error({ error: e }, "failed to commit session");
      }
    }
  };
};
